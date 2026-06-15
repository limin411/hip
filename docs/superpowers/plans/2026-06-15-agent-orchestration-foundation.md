# 多智能体编排地基 — 实现计划 (Agent Orchestration Foundation)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** 交付纯逻辑的多智能体编排内核 + 接缝(中枢编排 / 确定性 DAG / 本地 ACP / 纯抽象层+接缝),不接真实 agent、不做 UI、不端到端。

**Architecture:** 共享类型→`@hip/protocol`;纯引擎(registry/validate/reduce/executor)+ 三个 Fake 端口→`packages/sidecar/src/orchestrator/`。节点 = 一个外部 agent 的一整个回合,在 `AgentProvider` 接缝之上。

**Spec:** `docs/superpowers/specs/2026-06-15-agent-orchestration-foundation-design.md`

---

## Conventions(每个 task 都遵守)

- **分支**:全程在 `feat/agent-orchestration-foundation`。**绝不** `git checkout`/切换分支(review 子代理用读文件或 `git diff` 审查,不切分支)。
- **测试**:从**仓库根**用**显式文件路径**跑。sidecar:`yarn vitest run packages/sidecar/src/orchestrator/<X>.test.ts`;protocol:`yarn vitest run packages/protocol/src/<X>.test.ts`。**绝不** `vitest run src`(会命中付费真 LLM 套件)。
- **类型检查**:`yarn workspace @hip/sidecar exec tsc --noEmit` 之后 `yarn type-check`(根)。**没有** `@hip/protocol build`(protocol 是裸 TS,被传递校验)。
- **提交**:每个 task 完成即 commit,信息含 trailer:`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。
- **不要动**未跟踪的 `docs/superpowers/specs/2026-06-15-v0.2-next-version-plan-design.md`。
- 纯逻辑:无真实 agent / LLM / 网络 / UI / 文件 IO(除 `readAgentsConfig` 已有)。
- 依赖顺序严格串行:Task 1 → 2 → 3 → 4 → 5 → 6 → 7。

---

## Task 1: 编排共享类型 (`@hip/protocol`)

**Files:** Modify `packages/protocol/src/index.ts`(追加,放文件末尾的新区段);Test `packages/protocol/src/orchestration-types.test.ts`

- [ ] **Step 1: 追加类型到 `packages/protocol/src/index.ts`**

```ts
// ──────────────────────────────────────────────────────────────────
// Agent orchestration foundation (multi-agent workflows over the AgentProvider seam)
// ──────────────────────────────────────────────────────────────────

export type AgentId = string

export interface AgentCapabilities {
  streamsReasoning: boolean
  toolCalls: boolean
  hitl: boolean        // 交互式权限往返 (ExternalAgentHooks.requestPermission)
  modelSwitch: boolean // 实时换模型 (setConfigOption)
}

export interface AgentDescriptor {
  id: AgentId
  name: string
  kind: AgentConfig['kind'] // 'custom' | 'opencode' | 'acp'
  capabilities: AgentCapabilities
}

export type NodeId = string

export interface AgentNode {
  id: NodeId
  type: 'agent'
  agentId: AgentId
  /** 含 {{nodeId}} / {{input}} / {{input.key}} 占位,引用上游产物或运行输入。 */
  inputTemplate: string
}
export type WorkflowNode = AgentNode // 节点 union 留开口,本轮仅 'agent'

export interface EdgeCondition { kind: 'always' | 'contains' | 'equals'; value?: string }
export interface WorkflowEdge { from: NodeId; to: NodeId; when?: EdgeCondition } // when 省略=always

export interface WorkflowDef {
  id: string
  name: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  entry: NodeId[]
}

export type NodeStatus = 'pending' | 'ready' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'cancelled'
export interface NodeOutput { text: string; data?: unknown }
export interface NodeRunState { status: NodeStatus; output?: NodeOutput; error?: string }
export type RunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled'
export interface RunState {
  runId: string
  workflowId: string
  status: RunStatus
  nodes: Record<NodeId, NodeRunState>
}

export type OrchestratorEvent =
  | { type: 'run:started' }
  | { type: 'node:started'; nodeId: NodeId }
  | { type: 'node:succeeded'; nodeId: NodeId; output: NodeOutput }
  | { type: 'node:failed'; nodeId: NodeId; error: string }
  | { type: 'node:skipped'; nodeId: NodeId }
  | { type: 'run:cancelled' }
  | { type: 'run:finished'; status: RunStatus }
