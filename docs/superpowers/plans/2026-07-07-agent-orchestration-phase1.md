# Agent 编排升级 — Phase 1 详细实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一三层编排模型，增加耐久执行，支持递归子代理，使 DAG 编排器成为主循环的一等公民。

**Architecture:** 在现有 `orchestrator/` 和 `session/` 基础上增量叠加。不重写 graph.ts，而是增加 `dag` 模式路由分支。复用现有 SQLite 持久化层实现 checkpointing。

**Tech Stack:** TypeScript, LangGraph, better-sqlite3, Vitest

**依赖:** 主计划文档 `docs/agent-orchestration-plan.md`

## Global Constraints

- TypeScript strict mode，所有新增代码必须有完整类型标注
- 测试框架：Vitest，每个模块至少覆盖 happy path + 2 error paths
- 持久化：复用 `packages/sidecar/src/persistence/sqlite.ts` 的单例 Database 实例
- **不引入新的 npm 依赖**
- 向后兼容：现有 `fast` 模式行为不变，所有现有测试必须继续通过
- Commit 粒度：每个 Task 至少一个独立 commit
- 接口变更必须在 protocol 包中先定义，sidecar 实现，前端最后适配

---

## File Map

```
packages/protocol/src/
  index.ts                          [MODIFY] re-export orchestration-types, SessionConfig.orchMode
  orchestration-types.ts            [CREATE]  OrchestrationMode, extended WorkflowNode union

packages/sidecar/src/
  orchestrator/
    reduce.ts                       [MODIFY] handle new node types (tool/gate/parallel/human)
    reduce.test.ts                  [MODIFY] test new node type transitions
    executor.ts                     [MODIFY] integrate DurableExecutor checkpoint hooks
    durable-executor.ts             [CREATE] DurableExecutor class
    durable-executor.test.ts        [CREATE] durability + resume tests
    verification-gate.ts            [CREATE] VerificationGate interface (defined, impl in Phase 2)
    circuit-breaker.ts              [CREATE] CircuitBreaker (defined, impl in Phase 2)

  session/
    session.ts                      [MODIFY] orchMode dispatch in runTurn
    session-manager.ts              [MODIFY] pass orchMode from ClientMessage
    subagent.ts                     [MODIFY] accept maxDepth, filter task tool at max depth
    tools/
      subagent.ts                   [MODIFY] depth tracking for task/dispatch_agent
      index.ts                      [MODIFY] filter tools by depth
    loop-control.ts                 [MODIFY] add MAX_DEPTH constant
    workflow-runner.ts              [MODIFY] use DurableExecutor

  persistence/
    schema.ts                       [MODIFY] add workflow_runs/events/defs DDL
    workflow-store.ts               [CREATE] SqliteWorkflowStore implementation
    workflow-store.test.ts          [CREATE] persistence tests

src/
  components/chat/
    ModelPicker.tsx                  [MODIFY] add orchMode toggle (fast/dag)
  domain/
    sessionStore.ts                 [MODIFY] handle orchMode in SessionConfig
    sessionService.ts               [MODIFY] pass orchMode in session:create
```

---

### Task 1.1: 定义 OrchestrationMode 与扩展 WorkflowNode 类型

**目标:** 在 protocol 层定义模式切换和扩展节点类型，为后续所有实现提供类型基础。

**Files:**
- Create: `packages/protocol/src/orchestration-types.ts`
- Modify: `packages/protocol/src/index.ts`

**Interfaces:**
- Produces:
  - `OrchestrationMode = 'fast' | 'dag'`
  - `WorkflowNode = AgentNode | ToolNode | ParallelNode | GateNode | HumanNode`
  - `MergeStrategy = 'all' | 'any' | 'vote'`
  - `VerificationGateKind = 'typecheck' | 'lint' | 'test' | 'script'`

- [ ] **Step 1: 编写类型定义文件**

```typescript
// packages/protocol/src/orchestration-types.ts

import type { NodeId, AgentId } from './index.js'

// ── 编排模式 ──
/** Per-session orchestration mode. 'fast' uses the existing single-agent
 *  StateGraph loop. 'dag' runs the workflow orchestrator. */
export type OrchestrationMode = 'fast' | 'dag'

// ── 并行合并策略 ──
/** How a ParallelNode resolves its children's results. */
export type MergeStrategy = 'all' | 'any' | 'vote'

// ── 验证门控类型 ──
/** Built-in verification gate kinds. 'script' runs an arbitrary shell command. */
export type VerificationGateKind = 'typecheck' | 'lint' | 'test' | 'script'

// ── 扩展的工作流节点类型 ──

/** Execute a specific tool directly (not via LLM agent). */
export interface ToolNode {
  type: 'tool'
  id: NodeId
  toolName: string
  /** Static input; supports {{nodeId}} / {{input}} templates. */
  inputTemplate: string
}

/** Fan-out sub-DAGs that execute in parallel. */
export interface ParallelNode {
  type: 'parallel'
  id: NodeId
  nodes: WorkflowNode[]
  mergeStrategy: MergeStrategy
}

/** A verification gate that must pass before downstream nodes execute. */
export interface GateNode {
  type: 'gate'
  id: NodeId
  gateKind: VerificationGateKind
  /** Gate-specific config (e.g. test command, lint rules). */
  config?: Record<string, unknown>
}

/** Pause execution and require human input before continuing. */
export interface HumanNode {
  type: 'human'
  id: NodeId
  /** The question to present to the user. */
  question: string
  /** Optional timeout in ms. After timeout, the node is skipped. */
  timeoutMs?: number
}

/** The full workflow node union. AgentNode is imported from index.ts. */
export type WorkflowNode =
  | import('./index.js').AgentNode
  | ToolNode
  | ParallelNode
  | GateNode
  | HumanNode
```

- [ ] **Step 2: 运行 protocol 包类型检查**

```bash
cd packages/protocol && npx tsc --noEmit
```
Expected: no errors in protocol package.

- [ ] **Step 3: 在 index.ts 中追加 orchMode 和 re-export**

在 `SessionConfig` 接口中（约 line 40，`surface` 之后）追加：

```typescript
// packages/protocol/src/index.ts, SessionConfig 接口内:
/** Orchestration mode: 'fast' (default, existing single-agent loop)
 *  or 'dag' (DAG workflow via the orchestrator). */
orchMode?: OrchestrationMode
```

在文件末尾（`HipConfig` 接口之后）追加 re-export：

```typescript
// packages/protocol/src/index.ts 文件末尾:
export * from './orchestration-types.js'
```

