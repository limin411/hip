# Plugin Hooks 贯通 Spec（主循环 + 子 agent + 智能体工作流）

| 字段 | 值 |
|------|-----|
| 日期 | 2026-07-12 |
| 状态 | **Implemented** |
| 范围 | Sidecar `HookRegistry` 加载与触发；`ToolRunner` / `runSubagent` / `runManagedAgent` / `runWorkflowTurn`；协议 `HookContext`；设置页只读文案 |
| 前置 | 主会话 ReAct 路径已具备插件 hook 加载与 ToolRunner 触发；设置页「挂钩配置」只读鱼骨图已上线 |
| 现状代码 | `packages/sidecar/src/session/hooks/*`、`tool-runner/*`、`subagent.ts`、`internal-runner.ts`、`workflow-runner.ts`、`orchestrator-adapter.ts`、`session-turn-runner.ts`、`config-manager.ts`；`packages/protocol/src/hooks.ts` |
| 对照 | Claude Code hooks、OpenAI Agents SDK `RunHooks`/`AgentHooks`、Codex `hook_runtime`、Hermes `pre_tool_call`、pi AgentHarness observe/on |
| 关联 plan | [`../plans/2026-07-12-hooks-workflow-parity.md`](../plans/2026-07-12-hooks-workflow-parity.md) |

---

## 1. Overview

### 1.1 问题

hip 已有完整 hook **协议 + 注册表 + 主会话 ToolRunner 管道**，但 **不是所有会执行工具的路径都接入 `host.hooks`**：

| 路径 | 插件 `HookRegistry` | 工具 Pre/Post | 回合 Turn* |
|------|---------------------|---------------|------------|
| 主会话 ReAct（builtin / env model） | ✅ 加载 | ✅ | ✅ |
| `task` / 子 agent（`runSubagent`） | session 有 registry，**未透传** | ❌ | ❌ |
| 内部 managed agent（`runManagedAgent`） | 未透传 | ❌ | ❌ |
| **智能体工作流**（`workflow:run` / `orchMode: dag`） | 未注入 `WorkflowRunDeps` | ❌ | ❌（`workflow:run` 还跳过 processInput） |
| Gate 节点 | — | ❌ | ❌ |
| 外部 ACP 会话 | `loadPluginComponents` 跳过 | N/A | N/A |

结果：设置页显示「已配置 PreToolUse」时，**工作流节点与子 agent 工具调用仍可能完全绕过 hook**。这与业界「工具执行单一 chokepoint」不一致，也削弱安全门禁与审计价值。

### 1.2 目标

| ID | 目标 |
|----|------|
| G1 | **Single chokepoint** — 凡 hip 内建工具环（主图 / 子 agent / managed / workflow worker）执行工具，必须经 `ToolRunner`（或等价路径）且注入同一 session `HookRegistry` |
| G2 | **工作流通达** — agent 节点（builtin worker 与经 invoker 的 internal loop）工具 hook 与主会话同语义 |
| G3 | **回合边界** — workflow run 至少 fire `TurnStart` + `TurnComplete`；有用户文本时 fire `UserPromptSubmit` |
| G4 | **上下文可区分** — `HookContext` 携带 `runId` / `nodeId` / `agentId` / `parentAgentId`，便于插件按路径策略 |
| G5 | **失败策略明确** — 安全门 fail-closed；观察类 fail-open |
| G6 | **回归不破** — 现有 `hooks.integration` / permission-hook / ToolRunner 测试保持绿 |
| G7 | **UI 诚实** — 挂钩配置页文案标明生效路径（主循环 / 子 agent / 工作流），避免「已配置 = 全路径生效」误解 |

### 1.3 非目标

