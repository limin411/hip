# hip 单实例/集群模式与右侧 DAG 面板闭环 — 技术方案

| 字段 | 值 |
|------|-----|
| 作者 | Grok (design pass) |
| 日期 | 2026-07-10 |
| 状态 | **已实现** |
| 相关代码 | `packages/protocol`（orch/workflow messages）、`packages/sidecar/src/session/{session,session-turn-runner,workflow-runner,handlers}`、`packages/sidecar/src/orchestrator/*`、`packages/sidecar/src/persistence/{schema,workflow-store}`、`src/components/chat/ModelPicker.tsx`、`src/components/workflow/*`、`src/store/workflowStore.ts`、`src/components/artifact/ArtifactPanel.tsx`、`src/domain/*` |
| 前置文档 | `docs/agent-orchestration-plan.md`、`docs/superpowers/plans/2026-07-10-architecture-remediation.md` |
| 外部实践参考 | Temporal durable execution + event history；Temporal Flow / React Flow 只读可视化；AWS Step Functions 状态机可视化 |

---

## Overview

hip 已具备：

1. 会话级 `orchMode: 'fast' | 'dag'`（UI 文案：单实例 / 集群）
2. 后端 DAG 引擎（`runWorkflow` / `DurableExecutor` + SQLite `workflow_*` 表）
3. 右侧 Code 面板 `DagEditor`（React Flow）+ `workflowStore`

但三者**未形成产品闭环**：切换集群模式后普通发消息仍走 StateGraph；`pendingWorkflowDef` 无写入点；编排事件不进前端；DAG 面板无数据源。

本方案目标：**在不重写编排引擎的前提下，打通「模式开关 → 默认/显式工作流执行 → 耐久落盘 → 实时/恢复可视化」**，使集群模式成为可感知、可恢复、可调试的一等路径。

**范围（v1）：** 只读 DAG 可视化 + 内置默认工作流模板 + 协议/投影闭环。  
**非目标（v1）：** 可视化 DAG 编辑器写回、自定义模板市场、跨会话 workflow 共享库、tool/human 节点完整执行（协议保留，执行 fail-closed 可延后）。

---

## Background & Motivation

### 现状（代码核实）

| 能力 | 状态 | 位置 |
|------|------|------|
| UI 模式切换 | ✓ ModelPicker 双按钮 | `ModelPicker.tsx` |
| 模式持久化 | ✓ `sessions.config` JSON 中的 `orchMode` | `handlers/session.ts` → `store.updateConfig` |
| 主循环分支 | 半成品：`orchMode==='dag' && pendingWorkflowDef` | `session-turn-runner.ts` ~L489–501 |
| `pendingWorkflowDef` 赋值 | **✗ 全库无写入**，仅清空 | `session-turn-runner.ts` |
| `workflow:run` 客户端消息 | 协议有、handler 有、**前端不发** | `messages.ts`, `handlers/session.ts` |
| DurableExecutor + workflow 表 | ✓ | `workflow-store.ts`, `main.ts` WORKFLOW_DDL |
| OrchestratorEvent → agent 轨迹 | ✓（agent:started/finished） | `workflow-runner.ts` eventSink |
| OrchestratorEvent → 前端 WS | **✗** ServerMessage 无 workflow 事件 | `messages.ts` |
| `workflowStore.setActiveWorkflow` | **✗ 仅测试调用** | `workflowStore.ts` |
| DAG 面板 | ✓ 有 workflow 则渲染，否则空态 | `ArtifactPanel.tsx` |
| 会话加载恢复 workflow | **✗** | `session:loaded` 无 run 快照 |

### 用户可感知症状

1. 点「集群模式」→ 发消息 → 行为与单实例几乎相同。
2. 打开右侧 DAG → 永远「No workflow active」。
3. 若未来走 `workflow:run`，Agents 面板有节点轨迹，DAG 仍空。

### 外部最佳实践（用于设计约束）

| 来源 | 可借鉴点 | 对本方案的含义 |
|------|----------|----------------|
| **Temporal Durable Execution** | 每步写入 event history；崩溃可 resume；UI 靠 history 回放 | 继续用 `workflow_events` + `saveRun`；前端以事件流为主、快照为辅 |
| **Temporal Web UI / Temporal Flow** | 拓扑图 + 时间线 + 节点着色；parent/child 导航 | v1 只读 React Flow；节点状态与 `RunState` 对齐；Agents 与 DAG 双视角并存 |
| **AWS Step Functions** | 执行视图 = 定义 + 当前状态叠加，而非只给日志 | `WorkflowDef` 一次下发，后续只推 delta 事件 |
| **Airflow / DolphinScheduler** | DAG 定义与 run 实例分离 | 表：`workflow_defs` vs `workflow_runs`；会话绑定 run 而非仅 def |