- [ ] **Step 4: 运行全仓类型检查**

```bash
yarn tsc 2>&1 | head -30
```
Expected: no new errors attributable to this change（现有错误不计）.

- [ ] **Step 5: 编写类型测试**

```typescript
// packages/protocol/src/orchestration-types.test.ts
import { describe, it, expect } from 'vitest'

describe('OrchestrationMode', () => {
  it('accepts "fast"', () => {
    const mode: import('./orchestration-types.js').OrchestrationMode = 'fast'
    expect(mode).toBe('fast')
  })

  it('accepts "dag"', () => {
    const mode: import('./orchestration-types.js').OrchestrationMode = 'dag'
    expect(mode).toBe('dag')
  })
})

describe('WorkflowNode', () => {
  it('ToolNode has correct shape', () => {
    const node: import('./orchestration-types.js').ToolNode = {
      type: 'tool',
      id: 'n1',
      toolName: 'read_file',
      inputTemplate: '{{input}}',
    }
    expect(node.type).toBe('tool')
  })

  it('ParallelNode with vote merge', () => {
    const node: import('./orchestration-types.js').ParallelNode = {
      type: 'parallel',
      id: 'n1',
      nodes: [],
      mergeStrategy: 'vote',
    }
    expect(node.mergeStrategy).toBe('vote')
  })

  it('GateNode with lint config', () => {
    const node: import('./orchestration-types.js').GateNode = {
      type: 'gate',
      id: 'n1',
      gateKind: 'lint',
      config: { command: 'eslint .' },
    }
    expect(node.gateKind).toBe('lint')
  })

  it('HumanNode with timeout', () => {
    const node: import('./orchestration-types.js').HumanNode = {
      type: 'human',
      id: 'n1',
      question: 'Approve changes?',
      timeoutMs: 30000,
    }
    expect(node.timeoutMs).toBe(30000)
  })
})
```

运行: `yarn vitest run packages/protocol/src/orchestration-types.test.ts`
Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
git add packages/protocol/src/orchestration-types.ts \
        packages/protocol/src/orchestration-types.test.ts \
        packages/protocol/src/index.ts
git commit -m "feat(protocol): add OrchestrationMode and extended WorkflowNode types

- OrchestrationMode: 'fast' | 'dag' for per-session mode selection
- New WorkflowNode variants: ToolNode, ParallelNode, GateNode, HumanNode
- MergeStrategy: 'all' | 'any' | 'vote' for parallel fan-out
- VerificationGateKind: 'typecheck' | 'lint' | 'test' | 'script'
- orchMode field on SessionConfig
- Re-export from index.ts

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 1.2: 扩展 reduce.ts 状态机支持新节点类型

**目标:** `reduce()` 和 `propagate()` 正确处理 tool/gate/parallel/human 节点的状态转换。

**Files:**
- Modify: `packages/sidecar/src/orchestrator/reduce.ts`
- Modify: `packages/sidecar/src/orchestrator/reduce.test.ts`

**Interfaces:**
- Consumes: `WorkflowNode`, `MergeStrategy` from `@hip/protocol`
- Produces: 扩展的 `initRunState`, `propagate`, `reduce`

- [ ] **Step 1: 扩展 `initRunState` 递归初始化 ParallelNode 子节点**

```typescript
// 在 reduce.ts 的 initRunState 函数中，替换现有实现:

import type { WorkflowNode, ParallelNode } from '@hip/protocol'

export function initRunState(def: WorkflowDef, runId: string): RunState {
  const nodes: Record<NodeId, NodeRunState> = {}
  const entry = new Set(def.entry)

  const initNode = (n: WorkflowNode) => {
    if (n.type === 'parallel') {
      // 递归初始化子节点
      for (const child of n.nodes) initNode(child)
    }
    nodes[n.id] = { status: entry.has(n.id) ? 'ready' : 'pending' }
  }

  for (const n of def.nodes) initNode(n)
  return { runId, workflowId: def.id, status: 'running', nodes }
}
```

- [ ] **Step 2: 实现 `propagate` 中的 ParallelNode merge 逻辑**

```typescript
// 在 propagate() 函数的循环中，追加 ParallelNode 处理:

function propagate(def: WorkflowDef, state: RunState): RunState {
  let changed = true
  while (changed) {
    changed = false
    for (const n of def.nodes) {
      if (state.nodes[n.id].status !== 'pending') continue

      if (n.type === 'parallel') {
        const parNode = n as ParallelNode
        const childIds = collectChildIds(parNode)
        const statuses = childIds.map(id => state.nodes[id]?.status ?? 'pending')
        const allResolved = statuses.every(s =>
          ['succeeded', 'failed', 'skipped', 'cancelled'].includes(s))

        if (!allResolved) continue

        const next = resolveParallelMerge(parNode.mergeStrategy, statuses)
        state.nodes[n.id] = next
        changed = true
        continue
      }

      // 原有逻辑: 基于 incoming edges 的 join 语义
      const incoming = def.edges.filter((e) => e.to === n.id)
      if (incoming.length === 0) continue
      const states = incoming.map((e) => edgeState(def, state, e.from, e.when))
      if (states.some((s) => s === 'unresolved')) continue
      const next: NodeRunState = states.some((s) => s === 'active')
        ? { status: 'ready' }
        : { status: 'skipped' }
      state.nodes[n.id] = next
      changed = true
    }
  }
  return state
}

/** 收集 ParallelNode 所有子孙节点的 id。 */
function collectChildIds(n: ParallelNode): NodeId[] {
  const ids: NodeId[] = []
  for (const child of n.nodes) {
    ids.push(child.id)
    if (child.type === 'parallel') ids.push(...collectChildIds(child))
  }
  return ids
}

/** 根据 merge 策略决定 ParallelNode 的终态。 */
function resolveParallelMerge(
  strategy: MergeStrategy,
  childStatuses: string[]
): NodeRunState {
  const succeeded = childStatuses.filter(s => s === 'succeeded').length
  const total = childStatuses.length

  switch (strategy) {
    case 'all':
      return succeeded === total
        ? { status: 'succeeded' }
        : { status: 'failed' }
    case 'any':
      return succeeded > 0
        ? { status: 'succeeded' }
        : { status: 'failed' }
    case 'vote':
      return succeeded > total / 2
        ? { status: 'succeeded' }
        : { status: 'failed' }
  }
}
```

- [ ] **Step 3: 编写状态机测试**