| ID | 非目标 |
|----|--------|
| NG1 | 引入 shell / HTTP / prompt / agent 多 handler 类型（保持插件 CJS `handler`） |
| NG2 | Claude 全量 20+ 事件（`PreCompact`、`Worktree*`、`Elicitation` 等） |
| NG3 | 本期实现 `SubagentStart` / `SubagentStop` 新协议事件（列入后续；P0 用 context 字段区分） |
| NG4 | Gate 节点 PreToolUse / 工作流 HITL 完整 UI（策略见 §3.6） |
| NG5 | 外部 ACP 会话强制加载插件 hook |
| NG6 | 改写 permission mode 产品语义或 guardian 策略 |
| NG7 | 设置页可编辑 hook 配置 |

### 1.4 原则

1. **Hooks run inside the agent loop** — 在副作用之前裁决，不依赖模型自觉。
2. **Hooks only tighten** — `allow` 不绕过 permission / guardian / profile 工具黑名单。
3. **One registry, many runners** — session 级 `HookRegistry`；run 级透传，不复制注册表。
4. **Surgical** — 优先透传与接线；不重写 orchestrator DAG 语义。
5. **Test what you wire** — 每个新路径至少一条 deny 集成测。

---

## 2. 背景与对照

### 2.1 业界分层

| 粒度 | 事件 | hip 对应 |
|------|------|----------|
| Session | SessionStart / End | 已有 SessionStart；End 非本期 |
| Turn / Run | UserPromptSubmit, TurnStart, Stop, TurnComplete | 主会话有；workflow 补齐 |
| Tool | Pre / Permission / Post / Failure | 主 ToolRunner 有；需透传 |
| Delegation | SubagentStart/Stop | 后续；context 先带 agentId |

OpenAI Agents SDK：**RunHooks**（整次 run）vs **AgentHooks**（单 agent）。hip 用 **session registry + HookContext 路径字段** 等价实现。

### 2.2 聚合语义（保持现 `HookRegistry`）

| kind | 行为 |
|------|------|
| `deny` / `ask` | 终端，短路后续 hook |
| `allow` | 继续 |
| `modify` + `modifiedInput` | 链式改写 toolInput；`updatedInput` 兼容 |
| `continue` + `prompt` | 仅 `Stop` 续写语义 |
| `additionalContexts` | 拼接 |
| crash / timeout (5s) | Pre/Permission/UserPrompt/TurnStart → **deny**；Post*/TurnComplete → log + continue |

### 2.3 插件加载（不变）

- `ConfigManager.loadPluginComponents`：`synthesizePlugin` → CJS `require` → `register`。
- 内联 JSON hooks 数组仍拒绝（无 function handler）。
- external agent：仍跳过插件组件加载。

---

## 3. 设计

### 3.1 目标架构

```text
Session.hooks : HookRegistry
        │
        ├─ processInput / runTurn (fast path)          [已有]
        │     └─ buildSessionTooling → ToolRunner
        │
        ├─ spawnSubagent / task                         [P0 补透传]
        │     └─ runSubagent({ hooks }) → GraphCtx.hooks → ToolRunner
        │
        ├─ dispatch / invoker internal loop             [P0]
        │     └─ runManagedAgent({ hooks }) → GraphCtx.hooks
        │
        └─ runWorkflowTurn                              [P0+P1]
              ├─ fire UserPromptSubmit? / TurnStart
              ├─ WorkflowRunDeps.hooks = host.hooks
              ├─ createSessionAgentRunner extras.hooks
              ├─ worker: runSubagent({ hooks, ... })
              └─ fire Stop? / TurnComplete
```

**Invariant：** 任何 hip 自管的 `buildGraph` 工具节点，`GraphCtx.hooks` 非空时必须等于 session registry 引用（或测试用同一语义的 stub）。

### 3.2 HookContext 扩展