**反模式（避免）：**

- 仅改 UI 文案不改变执行路径（当前状态）。
- 前端自己猜图（无 def 仅从 agent 列表拼图）。
- 用完整 `RunState` 轮询替代事件流（延迟高、与 reduce 语义脱节）。
- 在 turn 中途允许切换 orchMode（已有 running 门禁，保持）。

---

## Goals / Non-Goals

### Goals

1. **G1 — 模式语义真实**：`orchMode==='dag'` 时，用户下一条用户消息走 DAG 路径；`fast` 走现有 StateGraph。
2. **G2 — 默认可运行**：无需用户手写 `WorkflowDef`；提供内置默认模板，用用户消息作为 `runInputs`。
3. **G3 — 可视化闭环**：DAG 运行时右侧面板可显示拓扑 + 实时节点状态；运行开始可自动切到 DAG tab（可配置/可关）。
4. **G4 — 耐久与恢复**：进程/WS 重连后能恢复「当前/最近一次」run 的 def + state；会话切换按 session 隔离。
5. **G5 — 双面板一致**：Agents 面板继续显示 agent 轨迹；DAG 显示结构与门控；二者同源（同一 run）。
6. **G6 — 可测**：协议、sidecar 分支、前端 store 投影均有单测；至少一条 e2e/集成路径。

### Non-Goals（明确延后）

- N1 可视化拖拽编辑 / 保存自定义 DAG 到文件
- N2 完整 `tool` / `human` / 嵌套 `parallel` 执行（v1 默认模板仅用 `agent` + 可选 `gate`）
- N3 跨会话 workflow 模板库 / hip.toml teams 深度集成（计划文档 Phase 3 另做）
- N4 集群模式下替换全部 plan/forcePlan 语义（两者正交：plan 是 StateGraph 内环；dag 是外层编排）

---

## Problem Decomposition（五条断点）

```
[A] UI orchMode ──► [B] pendingWorkflowDef / 入口
                              │
                              ▼
                    [C] runWorkflowTurn + DurableExecutor
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        [D] SQLite      [E] agent 事件   [F] 前端 workflow 事件 ✗
        workflow_*      (已有)           → workflowStore → DagEditor
```

修复顺序必须是 **B → F → D 增强 → A 体验**，C 已基本可用。

---

## Key Decisions

### D1 — 集群模式下用户消息如何触发 DAG（入口统一）

**决策：主循环入口，不强制前端发 `workflow:run`。**

当 `orchMode === 'dag'` 且本 turn 是用户 `message:send`：

1. 若已有 `pendingWorkflowDef`（显式预置）→ 使用之。
2. 否则 → 用 **内置默认模板** 生成 `WorkflowDef`，用户文本作为 `runInputs.text`。
3. 然后进入现有 `runWorkflowTurn`。

`workflow:run` 保留为高级/测试/未来编辑器入口：直接执行传入 def，**不要求** orchMode 已是 dag（但会建议前端在 dag 模式下才暴露）。

**理由：** 产品文案承诺「集群模式 = DAG 工作流」；若仍要求用户另发 def，开关无意义。Temporal/Step Functions 的默认体验也是「选状态机 → 带 input 跑一次」，而不是「先切模式再单独 post 定义」。

**否决方案：** 仅文档说明用户须手动 `workflow:run`（零可用性）。

### D2 — 默认工作流模板（v1 内置）

**决策：固定内置模板 `builtin:cluster-default`，非 LLM 动态构图。**

v1 默认图（最小有用）：

```
entry: [planner]
planner (agent) ──► coder (agent) ──► verifier (gate: typecheck, optional fail soft?)
                         │
                         └──► (edge always)
```

更具体的 v1 节点（可落地）：

| id | type | 说明 |
|----|------|------|
| `planner` | agent, agentId=`worker` | 输入 `{{input}}`：拆解任务与验收标准 |
| `coder` | agent, agentId=`worker` | 输入含 planner 输出：实现变更 |
| `gate_typecheck` | gate, kind=`typecheck` | cwd 下 typecheck；失败则 run failed |