```typescript
// packages/sidecar/src/orchestrator/reduce.test.ts (追加)

import { describe, it, expect } from 'vitest'
import { initRunState, reduce, readyNodes, resolveInput } from './reduce.js'
import type { WorkflowDef, WorkflowNode } from '@hip/protocol'

describe('reduce with extended node types', () => {
  const makeDef = (nodes: WorkflowNode[]): WorkflowDef => ({
    id: 'test-wf',
    name: 'test',
    nodes,
    edges: [],
    entry: nodes.filter(n => n.type !== 'parallel').map(n => n.id),
  })

  it('ParallelNode with merge=all succeeds when all children succeed', () => {
    const def = makeDef([
      { type: 'parallel', id: 'p1', nodes: [
        { type: 'agent', id: 'a1', agentId: 'x', inputTemplate: '' },
        { type: 'agent', id: 'a2', agentId: 'x', inputTemplate: '' },
      ], mergeStrategy: 'all' },
    ])
    let state = initRunState(def, 'r1')
    // 子节点初始为 pending（因为不在 entry 中且无入边）
    // 需要先手动将它们设置为 ready 然后 succeeded
    state.nodes['a1'] = { status: 'succeeded', output: { text: 'ok' } }
    state.nodes['a2'] = { status: 'succeeded', output: { text: 'ok' } }

    // propagate 应该把 p1 设置为 succeeded
    state = reduce(state, def, { type: 'node:succeeded', nodeId: 'a1', output: { text: 'ok' } })
    state = reduce(state, def, { type: 'node:succeeded', nodeId: 'a2', output: { text: 'ok' } })
    expect(state.nodes['p1'].status).toBe('succeeded')
  })

  it('ParallelNode with merge=any succeeds when one child succeeds', () => {
    const def = makeDef([
      { type: 'parallel', id: 'p1', nodes: [
        { type: 'agent', id: 'a1', agentId: 'x', inputTemplate: '' },
        { type: 'agent', id: 'a2', agentId: 'x', inputTemplate: '' },
      ], mergeStrategy: 'any' },
    ])
    let state = initRunState(def, 'r1')
    state.nodes['a1'] = { status: 'succeeded', output: { text: 'ok' } }
    state.nodes['a2'] = { status: 'failed', error: 'boom' }

    state = reduce(state, def, { type: 'node:succeeded', nodeId: 'a1', output: { text: 'ok' } })
    state = reduce(state, def, { type: 'node:failed', nodeId: 'a2', error: 'boom' })
    expect(state.nodes['p1'].status).toBe('succeeded')
  })

  it('ParallelNode with merge=vote fails when < majority succeed', () => {
    const def = makeDef([
      { type: 'parallel', id: 'p1', nodes: [
        { type: 'agent', id: 'a1', agentId: 'x', inputTemplate: '' },
        { type: 'agent', id: 'a2', agentId: 'x', inputTemplate: '' },
        { type: 'agent', id: 'a3', agentId: 'x', inputTemplate: '' },
      ], mergeStrategy: 'vote' },
    ])
    let state = initRunState(def, 'r1')
    state.nodes['a1'] = { status: 'succeeded', output: { text: 'ok' } }
    state.nodes['a2'] = { status: 'failed', error: 'boom' }
    state.nodes['a3'] = { status: 'failed', error: 'boom' }

    state = reduce(state, def, { type: 'node:succeeded', nodeId: 'a1', output: { text: 'ok' } })
    state = reduce(state, def, { type: 'node:failed', nodeId: 'a2', error: 'boom' })
    state = reduce(state, def, { type: 'node:failed', nodeId: 'a3', error: 'boom' })
    expect(state.nodes['p1'].status).toBe('failed')
  })

  it('node:failed on any node triggers fail-fast for the run', () => {
    const def = makeDef([
      { type: 'agent', id: 'a1', agentId: 'x', inputTemplate: '' },
    ])
    let state = initRunState(def, 'r1')
    state = reduce(state, def, { type: 'run:started' })
    state = reduce(state, def, { type: 'node:started', nodeId: 'a1' })
    state = reduce(state, def, { type: 'node:failed', nodeId: 'a1', error: 'test error' })
    expect(state.status).toBe('failed')
    expect(state.nodes['a1'].status).toBe('failed')
    expect(state.nodes['a1'].error).toBe('test error')
  })

  it('run:cancelled marks all running nodes as cancelled', () => {
    const def = makeDef([
      { type: 'agent', id: 'a1', agentId: 'x', inputTemplate: '' },
      { type: 'agent', id: 'a2', agentId: 'x', inputTemplate: '' },
    ])
    let state = initRunState(def, 'r1')
    state = reduce(state, def, { type: 'run:started' })
    state.nodes['a1'] = { status: 'running' }
    state.nodes['a2'] = { status: 'running' }
    state = reduce(state, def, { type: 'run:cancelled' })
    expect(state.status).toBe('cancelled')
    expect(state.nodes['a1'].status).toBe('cancelled')
    expect(state.nodes['a2'].status).toBe('cancelled')
  })
})
```

- [ ] **Step 4: 运行测试**

```bash
yarn vitest run packages/sidecar/src/orchestrator/reduce.test.ts
```
Expected: all tests pass（包括新增和已有）.

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/orchestrator/reduce.ts \
        packages/sidecar/src/orchestrator/reduce.test.ts
git commit -m "feat(orchestrator): extend reduce state machine for new node types

- ParallelNode propagation with merge strategies (all/any/vote)
- collectChildIds + resolveParallelMerge helpers
- GateNode and HumanNode pass-through in propagate
- Fail-fast: node:failed sets run.status='failed'
- run:cancelled marks all running nodes cancelled

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 1.3: SQLite WorkflowStore + DurableExecutor

**目标:** 每个 `reduce()` 事件落盘，崩溃后可重放恢复。

**Files:**
- Modify: `packages/sidecar/src/persistence/schema.ts`
- Create: `packages/sidecar/src/persistence/workflow-store.ts`
- Create: `packages/sidecar/src/persistence/workflow-store.test.ts`
- Create: `packages/sidecar/src/orchestrator/durable-executor.ts`
- Create: `packages/sidecar/src/orchestrator/durable-executor.test.ts`

**Interfaces:**
- Consumes: `Database` from `better-sqlite3`, `WorkflowStore` from `ports.ts`
- Produces:
  - `SqliteWorkflowStore` implements `WorkflowStore` + `appendEvent` + `replayEvents`
  - `DurableExecutor.runWorkflow(def, ports, opts): Promise<RunState>`
  - `DurableExecutor.resumeWorkflow(runId, ports, signal): Promise<RunState>`

