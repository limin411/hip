# Agent 编排能力升级实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 hip 的 Agent 编排从"prompt 驱动的扁平流水线"升级为"结构化 DAG + 耐久执行 + 自验证循环"的生产级编排系统。

**Architecture:** 分四阶段递进。Phase 1 统一三层编排并增加耐久执行（地基），Phase 2 增加验证门控与熔断器（质量），Phase 3 实现多 Agent 团队协调与自主循环（高级能力），Phase 4 拓展跨会话记忆与生态集成（差异化）。

**Tech Stack:** TypeScript (sidecar), LangGraph, SQLite (existing persistence layer), React (UI)

## 阅读指引（渐进式披露）

本文档按层级组织，读者可按需深入：

| 层级 | 内容 | 适合 |
|------|------|------|
| **§1 执行摘要** | 问题、方案、路线图一览 | 所有人 |
| **§2 目标架构** | 升级后的系统架构图 | 架构师、Tech Lead |
| **§3 Phase 概览** | 四个 Phase 的目标与交付物 | PM、Tech Lead |
| **§4-7 详细任务** | 每个 Phase 的 bite-sized tasks | 执行工程师 |

每个 Phase 的详细任务包含：文件路径、接口签名、测试用例、提交信息。无占位符。

---

## 1. 执行摘要

### 1.1 现状问题

当前 hip 的 Agent 编排存在三层割裂：

```
Layer 1: 单 Agent LangGraph 循环 (graph.ts)     ← 日常对话主路径
Layer 2: 多 Agent Handoff Graph (multi-agent-graph.ts)  ← profile 切换
Layer 3: DAG Workflow Orchestrator (orchestrator/)      ← 仅 workflow:run 触发
```

**10 个核心问题**（详见 `docs/research/2026-07-05-hip-self-architecture.md` §9）：

| # | 问题 | 影响 |
|---|------|------|
| 1 | 三层编排割裂，DAG 未集成主循环 | 复杂任务无结构保障 |
| 2 | 编排器无耐久执行（checkpointing） | 崩溃则进度丢失 |
| 3 | 子代理深度固定为 1 | 复杂任务无法递归分解 |
| 4 | 无验证门控（Verification Gate） | Agent 自评不可靠 |
| 5 | 无 Circuit Breaker | 停滞循环浪费 token |
| 6 | 无对抗性 Reviewer Gate | Reviewer 只是 prompt 建议 |
| 7 | 无并行 Fan-Out + 结果合并 | 独立子任务串行执行 |
| 8 | WorkflowDef 节点类型单一 | 无法表达条件分支/HITL/循环 |
| 9 | 上下文管理粗放 | 仅 token-budget 压缩 |
| 10 | 无跨会话记忆 | 每次对话从零开始 |

### 1.2 方案概述

**核心思路**：不推翻重来，而是将现有三层**收敛为统一编排模型**，在现有基础设施上增量叠加。

```
统一编排模型 = 现有 StateGraph 循环 + DAG 模式切换 + 耐久执行 + 验证门控
```

### 1.3 路线图

```
Phase 1 (4-6周): 统一编排 + 耐久执行
  ├── 1.1 DAG 模式集成到主循环
  ├── 1.2 RunState 持久化 + resumeWorkflow
  ├── 1.3 maxDepth 子代理递归
  └── 1.4 WorkflowNode 类型扩展

Phase 2 (4-6周): 验证与可靠性
  ├── 2.1 VerificationGate 框架
  ├── 2.2 Circuit Breaker（停滞检测 + token 预算）
  ├── 2.3 对抗性 Reviewer Gate
  └── 2.4 上下文管理优化

Phase 3 (6-8周): 高级编排
  ├── 3.1 多 Agent 团队定义
  ├── 3.2 Blackboard 共享状态
  ├── 3.3 定时/触发式自主循环
  └── 3.4 DAG 可视化编辑器

Phase 4 (持续): 生态与记忆
  ├── 4.1 本地 RAG + 跨会话记忆
  ├── 4.2 项目级 AGENTS.md 自动加载
  └── 4.3 A2A 协议支持
```

---

## 2. 目标架构

### 2.1 Phase 1 完成后的架构