**简化选项（若 typecheck 过脆）：** 默认模板先 **线性双 agent 无 gate**，gate 作为模板 v1.1 或 `HIP_DAG_DEFAULT_GATES=1` 开关。

**推荐 v1 ship：** 线性 `planner → coder` **无 gate**（稳定）；在 DAG 图上仍能演示并行/状态色；gate 作为第二内置模板 `builtin:cluster-with-gates` 可选（设置项或后续）。

模板构建函数：

```ts
// packages/sidecar/src/session/builtin-workflows.ts
export function buildClusterDefaultWorkflow(opts: {
  sessionId: string
  userText: string
}): WorkflowDef
```

- `id`: `wf-${sessionId}-${turnStamp}` 或稳定 `builtin-cluster-default` + 每次 run 新 runId  
- **def id**：可用稳定 id `builtin:cluster-default`（便于 saveDef 覆盖）；**runId** 用 turnId（与现 workflow-runner 一致）
- 节点 `inputTemplate`：`{{input}}` / `{{planner}}` 等，走现有 `resolveInput`

**否决方案：** 每 turn 让 LLM 生成 WorkflowDef JSON（不可靠、难测、延迟大）。动态构图放 Phase 后。

### D3 — 协议：OrchestratorEvent 如何到达前端

**决策：新增 ServerMessage 族，事件流 + 生命周期快照。**

```ts
// Client（可选增强）
| { type: 'workflow:run'; sessionId: string; def: WorkflowDef; runInputs?: { text: string } }
| { type: 'workflow:getActive'; sessionId: string }  // 重连/切会话拉取

// Server
| {
    type: 'workflow:started'
    sessionId: string
    runId: string
    def: WorkflowDef
  }
| {
    type: 'workflow:event'
    sessionId: string
    runId: string
    event: OrchestratorEvent
  }
| {
    type: 'workflow:snapshot'
    sessionId: string
    runId: string
    def: WorkflowDef
    state: RunState
  }
| {
    type: 'workflow:cleared'  // 切到 fast 或无活跃 run
    sessionId: string
  }
```

**发送策略（对齐 Temporal history）：**

1. `runWorkflowTurn` 开始：`workflow:started`（含完整 def）
2. 每次 `eventSink.emit`：**额外** `workflow:event`（与现有 agent:* 并行，不替换）
3. 结束（succeeded/failed/cancelled）：`workflow:snapshot` 终态
4. `session:load` / `workflow:getActive`：若有最近 run → `workflow:snapshot`

**否决方案：** 只发 snapshot 不发 event（UI 卡顿、无法做 running 动画）；只改 agent 消息让前端反推图（无边、无 gate）。

### D4 — 会话与 workflow run 的绑定

**决策：`workflow_runs` 增加 `session_id` 列（可空兼容），并维护「每会话最近一次 run」。**

迁移：

```sql
ALTER TABLE workflow_runs ADD COLUMN session_id TEXT;
CREATE INDEX IF NOT EXISTS idx_workflow_runs_session
  ON workflow_runs(session_id, updated_at DESC);
```

API：

- `SqliteWorkflowStore.saveRun` 接受 optional sessionId（或单独 `bindSession`）
- `loadLatestRunForSession(sessionId): { def, state } | null`

**否决方案：** 把整个 RunState 塞进 `sessions.config`（膨胀、无事件日志）。

### D5 — 前端 store 模型

**决策：`workflowStore` 改为 per-session，避免多会话串台。**

```ts
// 概念模型
{
  bySession: Record<sessionId, {
    activeWorkflow: WorkflowDef | null
    runState: RunState | null
    runId: string | null
  }>
}
```

- `workflow:started` → set def + init runState
- `workflow:event` → applyEvent（现有 reducer 逻辑复用）
- `workflow:snapshot` → set def + setRunState
- `workflow:cleared` / session destroy → clear
- 切换 `activeSessionId` → ArtifactPanel 读当前 session 切片

`applyServerMessageEffects` 或 `sessionStore.apply` 中处理上述消息（与现有 fs/diff 副作用路由一致；**领域投影优先放 domain 或 effects，避免 SessionService 变胖**）。

### D6 — 自动打开 DAG 面板

**决策：`workflow:started` 时，若当前 surface 为 code 且面板未关，则 `setTab('dag')` 并确保 `codePanelOpen`。**