```ts
// packages/protocol/src/hooks.ts
export interface HookContext {
  sessionId: string
  turnId?: string
  activityId?: string
  stepsRequested?: number
  toolName?: string
  toolInput?: Record<string, unknown>
  toolOutput?: string
  toolError?: string
  /** Workflow run id (often equals turnId for workflow turns). */
  runId?: string
  /** Workflow node id when the active agent is a DAG node. */
  nodeId?: string
  /** Executing agent frame: supervisor | worker | node id | subagent-* */
  agentId?: string
  parentAgentId?: string
}
```

- 字段均为可选；旧 hook 忽略即可。
- 主会话 tool 调用：填 `sessionId`、`turnId`、`agentId: 'supervisor'`（若易得）。
- 子 agent：`agentId` + `parentAgentId: 'supervisor'`。
- 工作流：`runId`、`nodeId`、`agentId`（节点 id 或 worker）。

### 3.3 事件矩阵（规范性）

| Event | 主会话 | 子 agent | Workflow agent 节点 | Workflow gate | 可阻断 |
|-------|--------|----------|---------------------|---------------|--------|
| `SessionStart` | 首轮 processInput | ❌ | 仅 session 级（已有则不重复） | ❌ | 否（现 void；见 Open） |
| `UserPromptSubmit` | ✅ | ❌ | **有用户文本时 fire**（§3.5） | ❌ | 是 |
| `TurnStart` | ✅ | ❌ | **每个 workflow run 一次** | ❌ | 是 |
| `PreToolUse` | ✅ | **必须** | **必须** | ❌ | 是 |
| `PermissionRequest` | ✅ | 有 HITL 时 | **策略 A**（§3.6） | ❌ | 是 |
| `PostToolUse` / `Failure` | ✅ | **必须** | **必须** | ❌ | 否 |
| `Stop` | ✅ | ❌ | **run 结束 fire 一次** | ❌ | continue 语义 |
| `TurnComplete` | ✅ | ❌ | **run 结束 fire 一次** | ❌ | 否 |
| `Activity*` | 现有 | 不强制 | 不强制 | ❌ | 预算 |

Gate：**本期不 fire 工具 hook**。可选后续 `GateStart`/`GateEnd` 观察事件（非本期）。

### 3.4 P0 — 透传（安全门）

#### 3.4.1 `runSubagent`

- `RunSubagentArgs` 增加 `hooks?: HookRegistry`。
- `GraphCtx` 设置 `hooks: args.hooks`（及可选 `sessionId` 已有）。
- `getOrCreateToolRunner` 已读 `ctx.hooks` — 无需改 ToolRunner 核心。
- 递归 `childSpawn` 继续透传同一 `hooks`。

#### 3.4.2 `runManagedAgent` / invoker

- `RunManagedAgentArgs` 增加 `hooks?: HookRegistry`。
- `InvokerExtras` 增加 `hooks?: HookRegistry`，internal loop 传入 `runManagedAgent`。
- `createSessionAgentRunner`：`opts` 携带 session hooks 与可选 `requestApproval`。

注意：`ExternalAgentHooks`（ACP permission）与 `HookRegistry` **命名易混** — 代码与注释区分：

- `externalHooks: ExternalAgentHooks` — HITL 桥
- `pluginHooks` / `hooks: HookRegistry` — 插件生命周期

#### 3.4.3 主会话 `spawnSubagent`

- `session-turn-runner` 中 `runSubagent({ ..., hooks: host.hooks })`。
- `requestApproval` 保持现有 HITL 透传（子 agent 已可有审批时，PermissionRequest 继续走 `buildRequestApproval(..., host.hooks)`）。

#### 3.4.4 Workflow worker

- `workflow-runner` 创建 runner 时：

```ts
runSubagent({
  ...,
  hooks: deps.hooks,
  sessionId: deps.id,
  // permissionMode / requestApproval: 见 §3.6
})
```

- `WorkflowRunDeps` 增加 `hooks: HookRegistry`（必填，由 Session 注入；测试可传 `new HookRegistry()`）。

### 3.5 P1 — 工作流回合事件

#### 3.5.1 入口