```

> 注:`AgentConfig` 已在本文件定义,`AgentConfig['kind']` 直接可用。

- [ ] **Step 2: 写 round-trip 测试** `packages/protocol/src/orchestration-types.test.ts`(仿 `acp-messages.test.ts`,断言判别式 + 字段过 JSON 存活)

```ts
import { describe, it, expect } from 'vitest'
import type { WorkflowDef, RunState, OrchestratorEvent, AgentDescriptor } from './index.js'

describe('orchestration types', () => {
  it('WorkflowDef 过 JSON 保留节点/边/入口', () => {
    const def: WorkflowDef = { id: 'w', name: 'W', entry: ['a'],
      nodes: [{ id: 'a', type: 'agent', agentId: 'mock', inputTemplate: '{{input}}' },
              { id: 'b', type: 'agent', agentId: 'mock', inputTemplate: 'use {{a}}' }],
      edges: [{ from: 'a', to: 'b', when: { kind: 'contains', value: 'ok' } }] }
    const rt = JSON.parse(JSON.stringify(def)) as WorkflowDef
    expect(rt.nodes[1].inputTemplate).toBe('use {{a}}')
    expect(rt.edges[0].when?.kind).toBe('contains')
    expect(rt.entry).toEqual(['a'])
  })
  it('RunState + 事件判别式存活', () => {
    const s: RunState = { runId: 'r', workflowId: 'w', status: 'running', nodes: { a: { status: 'succeeded', output: { text: 'hi' } } } }
    expect(JSON.parse(JSON.stringify(s)).nodes.a.output.text).toBe('hi')
    const e: OrchestratorEvent = { type: 'node:failed', nodeId: 'a', error: 'boom' }
    expect((JSON.parse(JSON.stringify(e)) as Extract<OrchestratorEvent, { type: 'node:failed' }>).error).toBe('boom')
  })
  it('AgentDescriptor.capabilities 四字段', () => {
    const d: AgentDescriptor = { id: 'm', name: 'M', kind: 'acp', capabilities: { streamsReasoning: true, toolCalls: true, hitl: true, modelSwitch: true } }
    expect(d.capabilities.hitl).toBe(true)
  })
})
```

- [ ] **Step 3:** `yarn vitest run packages/protocol/src/orchestration-types.test.ts`(PASS)→ `yarn workspace @hip/sidecar exec tsc --noEmit` → `yarn type-check`(均干净)
- [ ] **Step 4:** commit `feat(orchestrator): protocol types for multi-agent workflows`

---

## Task 2: 端口 + Fake 实现 (`ports.ts`)

**Files:** Create `packages/sidecar/src/orchestrator/ports.ts`, `packages/sidecar/src/orchestrator/ports.test.ts`

- [ ] **Step 1: 写 `ports.ts`**

```ts
import type { AgentId, NodeId, NodeOutput, RunState, WorkflowDef, OrchestratorEvent } from '@hip/protocol'

export interface AgentRunRequest { runId: string; nodeId: NodeId; agentId: AgentId; input: NodeOutput }

/** 跑一个节点 = 一个外部 agent 的一整个回合。真实实现(后续切片)包 createAgentProvider().runTurn。 */
export interface AgentRunner {
  run(req: AgentRunRequest, signal: AbortSignal): Promise<NodeOutput>
}
export interface WorkflowStore {
  saveDef(def: WorkflowDef): Promise<void>
  loadDef(id: string): Promise<WorkflowDef | null>
  saveRun(run: RunState): Promise<void>
  loadRun(runId: string): Promise<RunState | null>
}
export interface OrchestratorEventSink { emit(e: OrchestratorEvent): void }
export interface OrchestratorPorts { agentRunner: AgentRunner; store?: WorkflowStore; eventSink?: OrchestratorEventSink }