- [ ] **Step 1: 追加 DDL 到 schema.ts**

```typescript
// packages/sidecar/src/persistence/schema.ts 文件末尾追加:

export const WORKFLOW_DEFS_DDL = `
CREATE TABLE IF NOT EXISTS workflow_defs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  def_json TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
)`

export const WORKFLOW_RUNS_DDL = `
CREATE TABLE IF NOT EXISTS workflow_runs (
  run_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflow_defs(id),
  status TEXT NOT NULL DEFAULT 'running',
  state_json TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
)`

export const WORKFLOW_EVENTS_DDL = `
CREATE TABLE IF NOT EXISTS workflow_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES workflow_runs(run_id),
  event_json TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
)`

/** All DDL statements for the workflow subsystem. */
export const WORKFLOW_DDL = [
  WORKFLOW_DEFS_DDL,
  WORKFLOW_RUNS_DDL,
  WORKFLOW_EVENTS_DDL,
]
```

- [ ] **Step 2: 确保 main.ts 在数据库 open 后执行 WORKFLOW_DDL**

在 `packages/sidecar/src/main.ts` 中，`openDatabase(dbPath)` 调用之后、创建 `SessionStore` 之前追加：

```typescript
// packages/sidecar/src/main.ts
import { WORKFLOW_DDL } from './persistence/schema.js'

// ... existing code ...
const db = openDatabase(dbPath)

// 确保 workflow 表存在
for (const ddl of WORKFLOW_DDL) {
  db.exec(ddl)
}
```

- [ ] **Step 3: 实现 SqliteWorkflowStore**

```typescript
// packages/sidecar/src/persistence/workflow-store.ts

import type Database from 'better-sqlite3'
import type { WorkflowDef, RunState, OrchestratorEvent } from '@hip/protocol'
import type { WorkflowStore } from '../orchestrator/ports.js'

export class SqliteWorkflowStore implements WorkflowStore {
  private insertDef: Database.Statement
  private selectDef: Database.Statement
  private upsertRun: Database.Statement
  private selectRun: Database.Statement
  private insertEvent: Database.Statement
  private selectEvents: Database.Statement

  constructor(private db: Database) {
    this.insertDef = db.prepare(
      `INSERT OR REPLACE INTO workflow_defs (id, name, def_json) VALUES (?, ?, ?)`
    )
    this.selectDef = db.prepare(
      `SELECT def_json FROM workflow_defs WHERE id = ?`
    )
    this.upsertRun = db.prepare(
      `INSERT OR REPLACE INTO workflow_runs
       (run_id, workflow_id, status, state_json, updated_at)
       VALUES (?, ?, ?, ?, unixepoch())`
    )
    this.selectRun = db.prepare(
      `SELECT state_json, status FROM workflow_runs WHERE run_id = ?`
    )
    this.insertEvent = db.prepare(
      `INSERT INTO workflow_events (run_id, event_json) VALUES (?, ?)`
    )
    this.selectEvents = db.prepare(
      `SELECT event_json FROM workflow_events WHERE run_id = ? ORDER BY id`
    )
  }

  async saveDef(def: WorkflowDef): Promise<void> {
    this.insertDef.run(def.id, def.name, JSON.stringify(def))
  }

  async loadDef(id: string): Promise<WorkflowDef | null> {
    const row = this.selectDef.get(id) as { def_json: string } | undefined
    return row ? (JSON.parse(row.def_json) as WorkflowDef) : null
  }

  async saveRun(run: RunState): Promise<void> {
    this.upsertRun.run(run.runId, run.workflowId, run.status, JSON.stringify(run))
  }

  async loadRun(runId: string): Promise<RunState | null> {
    const row = this.selectRun.get(runId) as
      | { state_json: string; status: string }
      | undefined
    if (!row) return null
    return JSON.parse(row.state_json) as RunState
  }

  /** Append one event to the event log. Called after every reduce() transition. */
  appendEvent(runId: string, event: OrchestratorEvent): void {
    this.insertEvent.run(runId, JSON.stringify(event))
  }

  /** Replay all events for a run in insertion order. */
  replayEvents(runId: string): OrchestratorEvent[] {
    const rows = this.selectEvents.all(runId) as { event_json: string }[]
    return rows.map(r => JSON.parse(r.event_json) as OrchestratorEvent)
  }

  /** Delete all data for a run (cleanup after finalization). */
  deleteRun(runId: string): void {
    this.db.prepare(`DELETE FROM workflow_events WHERE run_id = ?`).run(runId)
    this.db.prepare(`DELETE FROM workflow_runs WHERE run_id = ?`).run(runId)
  }
}
```

- [ ] **Step 4: 编写 WorkflowStore 测试**

```typescript
// packages/sidecar/src/persistence/workflow-store.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { SqliteWorkflowStore } from './workflow-store.js'
import { WORKFLOW_DDL } from './schema.js'
import type { WorkflowDef, OrchestratorEvent } from '@hip/protocol'

function createTestDb(): Database {
  const db = new Database(':memory:')
  for (const ddl of WORKFLOW_DDL) db.exec(ddl)
  return db
}

const sampleDef: WorkflowDef = {
  id: 'wf-1',
  name: 'Test Workflow',
  nodes: [{ type: 'agent', id: 'n1', agentId: 'a1', inputTemplate: 'hello' }],
  edges: [],
  entry: ['n1'],
}

describe('SqliteWorkflowStore', () => {
  let db: Database
  let store: SqliteWorkflowStore

  beforeEach(() => {
    db = createTestDb()
    store = new SqliteWorkflowStore(db)
  })

  afterEach(() => db.close())

  it('saves and loads a workflow definition', async () => {
    await store.saveDef(sampleDef)
    const loaded = await store.loadDef('wf-1')
    expect(loaded).toEqual(sampleDef)
  })

  it('returns null for unknown def', async () => {
    const loaded = await store.loadDef('nonexistent')
    expect(loaded).toBeNull()
  })

  it('saves run state and loads it back', async () => {
    const state = {
      runId: 'r1',
      workflowId: 'wf-1',
      status: 'running' as const,
      nodes: { n1: { status: 'ready' as const } },
    }
    await store.saveRun(state)
    const loaded = await store.loadRun('r1')
    expect(loaded).toEqual(state)
  })

  it('appendEvent and replayEvents preserve order', () => {
    const events: OrchestratorEvent[] = [
      { type: 'run:started' },
      { type: 'node:started', nodeId: 'n1' },
      { type: 'node:succeeded', nodeId: 'n1', output: { text: 'done' } },
      { type: 'run:finished', status: 'succeeded' },
    ]
    for (const e of events) store.appendEvent('r1', e)
    const replayed = store.replayEvents('r1')
    expect(replayed).toEqual(events)
  })

  it('deleteRun removes all run data', () => {
    store.appendEvent('r1', { type: 'run:started' })
    store.deleteRun('r1')
    expect(store.replayEvents('r1')).toEqual([])
    expect(store.loadRun('r1')).toBeNull()
  })
})
```