| 入口 | UserPromptSubmit | TurnStart | Stop | TurnComplete |
|------|------------------|-----------|------|--------------|
| `message:send` + dag | 已在 processInput | **在进入 `runWorkflowTurn` 前或内** fire | run 结束 | run 结束 |
| `workflow:run` | **若 `runInputs?.text` 非空则 fire**；否则跳过 | fire | run 结束 | run 结束 |

#### 3.5.2 语义

- `UserPromptSubmit` / `TurnStart` 返回非 `allow`：不启动 DAG；发 `error` `HOOK_DENIED`（与主会话一致）。
- `TurnComplete`：fire-and-forget（catch log）。
- `Stop`：在 finalize 前 fire；`continue` + `prompt` **本期工作流可忽略续写**（或仅 log），避免与 DAG 终态纠缠。**锁定：workflow 上 Stop 的 `continue` 不注入第二轮 DAG**；仅记录。

#### 3.5.3 避免双 fire

- `processInput` 已 fire `UserPromptSubmit` 后进入 dag 的 `runTurn`：**不要**在 `runWorkflowTurn` 再 fire 一次。
- 实现：`runWorkflowTurn` opts：

```ts
opts?: {
  runInputs?: { text: string; data?: unknown }
  signal?: AbortSignal
  /** When true, skip UserPromptSubmit (already fired by processInput). Default false. */
  skipUserPromptSubmit?: boolean
}
```

- `runTurn` dag 分支传 `skipUserPromptSubmit: true`。
- `Session.runWorkflowTurn` / `workflow:run` 默认 `false`。

### 3.6 工作流 HITL / PermissionRequest — **策略 A（锁定）**

| 情况 | 行为 |
|------|------|
| Pre/Post tool hooks | **始终** fire（有 registry） |
| `requestApproval` 存在 | PermissionRequest 与主会话相同 |
| workflow worker **默认无 HITL** | 不挂 requestApproval（保持现行为） |
| PreToolUse / 分类产生 `ask` 且无 approval transport | **视为 deny**，reason 标明 `no approval transport in workflow`（ToolRunner 已有类似错误；对齐文案） |
| PermissionRequest | 仅当 approval 路径存在时 fire；否则不 fire（与「无 transport」一致） |
| ExternalAgentHooks | 保持 auto-cancel HITL（编排不阻塞） |

**不**在本期做工作流节点 HITL UI（策略 B 列为后续）。

### 3.7 失败与超时

| 事件类 | 超时 | 失败 |
|--------|------|------|
| PreToolUse, PermissionRequest, UserPromptSubmit, TurnStart | 5s | deny / HOOK_DENIED |
| PostToolUse, PostToolUseFailure, TurnComplete, SessionStart(void) | 5s | warn + continue |
| Stop (workflow) | 5s | ignore continue；log errors |

### 3.8 UI / 文档（轻量）

- `settings.hooks.introShort` 或 diagram 旁增加一行：**生效于主循环、子 agent 与工作流 agent 节点的工具调用；Gate / 外部 ACP 除外。**
- 三语 i18n（en / zh-CN / zh-TW）。
- `session/hooks/README.md` 增补路径表。

### 3.9 可观测（可选 P1 尾）

- debug：`logDebug('hooks', 'fire', { event, toolName, agentId, runId, kind, ms })` — 不强制 UI。

---

## 4. 验收标准

### 4.1 功能

| ID | 验收 |
|----|------|
| A1 | 主会话 lifecycle 集成测仍绿（顺序与 deny） |
| A2 | 子 agent：注册 `PreToolUse` deny `run_script` → task 路径工具结果含 hook deny，命令未执行 |
| A3 | workflow worker：同上 deny 生效 |
| A4 | workflow：`TurnStart` 每 run 一次；成功结束 `TurnComplete` 一次 |
| A5 | `workflow:run` + `runInputs.text` → `UserPromptSubmit` 一次；deny 则不跑 DAG |
| A6 | `message:send`+dag → `UserPromptSubmit` **仅** processInput 一次（无双 fire） |
| A7 | PreToolUse `modify` 后工具收到新 args（worker 路径） |
| A8 | external ACP 节点：文档/测试标明不保证插件 PreToolUse |
| A9 | 设置页文案含路径说明 |