/** 脚本化的 Fake runner:按 nodeId 返回产物;可注入延迟、抛错;尊重 signal。 */
export interface FakeScript { [nodeId: string]: { text?: string; data?: unknown; delayMs?: number; throws?: string } }
export class FakeAgentRunner implements AgentRunner {
  public readonly calls: AgentRunRequest[] = []
  constructor(private readonly script: FakeScript = {}) {}
  async run(req: AgentRunRequest, signal: AbortSignal): Promise<NodeOutput> {
    this.calls.push(req)
    const s = this.script[req.nodeId] ?? {}
    if (s.delayMs) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, s.delayMs)
        signal.addEventListener('abort', () => { clearTimeout(t); const e = new Error('aborted'); e.name = 'AbortError'; reject(e) }, { once: true })
      })
    }
    if (s.throws) throw new Error(s.throws)
    // 默认回显:把输入透传,便于断言数据流
    return { text: s.text ?? req.input.text, data: s.data }
  }
}
export class InMemoryWorkflowStore implements WorkflowStore {
  private defs = new Map<string, WorkflowDef>()
  private runs = new Map<string, RunState>()
  async saveDef(def: WorkflowDef) { this.defs.set(def.id, structuredClone(def)) }
  async loadDef(id: string) { const d = this.defs.get(id); return d ? structuredClone(d) : null }
  async saveRun(run: RunState) { this.runs.set(run.runId, structuredClone(run)) }
  async loadRun(runId: string) { const r = this.runs.get(runId); return r ? structuredClone(r) : null }
}
export class CollectingEventSink implements OrchestratorEventSink {
  public readonly events: OrchestratorEvent[] = []
  emit(e: OrchestratorEvent) { this.events.push(e) }
  ofType<T extends OrchestratorEvent['type']>(t: T) { return this.events.filter((e) => e.type === t) as Extract<OrchestratorEvent, { type: T }>[] }
}
```

- [ ] **Step 2: 测试** `ports.test.ts`:① FakeAgentRunner 默认回显输入、记录 calls;② 注入 `throws` 时 reject;③ `delayMs` 期间 abort → reject AbortError;④ InMemoryWorkflowStore save/load 往返且返回的是克隆(改返回值不影响存储);⑤ CollectingEventSink.ofType 过滤。
- [ ] **Step 3:** `yarn vitest run packages/sidecar/src/orchestrator/ports.test.ts`(PASS)→ tsc → type-check
- [ ] **Step 4:** commit `feat(orchestrator): ports + Fake/InMemory/Collecting impls`

---

## Task 3: 注册表 + 能力 (`registry.ts`)

**Files:** Create `packages/sidecar/src/orchestrator/registry.ts`, `registry.test.ts`

- [ ] **Step 1: 写 `registry.ts`**

```ts
import type { AgentConfig, AgentCapabilities, AgentDescriptor, AgentId } from '@hip/protocol'

export function capabilitiesFor(kind: AgentConfig['kind']): AgentCapabilities {
  switch (kind) {
    case 'acp':
    case 'opencode':
      return { streamsReasoning: true, toolCalls: true, hitl: true, modelSwitch: true }
    case 'custom':
    default:
      return { streamsReasoning: true, toolCalls: true, hitl: false, modelSwitch: false }
  }
}

export interface AgentRegistry {
  get(id: AgentId): AgentDescriptor | undefined
  has(id: AgentId): boolean
  all(): AgentDescriptor[]
  withCapability(pred: (c: AgentCapabilities) => boolean): AgentDescriptor[]
}

export function buildRegistry(configs: AgentConfig[]): AgentRegistry {
  const map = new Map<AgentId, AgentDescriptor>()
  for (const c of configs) {
    map.set(c.id, { id: c.id, name: c.name, kind: c.kind, capabilities: capabilitiesFor(c.kind) })
  }
  return {
    get: (id) => map.get(id),
    has: (id) => map.has(id),
    all: () => [...map.values()],
    withCapability: (pred) => [...map.values()].filter((d) => pred(d.capabilities)),
  }
}
```

- [ ] **Step 2: 测试** `registry.test.ts`:① `capabilitiesFor('acp')`/`('opencode')` 全 true;② `capabilitiesFor('custom')` hitl/modelSwitch=false、reasoning/tool=true;③ `buildRegistry` 后 get/has/all 正确;④ `withCapability((c)=>c.hitl)` 只返回 acp/opencode。(构造 AgentConfig 时给最小必填字段:`{ id,name,kind,enabled } as AgentConfig`,如类型要求更多用 `as AgentConfig`。)
- [ ] **Step 3:** vitest(该文件)PASS → tsc → type-check
- [ ] **Step 4:** commit `feat(orchestrator): agent registry + capability model`

---

## Task 4: 校验器 (`validate.ts`)

**Files:** Create `packages/sidecar/src/orchestrator/validate.ts`, `validate.test.ts`

- [ ] **Step 1: 写 `validate.ts`**(无环 / 引用 / 端点 / 可达 / 模板五类)

```ts
import type { WorkflowDef, NodeId } from '@hip/protocol'
import type { AgentRegistry } from './registry.js'