- [ ] **Step 5: 实现 DurableExecutor**

```typescript
// packages/sidecar/src/orchestrator/durable-executor.ts

import type { WorkflowDef, RunState, NodeId, NodeOutput, OrchestratorEvent } from '@hip/protocol'
import type { OrchestratorPorts, AgentRunRequest } from './ports.js'
import { initRunState, reduce, readyNodes, resolveInput } from './reduce.js'
import type { SqliteWorkflowStore } from '../persistence/workflow-store.js'

export interface DurableRunOpts {
  runId: string
  runInputs?: NodeOutput
  signal: AbortSignal
  maxConcurrency?: number
}

export class DurableExecutor {
  constructor(private store: SqliteWorkflowStore) {}

  async runWorkflow(
    def: WorkflowDef,
    ports: OrchestratorPorts,
    opts: DurableRunOpts
  ): Promise<RunState> {
    // 尝试恢复
    const existing = await this.store.loadRun(opts.runId)
    let state: RunState

    if (existing && existing.status === 'running') {
      // 恢复执行：已完成节点不重跑
      state = existing
    } else if (existing) {
      return existing // 已终态，直接返回
    } else {
      state = initRunState(def, opts.runId)
      await this.store.saveDef(def)
    }

    const sink = ports.eventSink

    const apply = (event: OrchestratorEvent) => {
      sink?.emit(event)
      state = reduce(state, def, event)
      this.store.appendEvent(opts.runId, event)
      this.store.saveRun(state)
    }

    // 只在全新启动时发射 run:started
    if (!existing) apply({ type: 'run:started' })

    const nodeById = new Map(def.nodes.map(n => [n.id, n]))
    const inFlight = new Map<NodeId, Promise<{ id: NodeId; ok: boolean; out?: NodeOutput; err?: string }>>()

    const launch = () => {
      if (opts.signal.aborted) return
      const maxCon = opts.maxConcurrency ?? 5
      for (const id of readyNodes(state)) {
        // 跳过已经 succeeded/failed 的节点（恢复场景）
        const currentStatus = state.nodes[id]?.status
        if (currentStatus === 'succeeded' || currentStatus === 'failed') continue
        if (inFlight.size >= maxCon) break
        if (inFlight.has(id)) continue

        const node = nodeById.get(id)!
        const input = resolveInput(node, state, opts.runInputs)
        apply({ type: 'node:started', nodeId: id })

        const p = ports.agentRunner
          .run({ runId: opts.runId, nodeId: id, agentId: (node as any).agentId ?? '', input }, opts.signal)
          .then(out => ({ id, ok: true as const, out }))
          .catch(e => ({ id, ok: false as const, err: e instanceof Error ? e.message : String(e) }))

        inFlight.set(id, p)
      }
    }

    launch()
    while (inFlight.size > 0) {
      if (opts.signal.aborted && state.status === 'running') apply({ type: 'run:cancelled' })
      const settled = await Promise.race(inFlight.values())
      inFlight.delete(settled.id)

      if (opts.signal.aborted && state.status === 'running') apply({ type: 'run:cancelled' })

      if (settled.ok) {
        const before = { ...state }
        apply({ type: 'node:succeeded', nodeId: settled.id, output: settled.out! })
        // 补发级联 skip 事件
        for (const nid of Object.keys(state.nodes)) {
          if (state.nodes[nid].status === 'skipped' && before.nodes[nid]?.status !== 'skipped') {
            apply({ type: 'node:skipped', nodeId: nid })
          }
        }
      } else if (state.status !== 'cancelled') {
        apply({ type: 'node:failed', nodeId: settled.id, error: settled.err! })
      }

      if (state.status === 'running') launch()
    }

    if (opts.signal.aborted && state.status === 'running') apply({ type: 'run:cancelled' })

    const finalStatus: 'succeeded' | 'failed' = Object.values(state.nodes).some(n => n.status === 'failed')
      ? 'failed' : 'succeeded'

    if (state.status === 'running') {
      apply({ type: 'run:finished', status: finalStatus })
    } else {
      apply({ type: 'run:finished', status: state.status })
    }

    return state
  }

  async resumeWorkflow(
    runId: string,
    ports: OrchestratorPorts,
    signal: AbortSignal
  ): Promise<RunState> {
    const saved = await this.store.loadRun(runId)
    if (!saved) throw new Error(`Run ${runId} not found`)
    if (saved.status !== 'running') return saved

    const def = await this.store.loadDef(saved.workflowId)
    if (!def) throw new Error(`Workflow def ${saved.workflowId} not found`)

    return this.runWorkflow(def, ports, { runId, signal })
  }
}
```

- [ ] **Step 6: 编写 DurableExecutor 测试**