- 可用 ui 偏好 `autoOpenDagOnClusterRun` 默认 true（后续可设置页关闭）
- chat surface 无 DAG tab：不强制切 view

### D7 — 与 plan / permission / cancel 的交互

| 能力 | 集群模式行为 |
|------|----------------|
| Cancel | 现有 abort → orchestrator run:cancelled → workflow:event |
| Permission / HITL | agent 节点沿用 session 权限；orchestrator-adapter 对外部 agent 仍可 auto-reject（保持现状，另开 issue 增强） |
| forcePlan / disablePlan | **不进入** StateGraph 时忽略；文档说明集群模式优先 |
| Regenerate | v1：按 fast 语义 regenerate 最后一轮；若最后一轮是 workflow，再跑同一 def 新 runId（实现时与 regenerate 路径对齐） |
| 切换 orchMode | running 中拒绝（已有）；idle 切到 fast 发 `workflow:cleared`（可选） |

### D8 — `workflow:run` 与主循环关系

| 入口 | 行为 |
|------|------|
| `message:send` + orchMode=dag | 内置模板或 pendingDef → `runWorkflowTurn` |
| `workflow:run` | 立即 `runWorkflowTurn(def)`；若 session running 则 error 或排队（v1：**error busy**） |
| `pendingWorkflowDef` | 保留字段：API/测试可 set；`message:send` 优先消费并清空 |

统一所有路径都发射 D3 协议消息。

---

## Architecture

### 目标数据流

```
User toggles Cluster (orchMode=dag)
        │
        ▼
sessions.config.orchMode  (SQLite)
        │
User message:send
        │
        ▼
runTurn()
  ├─ fast ──────────────────────► StateGraph (unchanged)
  └─ dag ─► resolveWorkflowDef()
              │  pendingWorkflowDef ?? buildClusterDefaultWorkflow()
              ▼
         runWorkflowTurn()
              │
              ├─ workflow:started ──────────────► frontend workflowStore + open DAG
              ├─ DurableExecutor.runWorkflow()
              │     ├─ reduce + saveRun/appendEvent (session_id bound)
              │     ├─ eventSink → agent:* (Agents panel)
              │     └─ eventSink → workflow:event (DAG panel)
              ├─ aggregate outputs → finalizeAndPersist (messages)
              └─ workflow:snapshot (terminal)
```

### 模块边界

| 模块 | 职责 |
|------|------|
| `builtin-workflows.ts` | 默认模板工厂 |
| `workflow-runner.ts` | 执行 + 发 WS 协议；绑定 sessionId |
| `workflow-store.ts` / schema | session_id、latest run 查询 |
| `session-turn-runner.ts` | dag 分支：resolve def 后调用 runner |
| `handlers/session.ts` | `workflow:getActive`；`workflow:run` 忙碌检查 |
| `protocol/messages.ts` | 新消息类型 + guard |
| `workflowStore.ts` | per-session 投影 |
| `serverMessageEffects` / `sessionStore` | 接入消息 |
| `ArtifactPanel` / `PanelToggle` | 空态文案、auto tab |
| `ModelPicker` | 可选：集群模式 tooltip 说明「下一条消息走 DAG」 |

---

## Detailed Design

### 1. 默认模板内容（建议 ship 版本）

```ts
export function buildClusterDefaultWorkflow(): WorkflowDef {
  return {
    id: 'builtin:cluster-default',
    name: 'Cluster Default',
    entry: ['planner'],
    nodes: [
      {
        type: 'agent',
        id: 'planner',
        agentId: 'worker',
        inputTemplate:
          'You are the planner. Break down the user request into concrete steps and acceptance criteria.\n\nUser request:\n{{input}}',
      },
      {
        type: 'agent',
        id: 'coder',
        agentId: 'worker',
        inputTemplate:
          'You are the implementer. Execute the plan. Prefer minimal correct changes.\n\nPlan:\n{{planner}}\n\nOriginal request:\n{{input}}',
      },
    ],
    edges: [{ from: 'planner', to: 'coder' }],
  }
}
```

并行演示模板（可选第二模板，不默认）：

```
entry: [research_a, research_b]
research_* → synthesizer (merge via post-aggregator 已有逻辑)
```

v1 **不必**上线第二模板；默认线性即可满足「集群 ≠ 单循环」的产品差异。

### 2. `runTurn` 分支伪代码