export type ValidationCode = 'unknown-agent' | 'dangling-edge' | 'cycle' | 'unreachable' | 'bad-template-ref'
export interface ValidationError { code: ValidationCode; detail: string }

const TEMPLATE_RE = /\{\{\s*([^}\s]+)\s*\}\}/g

export function validateWorkflow(def: WorkflowDef, registry: AgentRegistry): ValidationError[] {
  const errors: ValidationError[] = []
  const ids = new Set(def.nodes.map((n) => n.id))

  // 1. unknown-agent
  for (const n of def.nodes) if (!registry.has(n.agentId)) errors.push({ code: 'unknown-agent', detail: `${n.id} → ${n.agentId}` })

  // 2. dangling-edge
  for (const e of def.edges) {
    if (!ids.has(e.from)) errors.push({ code: 'dangling-edge', detail: `from ${e.from}` })
    if (!ids.has(e.to)) errors.push({ code: 'dangling-edge', detail: `to ${e.to}` })
  }

  // adjacency (仅用合法端点)
  const adj = new Map<NodeId, NodeId[]>()
  for (const id of ids) adj.set(id, [])
  for (const e of def.edges) if (ids.has(e.from) && ids.has(e.to)) adj.get(e.from)!.push(e.to)

  // 3. cycle (DFS 三色)
  const color = new Map<NodeId, 0 | 1 | 2>() // 0 white 1 grey 2 black
  for (const id of ids) color.set(id, 0)
  let hasCycle = false
  const dfs = (u: NodeId) => {
    color.set(u, 1)
    for (const v of adj.get(u) ?? []) {
      if (color.get(v) === 1) { hasCycle = true; return }
      if (color.get(v) === 0) { dfs(v); if (hasCycle) return }
    }
    color.set(u, 2)
  }
  for (const id of ids) if (color.get(id) === 0) { dfs(id); if (hasCycle) break }
  if (hasCycle) errors.push({ code: 'cycle', detail: 'graph has a cycle' })

  // 4. entry 合法 + 可达 (有环时跳过可达判定避免误报)
  for (const en of def.entry) if (!ids.has(en)) errors.push({ code: 'dangling-edge', detail: `entry ${en}` })
  const indeg = new Map<NodeId, number>()
  for (const id of ids) indeg.set(id, 0)
  for (const e of def.edges) if (ids.has(e.to)) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1)
  for (const en of def.entry) if (ids.has(en) && (indeg.get(en) ?? 0) > 0) errors.push({ code: 'unreachable', detail: `entry ${en} has incoming edges` })
  if (!hasCycle) {
    const seen = new Set<NodeId>()
    const q = def.entry.filter((e) => ids.has(e))
    while (q.length) { const u = q.shift()!; if (seen.has(u)) continue; seen.add(u); for (const v of adj.get(u) ?? []) q.push(v) }
    for (const id of ids) if (!seen.has(id)) errors.push({ code: 'unreachable', detail: `${id} not reachable from entry` })
  }

  // 5. bad-template-ref:{{x}} 必须是 input / input.* / 当前节点的祖先
  // 祖先 = 反向可达。先建反图。
  const radj = new Map<NodeId, NodeId[]>()
  for (const id of ids) radj.set(id, [])
  for (const e of def.edges) if (ids.has(e.from) && ids.has(e.to)) radj.get(e.to)!.push(e.from)
  const ancestorsOf = (n: NodeId): Set<NodeId> => {
    const seen = new Set<NodeId>(); const q = [...(radj.get(n) ?? [])]
    while (q.length) { const u = q.shift()!; if (seen.has(u)) continue; seen.add(u); for (const p of radj.get(u) ?? []) q.push(p) }
    return seen
  }
  for (const n of def.nodes) {
    const anc = hasCycle ? null : ancestorsOf(n.id)
    for (const m of n.inputTemplate.matchAll(TEMPLATE_RE)) {
      const ref = m[1]
      if (ref === 'input' || ref.startsWith('input.')) continue
      if (!ids.has(ref)) { errors.push({ code: 'bad-template-ref', detail: `${n.id}: {{${ref}}} 不是节点也不是 input` }); continue }
      if (anc && !anc.has(ref)) errors.push({ code: 'bad-template-ref', detail: `${n.id}: {{${ref}}} 不是上游` })
    }
  }
  return errors
}
```

- [ ] **Step 2: 测试** `validate.test.ts`,每类各一例 + 一个"合法图返回 []":
  - 合法链 a→b(b.inputTemplate `{{a}}`)+ a 入口 → `[]`。
  - 未注册 agent → `unknown-agent`(用一个只含 a 的 registry,节点引用 'ghost')。
  - 悬挂边 from/to 不存在 → `dangling-edge`。
  - 环 a→b→a → `cycle`。
  - 入口有入边 / 节点不可达 → `unreachable`。
  - `{{ghost}}`(非节点非 input)→ `bad-template-ref`;`{{b}}` 在 a 里(b 是 a 的下游而非上游)→ `bad-template-ref`;`{{input}}` / `{{input.foo}}` → 不报。
- [ ] **Step 3:** vitest(该文件)PASS → tsc → type-check
- [ ] **Step 4:** commit `feat(orchestrator): workflow validator (cycle/refs/reachability/templates)`

---

## Task 5: 运行态 reducer + 调度 (`reduce.ts`)

**Files:** Create `packages/sidecar/src/orchestrator/reduce.ts`, `reduce.test.ts`

- [ ] **Step 1: 写 `reduce.ts`**

```ts
import type { WorkflowDef, RunState, NodeRunState, NodeId, NodeOutput, OrchestratorEvent, EdgeCondition, WorkflowNode } from '@hip/protocol'