```typescript
// packages/sidecar/src/orchestrator/durable-executor.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { SqliteWorkflowStore } from '../persistence/workflow-store.js'
import { WORKFLOW_DDL } from '../persistence/schema.js'
import { DurableExecutor } from './durable-executor.js'
import { FakeAgentRunner, CollectingEventSink } from './ports.js'
import type { WorkflowDef } from '@hip/protocol'

function createTestDb() {
  const db = new Database(':memory:')
  for (const ddl of WORKFLOW_DDL) db.exec(ddl)
  return db
}

const simpleDef: WorkflowDef = {
  id: 'wf-simple',
  name: 'Simple',
  nodes: [
    { type: 'agent', id: 'n1', agentId: 'a1', inputTemplate: 'step 1' },
    { type: 'agent', id: 'n2', agentId: 'a1', inputTemplate: '{{n1}}' },
  ],
  edges: [
    { from: 'n1', to: 'n2' },
  ],
  entry: ['n1'],
}

describe('DurableExecutor', () => {
  let db: ReturnType<typeof createTestDb>
  let store: SqliteWorkflowStore

  beforeEach(() => {
    db = createTestDb()
    store = new SqliteWorkflowStore(db)
  })

  afterEach(() => db.close())

  it('executes a simple sequential workflow', async () => {
    const runner = new FakeAgentRunner({
      n1: { text: 'result-1' },
      n2: { text: 'result-2' },
    })
    const sink = new CollectingEventSink()
    const executor = new DurableExecutor(store)

    const ctrl = new AbortController()
    const state = await executor.runWorkflow(simpleDef, { agentRunner: runner, eventSink: sink }, {
      runId: 'r-seq', signal: ctrl.signal,
    })

    expect(state.status).toBe('succeeded')
    expect(state.nodes['n1'].status).toBe('succeeded')
    expect(state.nodes['n2'].status).toBe('succeeded')
  })

  it('persists state after each node and can resume', async () => {
    const runner = new FakeAgentRunner({
      n1: { text: 'result-1' },
      n2: { text: 'result-2' },
    })
    const executor = new DurableExecutor(store)

    // 第一次执行完成
    const ctrl = new AbortController()
    await executor.runWorkflow(simpleDef, { agentRunner: runner }, {
      runId: 'r-resume', signal: ctrl.signal,
    })

    // 验证持久化
    const saved = await store.loadRun('r-resume')
    expect(saved).not.toBeNull()
    expect(saved!.status).toBe('succeeded')

    // 重放事件
    const events = store.replayEvents('r-resume')
    expect(events.length).toBeGreaterThanOrEqual(4) // started + 2x started/succeeded + finished
  })

  it('fail-fast on node error', async () => {
    const runner = new FakeAgentRunner({
      n1: { throws: 'simulated failure' },
      n2: { text: 'never runs' },
    })
    const executor = new DurableExecutor(store)
    const ctrl = new AbortController()

    const state = await executor.runWorkflow(simpleDef, { agentRunner: runner }, {
      runId: 'r-fail', signal: ctrl.signal,
    })

    expect(state.status).toBe('failed')
    expect(state.nodes['n1'].status).toBe('failed')
    // n2 应为 skipped（级联）
    expect(state.nodes['n2'].status).toBe('skipped')
  })
})
```

- [ ] **Step 7: 运行所有新增测试**

```bash
yarn vitest run packages/sidecar/src/persistence/workflow-store.test.ts \
                 packages/sidecar/src/orchestrator/durable-executor.test.ts
```
Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/sidecar/src/persistence/schema.ts \
        packages/sidecar/src/persistence/workflow-store.ts \
        packages/sidecar/src/persistence/workflow-store.test.ts \
        packages/sidecar/src/orchestrator/durable-executor.ts \
        packages/sidecar/src/orchestrator/durable-executor.test.ts \
        packages/sidecar/src/main.ts
git commit -m "feat(orchestrator): add SQLite-backed DurableExecutor with checkpoint-resume

- SqliteWorkflowStore: persist WorkflowDef, RunState, and event log
- DurableExecutor: every reduce() event written to SQLite before next step
- resumeWorkflow: replay event log, skip completed nodes, continue execution
- WORKFLOW_DDL added to schema.ts and executed in main.ts on startup
- Fail-fast on node error; cascaded skip propagation

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 1.4: 集成 orchMode 到 Session.runTurn

**目标:** `Session.runTurn()` 根据 `SessionConfig.orchMode` 选择执行路径。

**Files:**
- Modify: `packages/sidecar/src/session/session.ts`
- Modify: `packages/sidecar/src/session/session-manager.ts`
- Modify: `packages/sidecar/src/session/workflow-runner.ts`

**Interfaces:**
- Consumes: `OrchestrationMode` from protocol, `DurableExecutor` from orchestrator

- [ ] **Step 1: 在 Session 构造中读取 orchMode**

```typescript
// packages/sidecar/src/session/session.ts

// 在 Session 类属性中添加:
private orchMode: OrchestrationMode

// 在 constructor 中:
this.orchMode = config.orchMode ?? 'fast'
```

- [ ] **Step 2: 在 runTurn 中增加 dag 模式分支**

```typescript
// packages/sidecar/src/session/session.ts, runTurn 方法中

// 在现有的外部 agent 检查和内置 graph 调用之前，增加:

if (this.orchMode === 'dag' && this.pendingWorkflowDef) {
  // DAG 模式：使用 workflow-runner 执行 DAG
  const result = await runWorkflowTurn(
    this.workflowDeps,
    this.pendingWorkflowDef,
    send,
    finalize
  )
  this.pendingWorkflowDef = null
  return result
}

// 原有逻辑: fast 模式
if (agentProv.isExternalAgent()) {
  // ... existing external agent path
} else {
  // ... existing graph.invoke path
}
```

- [ ] **Step 3: 在 SessionManager 中传递 orchMode**

```typescript
// packages/sidecar/src/session/session-manager.ts

// 在 session:create 处理中:
const config: SessionConfig = {
  ...msg.config,
  orchMode: msg.config.orchMode ?? 'fast',
}
```

- [ ] **Step 4: 编写集成测试**

```typescript
// packages/sidecar/src/session/session.test.ts (追加)

it('respects orchMode="fast" (default) by using the existing graph loop', async () => {
  // 验证 fast 模式走 graph.invoke 路径
})

it('respects orchMode="dag" by using DurableExecutor', async () => {
  // 验证 dag 模式走 workflow-runner 路径
})
```

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/session/session.ts \
        packages/sidecar/src/session/session-manager.ts \
        packages/sidecar/src/session/workflow-runner.ts
git commit -m "feat(session): integrate orchMode dispatch in Session.runTurn

- 'fast' (default): existing StateGraph loop, unchanged behavior
- 'dag': delegate to workflow-runner → DurableExecutor
- orchMode passed through SessionManager from ClientMessage
- Backward compatible: sessions without orchMode default to 'fast'

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 1.5: maxDepth 递归子代理支持

**目标:** 子代理在 `depth < maxDepth` 时拥有 `task` 工具，达到上限后自动过滤。

**Files:**
- Modify: `packages/sidecar/src/session/loop-control.ts`
- Modify: `packages/sidecar/src/session/subagent.ts`
- Modify: `packages/sidecar/src/session/tools/subagent.ts`
- Modify: `packages/sidecar/src/session/tools/index.ts`

**Interfaces:**
- Consumes: `MAX_DEPTH` constant
- Produces: depth-aware tool filtering

- [ ] **Step 1: 定义 MAX_DEPTH 常量**

```typescript
// packages/sidecar/src/session/loop-control.ts 追加:

/** 子代理最大递归深度。depth >= MAX_DEPTH 时 task/dispatch_agent 工具不可用。 */
export const MAX_DEPTH = 3
```