### 4.2 非功能

| ID | 验收 |
|----|------|
| N1 | hook 超时仍 5s；热路径不引入额外网络 |
| N2 | 无 hooks 时行为与现网一致（可选 registry 空数组） |
| N3 | Typecheck：protocol 扩展向后兼容（可选字段） |

---

## 5. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 工作流性能：每工具同步 hook | 保持 5s 上限；matcher 过滤；观察类勿做重计算 |
| Stop continue 与 DAG 冲突 | 锁定 workflow 忽略 continue 注入 |
| 双 fire UserPromptSubmit | `skipUserPromptSubmit` 标志 |
| ExternalAgentHooks 命名混淆 | 重命名/注释 + code review checklist |
| 测试只 mock runner 未覆盖真实 ToolRunner | A2/A3 用真实 ToolRunner 或 graph invoke 短路径 |

---

## 6. Key Decisions

| # | 决策 | 理由 |
|---|------|------|
| D1 | P0 先透传 hooks，再补回合事件 | 安全洞优先于生命周期完整 |
| D2 | 策略 A：workflow 无 HITL，ask→deny | 编排不阻塞；仍允许确定性 deny/modify |
| D3 | 本期不新增 SubagentStart/Stop 事件 | 减协议面；用 HookContext 区分 |
| D4 | workflow Stop 忽略 continue | 避免第二轮 DAG 语义不清 |
| D5 | Gate 不接工具 hook | gate 非 LLM 工具环；避免假语义 |
| D6 | `workflow:run` 有 text 时 fire UserPromptSubmit | 与「用户提交」语义对齐 |
| D7 | 安全门 fail-closed，Post fail-open | 与现 registry + 业界治理分层一致 |

---

## 7. Open Questions（已锁定默认）

| Q | 锁定默认 | 可后续改 |
|---|---------|----------|
| PermissionRequest in workflow | 策略 A | 策略 B HITL |
| UserPromptSubmit on workflow:run | 有 text 则 fire | — |
| SubagentStart/Stop | P2 | 协议新增 |
| Post failure | fail-open | — |
| SessionStart deny | 保持 void（不阻断） | 后续可 hardening |

---

## 8. PR Plan

| PR | 标题 | 依赖 | 内容 |
|----|------|------|------|
| **PR1** | `feat(hooks): extend HookContext for run/agent frames` | — | protocol 字段 + 类型导出；无行为变化 |
| **PR2** | `feat(hooks): plumb HookRegistry into subagent and managed agent` | PR1 | `runSubagent` / `runManagedAgent` / invoker extras / main spawnSubagent；单元+集成 deny |
| **PR3** | `feat(hooks): plumb HookRegistry into workflow agent nodes` | PR2 | `WorkflowRunDeps`、adapter、worker；workflow deny 测 |
| **PR4** | `feat(hooks): workflow turn lifecycle events` | PR3 | TurnStart/Complete/UserPromptSubmit + skip 双 fire；Stop 策略 |
| **PR5** | `docs(ui): hooks settings path honesty + README` | PR3+ | i18n + hooks README + 可选 debug |

建议合并顺序 PR1→PR5；PR2 可与 PR1 同批若体积小。

---

## 9. 参考

- Claude Code Hooks: https://code.claude.com/docs/en/hooks
- Speakeasy AI agent hooks 治理综述
- OpenAI Agents SDK lifecycle hooks
- 本地：`codex` hook_runtime、`hermes-agent` plugin hooks、`pi` AgentHarness hooks
- hip：`packages/sidecar/src/session/hooks/README.md`、既有 integration tests