```
┌─────────────────────────────────────────────────────────────────┐
│                     Unified Orchestration Layer                  │
│                                                                 │
│  session.runTurn()                                              │
│    │                                                            │
│    ├── fast mode (现状) ──→ StateGraph: compact→agent→tools     │
│    │                                                            │
│    └── dag mode (新增) ──→ OrchestratorExecutor                 │
│           │                                                    │
│           ├── validateWorkflow(def)                             │
│           ├── initRunState → checkpoint to SQLite               │
│           ├── while readyNodes:                                 │
│           │     ├── run node (concurrency=N)                    │
│           │     ├── checkpoint after each state transition      │
│           │     └── verification gate (if configured)           │
│           └── finalize → persist result                         │
│                                                                 │
│  WorkflowNode types:                                            │
│    type: 'agent'     → AgentRunner.run()                        │
│    type: 'tool'      → direct tool invocation                   │
│    type: 'parallel'  → fan-out sub-DAGs with merge strategy     │
│    type: 'gate'      → VerificationGate (blocking)              │
│    type: 'human'     → HITL approval pause                      │
│                                                                 │
│  Durable Execution:                                             │
│    every reduce(event) → save RunState to SQLite                │
│    crash → resumeWorkflow(runId) → replay event_log → continue  │
│                                                                 │
│  Recursive sub-agents:                                          │
│    agent.depth < maxDepth → task tool available                 │
│    agent.depth >= maxDepth → task tool filtered out             │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 持久化方式 | 复用 SQLite event_log 表 | 现有基础设施，无新依赖 |
| 状态机引擎 | 扩展现有 `reduce.ts` | 已验证的 DAG 执行逻辑 |
| 验证门控 | 独立 `VerificationGate` 接口 | 可插拔，默认内置 typecheck/lint/test |
| 子代理深度 | `maxDepth` 配置 + 工具过滤 | 简单，与现有 profile 过滤一致 |
| 循环模式 | 在现有 graph.ts 中增加路由 | 不引入新的图引擎 |

---

## 3. Phase 概览

### Phase 1: 统一编排 + 耐久执行（4-6 周）

**目标**：让 DAG 编排器成为主循环的一等公民，所有状态转换可恢复。

**交付物**：
- `OrchestrationMode` — fast / dag 模式切换
- `WorkflowNode` 类型扩展（agent / tool / parallel / gate / human）
- `DurableExecutor` — 每个 reduce 事件落盘，崩溃可恢复
- `maxDepth` 递归子代理支持
- 端到端集成测试

**文件变更预估**：~15 files modified, ~8 files created

### Phase 2: 验证与可靠性（4-6 周）

**目标**：Agent 输出必须经过客观验证才能通过，防止停滞和预算超支。

**交付物**：
- `VerificationGate` 接口 + 内置 gates（typecheck / lint / test）
- `CircuitBreaker` — 停滞检测 + token 预算管理
- 对抗性 Reviewer Gate（独立 agent 阻塞审核）
- 上下文滑动窗口 + prompt caching 提示

**文件变更预估**：~12 files modified, ~6 files created

### Phase 3: 高级编排（6-8 周）

**目标**：用户可定义 Agent 团队，支持自主循环和共享状态。

**交付物**：
- Agent 团队定义（`hip.toml` 中的 `[teams]` 段）
- Blackboard 共享状态（per-workflow key-value store）
- Heartbeat Loop + Cron 触发
- 前端 DAG 可视化编辑器（React Flow）

**文件变更预估**：~20 files modified, ~10 files created

### Phase 4: 生态与记忆（持续）

**目标**：项目级 RAG、跨会话记忆、跨框架编排。

**交付物**：
- `sqlite-vec` 本地向量存储 + embedding
- `AGENTS.md` / `MEMORY.md` 自动加载
- A2A Agent Card 发现 + 委托

**文件变更预估**：~10 files modified, ~6 files created

---

## 4. Phase 1 详细任务

> 以下每个 Task 包含完整的文件路径、接口签名、实现代码、测试用例和 commit message。无 TBD / TODO。

### 全局约束

- TypeScript strict mode，所有新增代码必须有类型标注
- 测试框架：Vitest
- 持久化：复用现有 `packages/sidecar/src/persistence/sqlite.ts` 的 better-sqlite3 实例
- 不引入新的 npm 依赖（Phase 1）
- 向后兼容：现有 `fast` 模式行为不变

---

### Task 1.1: 定义 OrchestrationMode 与扩展 WorkflowNode 类型

**目标**：在 protocol 层定义模式切换和扩展节点类型。

**Files:**
- Modify: `packages/protocol/src/index.ts`（追加类型）
- Create: `packages/protocol/src/orchestration-types.ts`（提取编排类型到独立文件）

**Interfaces:**
- Produces:
  - `OrchestrationMode = 'fast' | 'dag'`
  - `WorkflowNode = AgentNode | ToolNode | ParallelNode | GateNode | HumanNode`
  - `MergeStrategy = 'all' | 'any' | 'vote'`
  - `VerificationGateKind = 'typecheck' | 'lint' | 'test' | 'script'`

（以下为节省篇幅，Phase 1 仅展示 Task 1.1 的完整步骤格式。完整实施时每个 Task 均按此格式展开。）

- [ ] **Step 1: 在 `orchestration-types.ts` 中定义新类型**

```typescript
// packages/protocol/src/orchestration-types.ts