```ts
if (host.orchMode === 'dag') {
  const def =
    host.pendingWorkflowDef ??
    buildClusterDefaultWorkflow()
  host.pendingWorkflowDef = null
  return runWorkflowTurnFn(
    host.workflowDeps,
    def,
    rawSend,
    finalize,
    { runInputs: { text: /* last user text from host */ } },
  )
}
```

**注意：** 今日 `runWorkflowTurn` 的 `runInputs` 未从用户消息注入。需扩展：

```ts
export async function runWorkflowTurn(
  deps, def, send, finalize,
  opts?: { runInputs?: NodeOutput },
)
```

`resolveInput` 已支持 `{{input}}` → `runInputs`。用户文本从 turn 上下文取得：

- `runTurn` 在 dag 分支时从 `host.messages` 最后一条 HumanMessage，或
- 更好：`processInput` / `sendMessage` 把本轮 user text 传入 `runTurn` 参数。

### 3. eventSink 双写

```ts
const eventSink: OrchestratorEventSink = {
  emit(e) {
    // existing agent mapping...
    send({
      type: 'workflow:event',
      sessionId: deps.id,
      runId: turnId,
      event: e,
    })
  },
}
// before run:
send({ type: 'workflow:started', sessionId: deps.id, runId: turnId, def })
// after run:
send({ type: 'workflow:snapshot', sessionId: deps.id, runId: turnId, def, state: runState })
```

### 4. Schema migration

不走 `user_version` 大迁移亦可：`main.ts` 已对 WORKFLOW_DDL 做 `CREATE IF NOT EXISTS`。增量：

```ts
// schema.ts
export const WORKFLOW_RUNS_SESSION_DDL = `
  -- applied with try/catch ALTER for existing DBs
`
```

或在 `SqliteWorkflowStore` 构造时 `PRAGMA table_info` 探测后 ALTER。

### 5. 前端空态与 i18n

替换英文硬编码空态：

- zh-CN：`当前无活跃工作流。切换到集群模式并发送消息后，将在此显示 DAG。`
- en：`No active workflow. Switch to Cluster Mode and send a message to visualize the DAG.`

### 6. message-guard

`message-guard.ts` / 解析器加入新 client types：`workflow:getActive`；server 侧若有严格校验一并加入。

### 7. 运行中切换模式

保持 `setOrchMode` running → false。  
前端：running 时禁用切换按钮（ModelPicker `disabled` when session status running）。

---

## UX Spec

### ModelPicker

- 单实例 / 集群切换不变。
- Tooltip：
  - 单实例：单 Agent 循环，最大 25 步
  - 集群：DAG 多节点编排；下一条消息按默认工作流执行
- running 时按钮 disabled + title 说明

### 右侧 DAG

| 状态 | 展示 |
|------|------|
| 无 workflow | 引导空态（见上） |
| started | 图 + 全部 pending/ready，RunStateOverlay Running |
| 节点推进 | 着色 + 悬停 output |
| 结束 | 终态色 + Complete/Failed |
| 切会话 | 显示该会话最近 run；无则空态 |

### Agents 面板

行为不变；节点仍映射为 worker agentId=nodeId。  
可选后续：AgentCard 显示「DAG node」徽章（非 v1 必须）。

---

## Testing Plan

### Protocol

- 新 ServerMessage / ClientMessage 类型可赋值、guard 接受/拒绝

### Sidecar

| 测试 | 断言 |
|------|------|
| orchMode=dag + sendMessage | 调用路径进入 workflow（mock runner），发出 `workflow:started` |
| orchMode=fast | 不发 workflow:started |
| pendingWorkflowDef 优先于 default | 使用 pending 的 id |
| eventSink | 每个 reduce 事件对应 `workflow:event` |
| DurableExecutor + session_id | loadLatestRunForSession 返回 |
| running 时 setOrchMode | false，config 不变 |
| workflow:run while running | error busy |

### Frontend

| 测试 | 断言 |
|------|------|
| workflowStore per-session | A/B 互不覆盖 |
| apply workflow:started/event/snapshot | runState 正确 |
| ArtifactPanel | 有 workflow 渲染 DagEditor |
| 空态文案 i18n key 存在 |

### Integration（可选但推荐）

- FakeListChatModel / FakeAgentRunner 跑默认 2 节点图，收齐 started→events→snapshot→message:complete

---

## Rollout / Feature Flag

**建议：无 feature flag，直接修闭环**（能力半成品比隐藏更糟）。  
若需谨慎：