- [ ] **Step 2: 修改 subagent runner 接受 depth 参数**

```typescript
// packages/sidecar/src/session/subagent.ts

export async function runSubagent(
  deps: SubagentDeps,
  input: SubagentInput & { depth: number }  // 追加 depth
): Promise<string> {
  const { depth } = input

  // depth >= MAX_DEPTH 时过滤掉 task/dispatch_agent 工具
  const tools = depth >= MAX_DEPTH
    ? deps.tools.filter(t =>
        t.name !== 'task' &&
        t.name !== 'task_batch' &&
        t.name !== 'dispatch_agent')
    : deps.tools

  // ... rest of implementation
}
```

- [ ] **Step 3: 在 task 工具中传递 depth**

```typescript
// packages/sidecar/src/session/tools/subagent.ts

// task 工具实现中:
const childDepth = (currentDepth ?? 0) + 1
const result = await runSubagent(deps, {
  ...input,
  depth: childDepth,
})
```

- [ ] **Step 4: 编写测试**

```typescript
// packages/sidecar/src/session/subagent.test.ts (追加)

it('filters task tool at max depth', async () => {
  // depth = MAX_DEPTH: task/dispatch_agent 不在 tool list 中
})

it('includes task tool below max depth', async () => {
  // depth = 1: task/dispatch_agent 在 tool list 中
})
```

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/session/loop-control.ts \
        packages/sidecar/src/session/subagent.ts \
        packages/sidecar/src/session/tools/subagent.ts \
        packages/sidecar/src/session/tools/index.ts
git commit -m "feat(subagent): add maxDepth support for recursive delegation

- MAX_DEPTH=3 in loop-control.ts
- task/dispatch_agent tools filtered out at depth >= MAX_DEPTH
- depth counter passed through subagent runner chain
- Prevents unbounded recursive agent spawning

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 1.6: 扩展 executor.ts 适配 DurableExecutor

**目标:** 将 `runWorkflow` 中的 `apply` 调用替换为持久化版本。

**Files:**
- Modify: `packages/sidecar/src/orchestrator/executor.ts`
- Modify: `packages/sidecar/src/session/workflow-runner.ts`
- Modify: `packages/sidecar/src/session/orchestrator-adapter.ts`

- [ ] **Step 1: 重构 executor.ts 接受可选的 store 参数**

```typescript
// packages/sidecar/src/orchestrator/executor.ts

// 保留原有 runWorkflow 签名以保证向后兼容
// 新增: 当 ports.store 存在时，每个 event 自动落盘
// 这使现有调用者无需更改即可获得耐久执行的好处
```

- [ ] **Step 2: workflow-runner 传入 SqliteWorkflowStore**

```typescript
// packages/sidecar/src/session/workflow-runner.ts

// 在 runWorkflowTurn 中:
const workflowStore = new SqliteWorkflowStore(database)
const ports: OrchestratorPorts = {
  agentRunner,
  store: workflowStore,
  eventSink,
}
```

- [ ] **Step 3: 运行现有测试确保无回归**

```bash
yarn vitest run packages/sidecar/src/orchestrator/
```
Expected: all existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/sidecar/src/orchestrator/executor.ts \
        packages/sidecar/src/session/workflow-runner.ts \
        packages/sidecar/src/session/orchestrator-adapter.ts
git commit -m "feat(orchestrator): wire DurableExecutor into workflow-runner

- executor.ts auto-persists when ports.store is provided
- workflow-runner injects SqliteWorkflowStore backed by session DB
- Backward compatible: no store → no persistence (existing behavior)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 1.7: 前端 orchMode 选择器 UI

**目标:** 用户在聊天界面可以切换 fast / dag 模式。

**Files:**
- Modify: `src/components/chat/ModelPicker.tsx`
- Modify: `src/domain/sessionStore.ts`
- Modify: `src/domain/sessionService.ts`

- [ ] **Step 1: 在 sessionStore 中增加 orchMode 状态**

```typescript
// src/domain/sessionStore.ts

// 在 SessionVM 接口中追加:
orchMode: 'fast' | 'dag'

// 在 createSession action 中传递 orchMode
```

- [ ] **Step 2: 在 ModelPicker 中增加切换控件**

```tsx
// src/components/chat/ModelPicker.tsx

// 增加一个 Toggle / SegmentedControl:
// [Fast] [DAG]
// onChange → sessionService.setOrchMode(sessionId, mode)
```

- [ ] **Step 3: 实现 setOrchMode action**

```typescript
// src/domain/sessionService.ts

setOrchMode(sessionId: string, mode: 'fast' | 'dag') {
  // 发送 WebSocket 消息更新 session config
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/chat/ModelPicker.tsx \
        src/domain/sessionStore.ts \
        src/domain/sessionService.ts
git commit -m "feat(ui): add orchMode toggle (fast/dag) to ModelPicker

- Toggle in chat header: Fast (default) vs DAG mode
- orchMode persisted in SessionConfig
- DAG mode triggers workflow-runner execution path

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 1.8: 端到端集成测试

**目标:** 验证完整流程：创建 dag 模式 session → 发送消息 → DAG 执行 → 结果返回。

**Files:**
- Create: `packages/sidecar/src/orchestrator/e2e.integration.test.ts`

- [ ] **Step 1: 编写端到端测试**

```typescript
// packages/sidecar/src/orchestrator/e2e.integration.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { SqliteWorkflowStore } from '../persistence/workflow-store.js'
import { DurableExecutor } from './durable-executor.js'
import { FakeAgentRunner, CollectingEventSink } from './ports.js'
import type { WorkflowDef } from '@hip/protocol'
import { WORKFLOW_DDL } from '../persistence/schema.js'