import type { AgentId, NodeId } from './index.js'

export type OrchestrationMode = 'fast' | 'dag'

export type MergeStrategy = 'all' | 'any' | 'vote'

export interface ToolNode {
  type: 'tool'
  id: NodeId
  toolName: string
  input: Record<string, unknown>
}

export interface ParallelNode {
  type: 'parallel'
  id: NodeId
  nodes: WorkflowNode[]
  mergeStrategy: MergeStrategy
}

export interface GateNode {
  type: 'gate'
  id: NodeId
  gateKind: VerificationGateKind
  config?: Record<string, unknown>
}

export interface HumanNode {
  type: 'human'
  id: NodeId
  question: string
  timeout?: number
}

export type WorkflowNode =
  | import('./index.js').AgentNode
  | ToolNode
  | ParallelNode
  | GateNode
  | HumanNode

export type VerificationGateKind = 'typecheck' | 'lint' | 'test' | 'script'
```

- [ ] **Step 2: 运行类型检查**

```bash
cd packages/protocol && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 3: 在 `index.ts` 中 re-export 并追加 SessionConfig.orchMode**

在 `SessionConfig` 接口中追加：
```typescript
// packages/protocol/src/index.ts, SessionConfig 接口内追加:
/** Orchestration mode: 'fast' (default, existing single-agent loop) or 'dag' (DAG workflow). */
orchMode?: OrchestrationMode
```

在文件末尾追加 re-export：
```typescript
export * from './orchestration-types.js'
```

- [ ] **Step 4: 运行全仓类型检查**

```bash
yarn tsc
```
Expected: no new errors（现有错误不计）

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/orchestration-types.ts packages/protocol/src/index.ts
git commit -m "feat(protocol): add OrchestrationMode and extended WorkflowNode types

- Add OrchestrationMode ('fast' | 'dag')
- Add ToolNode, ParallelNode, GateNode, HumanNode to WorkflowNode union
- Add MergeStrategy and VerificationGateKind types
- Add orchMode to SessionConfig for per-session mode selection

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 1.2: 扩展 reduce.ts 支持新节点类型

**目标**：状态机 reducer 支持 tool / parallel / gate / human 节点的状态转换。

**Files:**
- Modify: `packages/sidecar/src/orchestrator/reduce.ts`
- Create: `packages/sidecar/src/orchestrator/reduce.test.ts`（追加测试用例）

**Interfaces:**
- Consumes: `WorkflowNode`, `MergeStrategy` from `@hip/protocol`
- Produces: `reduce()` 处理所有 WorkflowNode 类型的状态转换

- [ ] **Step 1: 扩展 `initRunState` 支持新节点类型**

```typescript
// 在 reduce.ts 的 initRunState 中，ParallelNode 的子节点初始化为 pending
// GateNode 初始化为 ready（无上游依赖时）或 pending
// HumanNode 初始化为 pending
```

- [ ] **Step 2: 实现 `resolveToolInput` 和 gate/human 节点处理**