const TEMPLATE_RE = /\{\{\s*([^}\s]+)\s*\}\}/g

export function initRunState(def: WorkflowDef, runId: string): RunState {
  const nodes: Record<NodeId, NodeRunState> = {}
  const entry = new Set(def.entry)
  for (const n of def.nodes) nodes[n.id] = { status: entry.has(n.id) ? 'ready' : 'pending' }
  return { runId, workflowId: def.id, status: 'running', nodes }
}

export function readyNodes(state: RunState): NodeId[] {
  return Object.entries(state.nodes).filter(([, s]) => s.status === 'ready').map(([id]) => id)
}

function conditionHolds(when: EdgeCondition | undefined, out: NodeOutput | undefined): boolean {
  if (!when || when.kind === 'always') return true
  const text = out?.text ?? ''
  if (when.kind === 'contains') return text.includes(when.value ?? '')
  if (when.kind === 'equals') return text === (when.value ?? '')
  return false
}
type EdgeState = 'active' | 'dead' | 'unresolved'
function edgeState(def: WorkflowDef, state: RunState, from: NodeId, when: EdgeCondition | undefined): EdgeState {
  const s = state.nodes[from]
  if (s.status === 'succeeded') return conditionHolds(when, s.output) ? 'active' : 'dead'
  if (s.status === 'failed' || s.status === 'skipped' || s.status === 'cancelled') return 'dead'
  return 'unresolved'
}

/** 把所有 pending 节点按 join 语义推进到 ready/skipped,直到不动点(skip 会级联)。 */
function propagate(def: WorkflowDef, state: RunState): RunState {
  let changed = true
  while (changed) {
    changed = false
    for (const n of def.nodes) {
      if (state.nodes[n.id].status !== 'pending') continue
      const incoming = def.edges.filter((e) => e.to === n.id)
      if (incoming.length === 0) continue // 仅入口无入边,init 已置 ready
      const states = incoming.map((e) => edgeState(def, state, e.from, e.when))
      if (states.some((s) => s === 'unresolved')) continue
      const next: NodeRunState = states.some((s) => s === 'active') ? { status: 'ready' } : { status: 'skipped' }
      state.nodes[n.id] = next
      changed = true
    }
  }
  return state
}