describe('Orchestrator E2E', () => {
  let db: Database
  let store: SqliteWorkflowStore

  beforeEach(() => {
    db = new Database(':memory:')
    for (const ddl of WORKFLOW_DDL) db.exec(ddl)
    store = new SqliteWorkflowStore(db)
  })

  afterEach(() => db.close())

  // Scenario 1: Sequential pipeline (current Supervisor→Planner→Coder→Reviewer)
  it('sequential pipeline: plan → code → review', async () => {
    const def: WorkflowDef = {
      id: 'wf-pipeline',
      name: 'Plan-Code-Review',
      nodes: [
        { type: 'agent', id: 'planner', agentId: 'plan', inputTemplate: 'Plan: {{input}}' },
        { type: 'agent', id: 'coder', agentId: 'worker', inputTemplate: 'Code based on: {{planner}}' },
        { type: 'agent', id: 'reviewer', agentId: 'worker', inputTemplate: 'Review: {{coder}}' },
      ],
      edges: [
        { from: 'planner', to: 'coder' },
        { from: 'coder', to: 'reviewer' },
      ],
      entry: ['planner'],
    }

    const runner = new FakeAgentRunner({
      planner: { text: 'Plan: use React + Tailwind' },
      coder: { text: 'Code: implemented component' },
      reviewer: { text: 'Review: LGTM' },
    })
    const sink = new CollectingEventSink()
    const executor = new DurableExecutor(store)

    const ctrl = new AbortController()
    const state = await executor.runWorkflow(def, { agentRunner: runner, eventSink: sink }, {
      runId: 'r-pipeline',
      runInputs: { text: 'Build a login form' },
      signal: ctrl.signal,
    })

    expect(state.status).toBe('succeeded')
    expect(state.nodes['planner'].output?.text).toContain('React + Tailwind')
    expect(state.nodes['coder'].output?.text).toContain('implemented component')
    expect(state.nodes['reviewer'].output?.text).toContain('LGTM')

    // 验证事件流
    const startedEvents = sink.ofType('node:started')
    expect(startedEvents.length).toBe(3)
  })

  // Scenario 2: Parallel fan-out with merge
  it('parallel fan-out: research + implement in parallel', async () => {
    const def: WorkflowDef = {
      id: 'wf-fanout',
      name: 'Research and Implement',
      nodes: [
        { type: 'agent', id: 'researcher', agentId: 'explore', inputTemplate: 'Research: {{input}}' },
        { type: 'agent', id: 'implementer', agentId: 'worker', inputTemplate: 'Implement: {{input}}' },
      ],
      edges: [],
      entry: ['researcher', 'implementer'],
    }

    const runner = new FakeAgentRunner({
      researcher: { text: 'Research: found 3 approaches' },
      implementer: { text: 'Code: implemented best approach', delayMs: 50 },
    })
    const sink = new CollectingEventSink()
    const executor = new DurableExecutor(store)

    const ctrl = new AbortController()
    const state = await executor.runWorkflow(def, { agentRunner: runner, eventSink: sink }, {
      runId: 'r-fanout',
      runInputs: { text: 'Add dark mode' },
      signal: ctrl.signal,
    })

    expect(state.status).toBe('succeeded')
    // 两个节点都应该成功（并行执行）
    expect(state.nodes['researcher'].status).toBe('succeeded')
    expect(state.nodes['implementer'].status).toBe('succeeded')
  })

  // Scenario 3: Crash recovery mid-execution
  it('resumes from checkpoint after simulated crash', async () => {
    const def: WorkflowDef = {
      id: 'wf-recovery',
      name: 'Recovery Test',
      nodes: [
        { type: 'agent', id: 'step1', agentId: 'worker', inputTemplate: 'step 1' },
        { type: 'agent', id: 'step2', agentId: 'worker', inputTemplate: 'step 2 after {{step1}}' },
        { type: 'agent', id: 'step3', agentId: 'worker', inputTemplate: 'step 3 after {{step2}}' },
      ],
      edges: [
        { from: 'step1', to: 'step2' },
        { from: 'step2', to: 'step3' },
      ],
      entry: ['step1'],
    }

    const runner = new FakeAgentRunner({
      step1: { text: 'done-1' },
      step2: { text: 'done-2' },
      step3: { text: 'done-3' },
    })

    // 第一次运行：step1 完成，然后 "崩溃"（不执行 step2/step3）
    const executor1 = new DurableExecutor(store)
    const ctrl1 = new AbortController()

    // 使用特殊 runner：step1 完成后立即 abort
    const partialRunner = new FakeAgentRunner({
      step1: { text: 'done-1' },
      step2: { text: '', delayMs: 99999 }, // 永不完结
      step3: { text: '', delayMs: 99999 },
    })

    const runPromise = executor1.runWorkflow(def, { agentRunner: partialRunner }, {
      runId: 'r-recover', signal: ctrl1.signal,
    })

    // 等待 step1 完成（检查持久化）
    await new Promise(r => setTimeout(r, 100))
    ctrl1.abort()
    const partialState = await runPromise
    expect(partialState.nodes['step1'].status).toBe('succeeded')

    // 第二次运行：恢复并完成剩余步骤
    const executor2 = new DurableExecutor(store)
    const ctrl2 = new AbortController()

    const finalState = await executor2.runWorkflow(def, { agentRunner: runner }, {
      runId: 'r-recover', signal: ctrl2.signal,
    })

    expect(finalState.status).toBe('succeeded')
    expect(finalState.nodes['step1'].status).toBe('succeeded')
    expect(finalState.nodes['step2'].status).toBe('succeeded')
    expect(finalState.nodes['step3'].status).toBe('succeeded')

    // step1 只执行了一次（验证事件数）
    const events = store.replayEvents('r-recover')
    const step1Starts = events.filter(e =>
      e.type === 'node:started' && e.nodeId === 'step1')
    expect(step1Starts.length).toBe(1) // 不是 2
  })
})
```

- [ ] **Step 2: 运行 E2E 测试**

```bash
yarn vitest run packages/sidecar/src/orchestrator/e2e.integration.test.ts
```
Expected: 3 tests pass.

- [ ] **Step 3: 运行全量测试确认无回归**

```bash
yarn test
```
Expected: no new failures.

- [ ] **Step 4: Commit**

```bash
git add packages/sidecar/src/orchestrator/e2e.integration.test.ts
git commit -m "test(orchestrator): add E2E integration tests

- Sequential pipeline (plan → code → review)
- Parallel fan-out with concurrent execution
- Crash recovery: checkpoint + resume from mid-execution
- Verifies event ordering and idempotency of replay

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Phase 1 Completion Checklist

- [ ] `yarn tsc` passes with no new errors
- [ ] `yarn test` passes with no regressions
- [ ] `yarn vitest run packages/sidecar/src/orchestrator/` passes
- [ ] `yarn vitest run packages/sidecar/src/persistence/workflow-store.test.ts` passes
- [ ] Manual smoke test: create session with orchMode='dag', send message, verify DAG execution
- [ ] Manual smoke test: kill sidecar mid-DAG-execution, restart, verify resume
- [ ] Manual smoke test: fast mode still works identically to before

---

*Phase 1 完成后，进入 Phase 2：验证门控与可靠性。详见主计划文档 `docs/agent-orchestration-plan.md` §5.*