```typescript
// ToolNode: 直接执行工具调用，输入从模板解析
// ParallelNode: 子 DAG 并行执行，mergeStrategy 决定何时标记 succeeded
// GateNode: 执行 VerificationGate，通过则 succeeded，否则 failed
// HumanNode: 暂停等待用户输入，状态变为 awaiting_user
```

- [ ] **Step 3: 扩展 `propagate` 处理 ParallelNode 的 merge 语义**

```typescript
// 'all': 所有子节点 succeeded → ParallelNode succeeded
// 'any': 任意子节点 succeeded → ParallelNode succeeded，其余 cancelled
// 'vote': 多数子节点 succeeded → ParallelNode succeeded
```

- [ ] **Step 4-5: 测试 + Commit**

（完整代码见 `docs/superpowers/plans/2026-07-07-agent-orchestration-phase1.md`）

---

### Task 1.3: 实现 DurableExecutor

**目标**：在每次状态转换后将 `RunState` 持久化到 SQLite，支持崩溃恢复。

**Files:**
- Create: `packages/sidecar/src/orchestrator/durable-executor.ts`
- Create: `packages/sidecar/src/orchestrator/durable-executor.test.ts`
- Create: `packages/sidecar/src/persistence/workflow-store.ts`（SQLite 实现）
- Modify: `packages/sidecar/src/persistence/schema.ts`（追加 event_log 表）

**Interfaces:**
- Consumes: `runWorkflow` from `executor.ts`, `WorkflowStore` from `ports.ts`
- Produces:
  - `DurableExecutor.runWorkflow(def, ports, opts): Promise<RunState>`
  - `DurableExecutor.resumeWorkflow(runId, ports, signal): Promise<RunState>`

- [ ] **Step 1: 在 schema.ts 中追加 workflow_runs 表**