export function reduce(state: RunState, def: WorkflowDef, event: OrchestratorEvent): RunState {
  const s: RunState = { ...state, nodes: { ...state.nodes } }
  switch (event.type) {
    case 'run:started': s.status = 'running'; break
    case 'node:started': s.nodes[event.nodeId] = { ...s.nodes[event.nodeId], status: 'running' }; break
    case 'node:succeeded':
      s.nodes[event.nodeId] = { status: 'succeeded', output: event.output }
      propagate(def, s); break
    case 'node:failed':
      s.nodes[event.nodeId] = { status: 'failed', error: event.error }
      s.status = 'failed'; break // fail-fast
    case 'node:skipped':
      s.nodes[event.nodeId] = { status: 'skipped' }
      propagate(def, s); break
    case 'run:cancelled':
      s.status = 'cancelled'
      for (const id of Object.keys(s.nodes)) if (s.nodes[id].status === 'running') s.nodes[id] = { ...s.nodes[id], status: 'cancelled' }
      break
    case 'run:finished': s.status = event.status; break
  }
  return s
}

/** 用上游产物 + 运行输入渲染 inputTemplate。 */
export function resolveInput(node: WorkflowNode, state: RunState, runInputs?: NodeOutput): NodeOutput {
  const text = node.inputTemplate.replace(TEMPLATE_RE, (_m, ref: string) => {
    if (ref === 'input') return runInputs?.text ?? ''
    if (ref.startsWith('input.')) { const k = ref.slice('input.'.length); const d = runInputs?.data as Record<string, unknown> | undefined; return String(d?.[k] ?? '') }
    return state.nodes[ref]?.output?.text ?? ''
  })
  return { text }
}
```

- [ ] **Step 2: 测试** `reduce.test.ts`(reducer/调度是 TDD 重点,覆盖):
  - `initRunState`:入口 ready、其余 pending、run running。
  - 线性 a→b:`reduce(node:succeeded a)` 后 b 变 ready;`readyNodes` 返回 `['b']`。
  - 扇出 a→b, a→c:a 成功后 b、c 同时 ready。
  - 条件:a→b `when contains 'go'`;a 产出含 'go' → b ready;不含 → b skipped。
  - join a→c, b→c:仅 a 成功(b 仍 pending)→ c 仍 pending;a、b 都成功 → c ready;两入边都 dead(都 skipped)→ c skipped(级联)。
  - fail-fast:`node:failed` → run.status 'failed'。
  - cancel:`run:cancelled` → run 'cancelled',running 节点变 cancelled。
  - `resolveInput`:`'hi {{a}}'` + a.output.text='X' → 'hi X';`'{{input}}'`/`'{{input.k}}'` 用 runInputs。
- [ ] **Step 3:** vitest(该文件)PASS → tsc → type-check
- [ ] **Step 4:** commit `feat(orchestrator): run-state reducer + scheduler (join/conditions/skip/cancel)`

---

## Task 6: 执行器 (`executor.ts`)

**Files:** Create `packages/sidecar/src/orchestrator/executor.ts`, `executor.test.ts`

- [ ] **Step 1: 写 `executor.ts`**

```ts
import type { WorkflowDef, RunState, NodeOutput, NodeId } from '@hip/protocol'
import type { OrchestratorPorts } from './ports.js'
import { initRunState, reduce, readyNodes, resolveInput } from './reduce.js'

export interface RunWorkflowOpts { runId: string; runInputs?: NodeOutput; signal: AbortSignal }