```ts
const CLUSTER_MODE_LIVE = process.env.HIP_CLUSTER_MODE !== '0'
```

`orchMode=dag` 但 flag off 时：UI 可提示「即将推出」或强制 fall through 并 toast——**不推荐**，优先完整修。

---

## Risks & Mitigations

| 风险 | 等级 | 缓解 |
|------|------|------|
| 默认双 agent 成本/延迟高 | Med | 模板可改单 agent；或设置「轻量集群」 |
| typecheck gate 误杀 | Med | v1 默认模板不含 gate |
| 事件洪水撑爆 WS | Low | 节点数有限；不做 token 级 workflow 事件 |
| per-session store 内存 | Low | 仅保留最近 run；切会话可 GC 非 open sessions |
| `{{input}}` 未注入导致空跑 | High | 单测强制断言 runInputs |
| 与 plan 环语义混淆 | Med | 文档 + UI tooltip 澄清 |

---

## Implementation Phases（PR Plan）

### PR-1：协议与 guard

**标题：** `feat(protocol): workflow started/event/snapshot messages`

**文件：**

- `packages/protocol/src/messages.ts`
- `packages/protocol/src/message-guard.ts`（及 contract tests）
- 相关 `*.contract.test.ts` / `messages` 测试

**内容：** 新增 Server/Client 类型；`workflow:run` 可选扩展 `runInputs`；guard 白名单。

**依赖：** 无  
**验收：** `yarn test` protocol 包通过。

---

### PR-2：内置模板 + runTurn 真实进入 DAG + runInputs

**标题：** `feat(sidecar): cluster mode runs builtin workflow on message:send`

**文件：**

- `packages/sidecar/src/session/builtin-workflows.ts`（新）
- `packages/sidecar/src/session/builtin-workflows.test.ts`
- `packages/sidecar/src/session/session-turn-runner.ts`
- `packages/sidecar/src/session/workflow-runner.ts`（runInputs）
- `packages/sidecar/src/session/session.test.ts`（扩展 orchMode 测试）

**内容：**

- `buildClusterDefaultWorkflow`
- `orchMode==='dag'` 时始终 resolve def（pending ?? default），**不再 fall through**
- 注入本轮用户文本到 `runInputs`
- 保持 cancel/error 行为

**依赖：** PR-1（若本 PR 先不发 WS 事件，可独立；建议与 PR-3 紧耦合）  
**验收：** 单测证明 dag 模式不走 graph fallthrough；fast 不变。

---

### PR-3：WS 事件发射 + session 绑定持久化

**标题：** `feat(sidecar): emit workflow UI events and bind runs to sessions`

**文件：**

- `packages/sidecar/src/session/workflow-runner.ts`
- `packages/sidecar/src/persistence/schema.ts` / `workflow-store.ts`
- `packages/sidecar/src/main.ts`（迁移）
- `packages/sidecar/src/session/handlers/session.ts`（`workflow:getActive`）
- 对应 tests

**内容：**

- started / event / snapshot 发送
- `session_id` 列 + `loadLatestRunForSession`
- session:load 后可选自动 push snapshot（或仅 getActive）

**依赖：** PR-1, PR-2  
**验收：** 集成测试收集 send 回调中含 workflow:* 序列。

---

### PR-4：前端投影 + per-session workflowStore + DAG 空态

**标题：** `feat(ui): project workflow events into DAG panel`

**文件：**

- `src/store/workflowStore.ts` (+ tests)
- `src/domain/serverMessageEffects.ts` 或 `sessionStore.ts`
- `src/domain/sessionService.ts`（load 时 getActive）
- `src/components/artifact/ArtifactPanel.tsx`
- `src/i18n/{en,zh-CN,zh-TW}.ts`
- `src/components/chat/ModelPicker.tsx`（running disable）
- `src/store/uiStore.ts`（可选 autoOpenDag）

**内容：**

- per-session 状态
- 消息应用
- 空态 i18n
- `workflow:started` → setTab('dag') + open panel
- session 切换显示对应切片

**依赖：** PR-1, PR-3  
**验收：** 组件/store 单测；手动：集群模式发消息见 DAG 着色。

---

### PR-5：打磨与回归

**标题：** `chore: cluster mode UX polish and regression tests`

**内容：**