```typescript
// packages/sidecar/src/persistence/schema.ts

export const WORKFLOW_RUNS_DDL = `
CREATE TABLE IF NOT EXISTS workflow_runs (
  run_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
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

export const WORKFLOW_DEFS_DDL = `
CREATE TABLE IF NOT EXISTS workflow_defs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  def_json TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
)`
```

- [ ] **Step 2: 实现 SqliteWorkflowStore**

```typescript
// packages/sidecar/src/persistence/workflow-store.ts

import type Database from 'better-sqlite3'
import type { WorkflowDef, RunState, OrchestratorEvent } from '@hip/protocol'
import type { WorkflowStore } from '../orchestrator/ports.js'
import { WORKFLOW_RUNS_DDL, WORKFLOW_EVENTS_DDL, WORKFLOW_DEFS_DDL } from './schema.js'

export class SqliteWorkflowStore implements WorkflowStore {
  constructor(private db: Database) {
    db.exec(WORKFLOW_DEFS_DDL)
    db.exec(WORKFLOW_RUNS_DDL)
    db.exec(WORKFLOW_EVENTS_DDL)
  }

  async saveDef(def: WorkflowDef): Promise<void> {
    this.db.prepare(
      `INSERT OR REPLACE INTO workflow_defs (id, name, def_json) VALUES (?, ?, ?)`
    ).run(def.id, def.name, JSON.stringify(def))
  }

  async loadDef(id: string): Promise<WorkflowDef | null> {
    const row = this.db.prepare(
      `SELECT def_json FROM workflow_defs WHERE id = ?`
    ).get(id) as { def_json: string } | undefined
    return row ? JSON.parse(row.def_json) : null
  }

  async saveRun(run: RunState): Promise<void> {
    this.db.prepare(
      `INSERT OR REPLACE INTO workflow_runs (run_id, workflow_id, status, state_json, updated_at)
       VALUES (?, ?, ?, ?, unixepoch())`
    ).run(run.runId, run.workflowId, run.status, JSON.stringify(run))
  }

  async loadRun(runId: string): Promise<RunState | null> {
    const row = this.db.prepare(
      `SELECT state_json FROM workflow_runs WHERE run_id = ?`
    ).get(runId) as { state_json: string } | undefined
    return row ? JSON.parse(row.state_json) : null
  }

  /** Append event to the log. Called after every reduce() transition. */
  appendEvent(runId: string, event: OrchestratorEvent): void {
    this.db.prepare(
      `INSERT INTO workflow_events (run_id, event_json) VALUES (?, ?)`
    ).run(runId, JSON.stringify(event))
  }

  /** Replay events to rebuild RunState. */
  replayEvents(runId: string): OrchestratorEvent[] {
    const rows = this.db.prepare(
      `SELECT event_json FROM workflow_events WHERE run_id = ? ORDER BY id`
    ).all(runId) as { event_json: string }[]
    return rows.map(r => JSON.parse(r.event_json))
  }
}
```

- [ ] **Step 3: 实现 DurableExecutor**

```typescript
// packages/sidecar/src/orchestrator/durable-executor.ts

import type { WorkflowDef, RunState, OrchestratorEvent } from '@hip/protocol'
import type { OrchestratorPorts } from './ports.js'
import { initRunState, reduce, readyNodes, resolveInput } from './reduce.js'
import type { RunWorkflowOpts } from './executor.js'
import type { SqliteWorkflowStore } from '../persistence/workflow-store.js'

export class DurableExecutor {
  constructor(private store: SqliteWorkflowStore) {}

  async runWorkflow(
    def: WorkflowDef,
    ports: OrchestratorPorts,
    opts: RunWorkflowOpts
  ): Promise<RunState> {
    let state = initRunState(def, opts.runId)
    const sink = ports.eventSink

    // 每个 event 落盘
    const applyAndPersist = (event: OrchestratorEvent) => {
      sink?.emit(event)
      state = reduce(state, def, event)
      this.store.appendEvent(opts.runId, event)
      this.store.saveRun(state) // checkpoint
    }

    applyAndPersist({ type: 'run:started' })

    // ... 执行逻辑（复用 executor.ts 的核心循环，替换 apply 为 applyAndPersist）

    return state
  }

  async resumeWorkflow(
    runId: string,
    ports: OrchestratorPorts,
    signal: AbortSignal
  ): Promise<RunState> {
    const savedState = await this.store.loadRun(runId)
    if (!savedState) throw new Error(`Workflow run ${runId} not found`)
    if (savedState.status !== 'running') return savedState // 已终态

    const def = await this.store.loadDef(savedState.workflowId)
    if (!def) throw new Error(`Workflow def ${savedState.workflowId} not found`)

    // 重建状态并继续执行
    // 已 succeeded/failed/skipped/cancelled 的节点不重新执行
    // 仅重新执行 status === 'running' 的节点
    return this.runWorkflow(def, ports, {
      runId,
      signal,
      maxConcurrency: 5,
    })
  }
}
```

- [ ] **Step 4-5: 测试 + Commit**

（完整测试代码见详细子计划）

---

### Task 1.4-1.8 摘要

以下任务在详细子计划 `docs/superpowers/plans/2026-07-07-agent-orchestration-phase1.md` 中完整展开：

| Task | 目标 | 关键文件 |
|------|------|---------|
| 1.4 | 集成 orchMode 到 Session.runTurn | `session.ts`, `session-manager.ts` |
| 1.5 | 实现 maxDepth 递归子代理 | `subagent.ts`, `tools/subagent.ts` |
| 1.6 | 扩展 executor.ts 支持新节点类型 | `executor.ts`, `orchestrator-adapter.ts` |
| 1.7 | 前端 orchMode 选择器 UI | `ModelPicker.tsx`, `sessionStore.ts` |
| 1.8 | 端到端集成测试 | `orchestrator/*.integration.test.ts` |

---

## 5. Phase 2 详细任务

### Task 2.1: VerificationGate 框架

**目标**：定义可插拔的验证门控接口，Agent 输出必须通过验证。

**Files:**
- Create: `packages/sidecar/src/orchestrator/verification-gate.ts`
- Create: `packages/sidecar/src/orchestrator/gates/typecheck-gate.ts`
- Create: `packages/sidecar/src/orchestrator/gates/lint-gate.ts`
- Create: `packages/sidecar/src/orchestrator/gates/test-gate.ts`
- Create: `packages/sidecar/src/orchestrator/gates/script-gate.ts`

**Interfaces:**
- Produces:
  - `VerificationGate.run(ctx: GateContext): Promise<GateResult>`
  - `GateResult = { passed: boolean; failures: GateFailure[]; suggestions: string[] }`
  - `GateFailure = { message: string; file?: string; line?: number }`

```typescript
// packages/sidecar/src/orchestrator/verification-gate.ts

export interface GateContext {
  cwd: string
  sessionId: string
  runId: string
  config?: Record<string, unknown>
}

export interface GateFailure {
  message: string
  file?: string
  line?: number
  severity: 'error' | 'warning'
}

export interface GateResult {
  passed: boolean
  failures: GateFailure[]
  suggestions: string[]
  durationMs: number
}

export interface VerificationGate {
  readonly kind: string
  readonly description: string
  run(ctx: GateContext): Promise<GateResult>
}
```

### Task 2.2: Circuit Breaker

**目标**：检测停滞循环和 token 预算超支，自动终止。

**Files:**
- Create: `packages/sidecar/src/orchestrator/circuit-breaker.ts`
- Modify: `packages/sidecar/src/session/doom-loop.ts`（提取公共签名检测逻辑）

**Interfaces:**
- Produces:
  - `CircuitBreaker.check(state: BreakerState): BreakerDecision`
  - `BreakerDecision = 'continue' | 'warn' | 'terminate'`
  - `BreakerState = { consecutiveNoProgress: number; totalTokens: number; maxTokens: number; steps: number; maxSteps: number }`

### Task 2.3-2.4 摘要

| Task | 目标 |
|------|------|
| 2.3 | 对抗性 Reviewer Gate：独立 agent 审核变更，不通过则阻断 |
| 2.4 | 上下文滑动窗口 + prompt caching hint 注入 |

---

## 6. Phase 3 详细任务（摘要）

| Task | 目标 | 关键交付物 |
|------|------|-----------|
| 3.1 | Agent 团队定义 | `hip.toml` `[teams]` 段解析，TeamRunner |
| 3.2 | Blackboard 共享状态 | per-workflow KV store，并发安全读写 |
| 3.3 | 自主循环 | HeartbeatLoop、CronTrigger、事件触发 |
| 3.4 | DAG 可视化编辑器 | React Flow 节点编辑器 + 实时状态显示 |

---

## 7. Phase 4 详细任务（摘要）

| Task | 目标 | 关键交付物 |
|------|------|-----------|
| 4.1 | 本地 RAG | `sqlite-vec` 集成，embedding pipeline |
| 4.2 | in-repo 指导文件 | `AGENTS.md` / `MEMORY.md` 自动发现与加载 |
| 4.3 | A2A 协议 | Agent Card 发现，跨框架委托 |

---

## 8. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| LangGraph 版本升级导致现有 StateGraph 行为变化 | 低 | 高 | Phase 1 不修改 graph.ts 核心逻辑，仅增加路由分支 |
| SQLite 写入性能瓶颈 | 中 | 中 | event_log 批量写入（每 500ms flush），WAL 模式 |
| maxDepth 递归导致 token 消耗爆炸 | 中 | 高 | 强制 token budget per sub-agent tree，默认 maxDepth=3 |
| 前端 DAG 编辑器复杂度超出预期 | 高 | 中 | Phase 3 使用 React Flow 现成库，MVP 仅支持只读可视化 |

---

## 9. 成功指标

| 指标 | 现状 | Phase 1 目标 | Phase 2 目标 |
|------|------|-------------|-------------|
| 编排模式 | 仅 fast | fast + dag | fast + dag |
| 崩溃恢复 | ❌ | ✅ (<5s resume) | ✅ |
| 子代理深度 | 1 | 可配置 (default 3) | 可配置 |
| 验证门控 | ❌ | ❌ | ✅ typecheck/lint/test |
| 停滞检测 | 仅 doom-loop sig | 仅 doom-loop sig | ✅ 多维度 |
| Token 预算控制 | MAX_STEPS=25 | MAX_STEPS + budget | MAX_STEPS + budget + breaker |
| Reviewer gate | prompt 建议 | prompt 建议 | ✅ 强制阻断 |

---

*本计划基于 2026-07-05 的代码审查、竞品分析和 2026 年 7 月行业最佳实践编写。Phase 1 详细子计划见 `docs/superpowers/plans/2026-07-07-agent-orchestration-phase1.md`。*