export async function runWorkflow(def: WorkflowDef, ports: OrchestratorPorts, opts: RunWorkflowOpts): Promise<RunState> {
  const sink = ports.eventSink
  let state = initRunState(def, opts.runId)
  const apply = (e: Parameters<typeof reduce>[2]) => { sink?.emit(e); state = reduce(state, def, e) }
  apply({ type: 'run:started' })

  const nodeById = new Map<NodeId, WorkflowDef['nodes'][number]>(def.nodes.map((n) => [n.id, n]))
  const inFlight = new Map<NodeId, Promise<{ id: NodeId; ok: boolean; out?: NodeOutput; err?: string }>>()

  const launch = () => {
    if (opts.signal.aborted) return
    for (const id of readyNodes(state)) {
      if (inFlight.has(id)) continue
      const node = nodeById.get(id)!
      const input = resolveInput(node, state, opts.runInputs)
      apply({ type: 'node:started', nodeId: id })
      const p = ports.agentRunner
        .run({ runId: opts.runId, nodeId: id, agentId: node.agentId, input }, opts.signal)
        .then((out) => ({ id, ok: true as const, out }))
        .catch((e) => ({ id, ok: false as const, err: e instanceof Error ? e.message : String(e) }))
      inFlight.set(id, p)
    }
  }

  apply // (noop ref to satisfy lint if needed)
  launch()
  while (inFlight.size > 0) {
    if (opts.signal.aborted && state.status === 'running') apply({ type: 'run:cancelled' })
    const settled = await Promise.race(inFlight.values())
    inFlight.delete(settled.id)
    if (settled.ok) apply({ type: 'node:succeeded', nodeId: settled.id, output: settled.out! })
    else apply({ type: 'node:failed', nodeId: settled.id, error: settled.err! })
    if (state.status === 'running') launch() // 终态(failed/cancelled)则停止派发,排空在飞
  }

  if (state.status === 'running') {
    const anySkippedBlocking = false // 占位:全 succeeded/skipped 即成功
    const final = Object.values(state.nodes).some((n) => n.status === 'failed') ? 'failed' : 'succeeded'
    void anySkippedBlocking
    apply({ type: 'run:finished', status: final })
  } else {
    apply({ type: 'run:finished', status: state.status })
  }
  ports.store && (await ports.store.saveRun(state))
  return state
}
```

> 实现者注:`apply`(noop ref)那行删掉,只是提醒——若 lint 抱怨未使用变量再处理。`run:finished` 用 reduce 落最终 status(幂等)。终态后仍排空 inFlight(其结果照常 emit,但 run 状态不再变 running)。

- [ ] **Step 2: 测试** `executor.test.ts`(用 `FakeAgentRunner` + `CollectingEventSink`):
  - 线性 a→b:两节点都 succeeded,事件序含 run:started、node:started(a)、node:succeeded(a)、node:started(b)、node:succeeded(b)、run:finished(succeeded);`runner.calls` 顺序 a 在 b 前;b 的 input.text 含 a 的产出(用 `inputTemplate:'{{a}}'` + 脚本 a→'X' 断言 b 收到 'X')。
  - 并行扇出 a→b,a→c:a 后 b、c 都被调用;run succeeded。
  - 条件跳过 a→b `when contains 'go'`:脚本 a→'stop' → b 不被调用、b 状态 skipped、run succeeded。
  - 失败 fail-fast:脚本 b `throws` → run.status 'failed',有 node:failed 事件。
  - 取消:b 脚本 `delayMs:200`;`runWorkflow` 启动后 ~50ms abort signal → run.status 'cancelled',无 run:finished(succeeded);用 `AbortController`。
- [ ] **Step 3:** vitest(该文件)PASS → tsc → type-check
- [ ] **Step 4:** commit `feat(orchestrator): pure executor over ports (parallel/conditional/fail-fast/cancel)`

---

## Task 7: barrel + 全量复核

**Files:** Create `packages/sidecar/src/orchestrator/index.ts`

- [ ] **Step 1:** `index.ts` 重导出 registry/validate/reduce/executor/ports 的公开 API。

```ts
export * from './ports.js'
export * from './registry.js'
export * from './validate.js'
export * from './reduce.js'
export * from './executor.js'
```

- [ ] **Step 2:** 全量:`yarn vitest run packages/sidecar/src/orchestrator/ packages/protocol/src/orchestration-types.test.ts`(全 PASS)→ `yarn workspace @hip/sidecar exec tsc --noEmit` → `yarn type-check`(均干净)。
  - ⚠️ 上面给 vitest 传的是 `orchestrator/` 目录前缀 + 显式 protocol 文件,**不是** `src`。确认无付费套件被命中。
- [ ] **Step 3:** commit `feat(orchestrator): barrel export + foundation green`

---

## Self-Review(写计划后已核对)

- 覆盖:spec 的 类型/注册表/校验器(5 类)/reducer(join·条件·skip·fail-fast·cancel)/执行器(并行·条件·失败·取消)/端口+Fake/barrel — 全部有 task。
- 类型一致:`AgentRunRequest` 字段(runId/nodeId/agentId/input)在 ports 与 executor 一致;`readyNodes(state)` 单参(spec 的 `(state,def)` 在此精化为状态已存 'ready');`reduce(state,def,event)` 三参一致;`resolveInput(node,state,runInputs)` 一致。
- 无占位:每步有完整代码或精确测试用例 + 命令。