- regenerate / destroy / clear session 清理 workflow 状态
- 文档：更新 `docs/agent-orchestration-plan.md` 状态「闭环完成」
- CLAUDE.md 或用户可见说明一句
- 全量 `yarn test` 相关包 + 关键 sidecar session tests

**依赖：** PR-1–4  
**验收：** 无回归；DAG 与 Agents 同时有意义的数据。

---

## Success Criteria（完成定义）

1. 新会话 → 选集群模式 → 发「写一个 hello」类请求 → **进入 DAG 路径**（日志/测试可证）。
2. 右侧 DAG **自动或手动**可见默认两节点图，状态从 pending→running→succeeded/failed。
3. Agents 面板仍显示对应 agent 活动。
4. 杀 sidecar 重连或 `session:load` 后，**最近一次 run** 仍可在 DAG 看到终态（或 running 可 resume——resume 已有 DurableExecutor，UI 至少 snapshot）。
5. 切回单实例 → 下一条消息走 StateGraph，无错误 workflow 事件。
6. running 中无法切换 orchMode。

---

## Open Questions（需产品拍板）

1. **默认模板是否含 gate？**  
   - 推荐：**v1 不含**（稳定）；v1.1 加 `builtin:cluster-with-gates`。  
2. **集群模式是否允许「仅单 worker 节点」轻量模板？**  
   - 可选设置 `clusterTemplate: 'simple' | 'plan-code'`。  
3. **`workflow:started` 是否强制打开 DAG tab？**  
   - 推荐默认开，设置可关。  
4. **Chat surface 是否也要 DAG？**  
   - 推荐 v1 **否**（与 terminal 一致，仅 code）；chat 仍可设 orchMode 但无图（或仅 Agents）。  
5. **动态 LLM 构图时间表？**  
   - 明确不在本方案；避免阻塞闭环。

---

## Alternatives Considered

| 方案 | 说明 | 结论 |
|------|------|------|
| A. 仅修 UI 接 agent 事件拼图 | 无 def/边/gate | 否：语义不全 |
| B. 前端发 workflow:run，模式只是 flag | 用户需两步 | 否：开关无体感 |
| C. 主循环 + 内置模板 + 事件流（本方案） | 复用引擎 | **采用** |
| D. 引入 Temporal 服务 | 过重 | 否：本地 SQLite 已够 |
| E. 可编辑 React Flow 写回 def | 范围爆炸 | 延后 Phase |

---

## Appendix A — 现状断点索引

| 断点 | 文件 |
|------|------|
| pending 无写入 | `session.ts` / 全库 grep `pendingWorkflowDef =` 仅 clear |
| fallthrough | `session-turn-runner.ts` L489–502；`session.test.ts` fallthrough 用例将**改写**为「dag 必进 workflow」 |
| 无 WS workflow 事件 | `messages.ts` ServerMessage |
| setActiveWorkflow 无生产调用 | `src/**` 仅 test |
| 空态硬编码 | `ArtifactPanel.tsx` L99–101 |

## Appendix B — 与 agent-orchestration-plan 的关系

本方案完成该计划 Phase 1 中「DAG 模式集成到主循环」的**产品可用性缺口**，以及 Phase 3.4「DAG 可视化」的**只读观测闭环**。不替代 Phase 2 gate 框架（已有）的增强，也不做 teams/blackboard 产品化。

---

## PR Plan（摘要表）

| PR | 标题 | 依赖 | 价值 |
|----|------|------|------|
| PR-1 | protocol workflow UI messages | — | 契约 |
| PR-2 | builtin workflow + runTurn 分支 | PR-1（弱） | 模式语义真实 |
| PR-3 | emit events + session_id 持久化 | PR-1,2 | 耐久/可观测 |
| PR-4 | frontend store + DAG 面板 | PR-1,3 | 用户可见闭环 |
| PR-5 | polish + docs + regression | PR-1–4 | 可发布 |

---

## Key Decisions（汇总）

1. **集群模式 = 下一条用户消息必走 DAG**（默认内置模板），不再 silent fallthrough。  
2. **默认模板线性 planner→coder，无 gate**（稳定优先）。  
3. **协议采用 started + event 流 + snapshot**（Temporal-like）。  
4. **workflow_runs 绑定 session_id**，支持 load 恢复。  
5. **前端 per-session workflowStore**，DAG 只读可视化。  
6. **保留 workflow:run 高级入口**；与 message:send 共用 runner 与事件协议。  
7. **不引入外部编排服务**；复用现有 DurableExecutor。
