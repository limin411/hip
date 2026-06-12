# Agent Loop 重建 — 用单一 ReAct 循环替换固定流水线

**Date**: 2026-06-13
**Status**: Approved
**Theme**: 对话业务核心编排修复。取代当前 deepagents「supervisor 强制三步 task」流水线。

---

## 动机 — 一次真实失败暴露的结构性缺陷

数据库里一次真实会话（用户："用一个 HTML 做个自我介绍，简短一点"）从头到尾失败，`~/.hip/scratch/<id>/` 至今只有 `.git/`，文件从未生成。复盘（来自 `hip.db` 的 `agent_runs` / `tool_calls`）：

1. **目标从未达成**：三个 task 轮次产出零文件。
2. **coder 只说不做**：coder 的 agent_run 只输出一句 "Let me explore the project directory…"，`tool_calls` 表中 **零行**——一个工具都没真正调。
3. **reviewer 审空文件**：无条件运行，去读不存在的 `/self-intro.html`，结论"文件不存在"。
4. **supervisor 嘴上重来不行动**：连续三轮最终文本都是"让我重新…"的承诺，却没有任何实际 task 调用，回合直接结束。

### 根因

当前架构用 `deepagents`（v1.10.2，LangGraph 原生）。**deepagents 的 primary agent 本身就是一个 ReAct Agent Loop**——自带 `write_todos`（规划）、文件工具、`task`（子代理）、Summarization 中间件（自动压缩）。但 `agents.ts` 的 `SUPERVISOR_BASE` 提示词用一句"你必须正好调用三次 `task`（planner→coder→reviewer）然后停"，**把一个本可自主循环的 agent 锁成了 3 步固定流水线**：

- 流水线无数据依赖门控 → reviewer 在 coder 没产出时照跑。
- 监督者的恢复意图只是回合末尾的自然语言文本，`runTurn` 直接 finalize → "我这就重来"变成死局。
- "正好三次然后停"的契约从结构上禁止了同一回合内的条件式/迭代式恢复。

### 参考产品对齐（OpenCode）

研究了业内优秀 harness（OpenCode v1.17.4，源码在本机 `…/20260427/opencode`）。结论：**OpenCode 与 Claude Code 整个就是围绕单一 Agent Loop 建的，不是固定流水线。**

- **循环本体**：`packages/opencode/src/session/prompt.ts` 的 `runLoop` 是手写 `while(true)`，每迭代 = 一次 `streamText`（Vercel AI SDK，`session/llm.ts`、`llm/ai-sdk.ts`），**模型自己决定调哪些工具**，结果回灌历史，继续循环。停止条件（`prompt.ts:~1164`）：模型给出非 `tool-calls` 的 finish 且无待执行工具 → 退出。**没有 plan→code→review 阶段。**
- **新版 `packages/core`**（Effect 重写，`session/runner/llm.ts`）把循环拆成「上下文装配 → 一次模型轮次 → 工具结算 → 是否继续」，`MAX_STEPS=25` 硬上限——结构更干净，仍是单循环。
- **循环控制 / 韧性层**（production-grade 关键）：
  - 步数上限 + 触顶注入 `max-steps.txt`（`prompt.ts:1231-1343`）。
  - **Doom-loop 检测**：最近 3 次同工具+同输入 → 暂停问用户（`processor.ts` `DOOM_LOOP_THRESHOLD=3`，`~522-546`）。
  - 重试退避（`retry.ts`，5xx/限流，指数退避 + 解析 `retry-after`）。
  - 自动压缩（`overflow.ts` / `compaction.ts`，超窗总结尾部、继续循环）。
  - 中断（`run-state.ts`，AbortController + 部分持久化 + 标记未完成工具）。
  - 权限门控 `ask/allow/deny`（每个危险工具 `ctx.ask()` 暂停问用户）= 天然的 HITL。
  - 规划 = `tool/todo.ts`（write_todos）+ 提示词，**不是单独 planner agent**。
  - 子代理 = `tool/task.ts`，主循环**模型自主决定**派生（各自跑完整 loop，返回文本），**不是强制序列**。

**核心判断**：业内优秀 harness 把"多智能体"做成 **一个主循环 + 可选 `task` 委派工具**（模型按需调用），而不是 planner→coder→reviewer 固定序列。我们当前设计缺的正是 Agent Loop 能力。

---

## Locked decisions

- **D1 — 用单一自适应 Agent Loop 替换固定流水线。** 不再有 plan→code→review 硬编码阶段。模型在每一步自主决定调哪些工具、何时收尾。
- **D2 — 用 LangGraph 自建 ReAct 循环（不切换技术栈）。** 自定义 `StateGraph` = `agent ⇄ tools` 环 + 控制节点。沿用 `@langchain/openai` 的 `ReasoningChatOpenAI`（DeepSeek reasoning 重投影）。复用 deepagents 的 `FilesystemBackend` 工具实现，但**循环由我们掌控**，以获得 OpenCode 级控制旋钮（deepagents 不暴露这些）。
- **D3 — 三路 classifier 路由取消。** 单循环天然自适应：闲聊就直接回（不调工具），任务就调工具。无需独立分类节点。（推翻早期"3 路路由"决定，理由见上。）
- **D4 — HITL = 工具权限 `ask` + doom-loop 询问。** 卡住/危险操作时 `interrupt()` 暂停问用户，而非单独的升级节点。（落实早期"暂停问用户"选择。）
- **D5 — review 不再是强制阶段。** 改为提示模型"写完读回自检"；深度审查可选地由模型自主派 `task` 子代理。
- **J1** 步数上限 `MAX_STEPS=25`，doom-loop `N=3`（OpenCode 取值）。
- **J2** v1 **不含 bash/shell**（hip 是摸鱼桌面助手，沙箱文件工具足够；bash 留作后续带权限可选项）。
- **J3** 子代理（`task` 委派）放 **Phase 3** 可选；核心是单循环。
- **J4** Checkpointer v1 用进程内 `MemorySaver`（thread=sessionId）；中断期间 sidecar 重启则该回合丢失（可接受，后续可换 SQLite checkpointer）。
- **J5** `AgentRole` 枚举不变；主循环以 `supervisor` 身份上报，避免协议+UI 大改。

---

## 架构

### 1. 循环拓扑

自定义 `StateGraph`：

```
       ┌─────────────────────────────────────────────┐
       ▼                                             │
   ┌────────┐  有 tool_calls   ┌────────┐  正常       │
──►│ agent  │────────────────► │ tools  │────────────┘ (回 agent)
   │ (模型) │                  │ (执行) │
   └───┬────┘                  └───┬────┘
       │ 无 tool_calls / 步数顶    │ doom-loop(连续N次同工具同参)
       ▼                          ▼
   ┌──────────┐              ┌──────────┐ interrupt()
   │ finalize │              │ ask_user │──────────► 暂停问用户
   └────┬─────┘              └────┬─────┘  resume
        ▼ END                     └──► 注入用户答复 → 回 agent
   （超窗时 agent → compact → 回 agent）
```

- **agent 节点**：`model.bindTools(tools)` 调一次模型，流式吐 token/reasoning（复用现有 pump + `ReasoningChatOpenAI`），产出可能带 `tool_calls` 的 AIMessage，`steps++`。触顶则注入「工具已禁用，仅文字作答」指令并强制收尾。
- **tools 节点**：执行每个 tool_call（沙箱在 cwd）；危险工具走权限策略；结果截断后作为 ToolMessage 回灌；记录成功写入路径。
- **条件边**：`agent` 有工具调用→`tools`，否则→`finalize`；超窗→`compact`。`tools` 命中 doom-loop→`ask_user`，否则→`agent`。
- **ask_user 节点**：`interrupt({question, context})` 暂停；resume 后注入用户答复 → 回 `agent`。
- **compact 节点**：总结旧消息、保留最近 K 轮、替换历史 → 回 `agent`。
- **finalize 节点**：跑 `verifyWrites` anti-phantom 兜底、持久化、`message:complete` → END。

### 2. State（LangGraph channels）

```ts
interface LoopState {
  messages: BaseMessage[]        // 标准 messages reducer（append）
  steps: number                  // 每次 agent 节点 +1
  recentToolSigs: string[]       // 最近 N 个 `${name}:${JSON.stringify(input)}`，doom-loop 依据
  filesWritten: string[]         // 本回合成功写入（finalize/验证用）
  status: 'running' | 'awaiting_user' | 'done' | 'error'
  pendingQuestion?: string       // HITL 待问
  tokens: { input: number; output: number }  // 成本累计
}
```

### 3. 循环控制层（OpenCode 级）

| 控制 | 设计 | 默认 |
|---|---|---|
| 步数上限 | 触顶注入「工具禁用，仅文字作答」指令，强制收尾 | `MAX_STEPS=25` |
| Doom-loop | 最近 N 次「同工具名+同输入」→ `ask_user` 暂停问用户 | `N=3` |
| 重试退避 | 模型调用包裹指数退避，仅 5xx/限流/过载重试，解析 `retry-after` | 2s×2^n |
| 自动压缩 | 输入逼近模型上限→总结尾部保留最近 K 轮→继续 | 留 buffer 20k |
| 中断 | 复用现有 AbortController + 部分持久化 + 标记未完成工具 | — |
| Idle 看门狗 | 复用现有 60s 无活动中止（`idle-watchdog.ts`） | — |

doom-loop + ask_user 同时满足 HITL 选择，并直接治掉「coder 空转 / reviewer 审空文件」。

### 4. 工具集

沙箱在 `cwd` 的文件工具（复用 deepagents `FilesystemBackend`，包成 LangChain `tool()`）：`read_file / write_file / edit_file / ls / glob / grep`，加 **`write_todos`**（规划，模型在上下文维护计划，UI 可渲染）。

- **不含 bash**（J2）。
- 每工具有权限策略 `allow | ask | deny`：读=allow；写/改=allow（已沙箱）或 ask（可配）。
- 工具结果截断（参照 OpenCode `tool_output.max_lines/max_bytes`），防上下文爆炸。

### 5. HITL（中断 / 恢复）

触发 `ask`（危险操作）或 doom-loop（卡住）时：LangGraph `interrupt()` 暂停 → Session 发 `agent:interrupt` 给前端 → 用户回一句 → `Command({ resume })` 续跑。

- Checkpointer：`MemorySaver`，`thread_id = sessionId`（J4）。
- Session 进入 `awaitingResume` 态（与既有 `running` 守卫并存）；该态下用户的下一条消息作为 resume，而非新回合。

### 6. 系统提示（OpenCode 式装配）

```
单一能干编码 agent 基底（先 write_todos 规划 → 用工具读写真实文件 → 写完读回自检 →
  绝不谎称未发生的写入 → 简短收尾）
+ 环境块（cwd / 是否 git / 平台 / 日期）
+ cwd 内的 AGENTS.md / CLAUDE.md（若存在）
+ 每会话 user systemPrompt（已支持）
+ anti-phantom 指令（保留）
+ DeepSeek 变体微调
```

`verifyWrites`（`verify.ts`）兜底网保留。

### 7. 流式 / 协议 / 持久化

- 复用现有协议事件（`token:stream` / `reasoning:delta` / `tool:started·finished` / `agent:started·finished` / `message:complete`）。主循环以 `supervisor` 身份上报；子代理（若用 `task`）走各自 agentId。
- **新增**：`agent:interrupt`（ServerMessage，问用户）/ `session:resume`（ClientMessage，答复）。可选 `todo:update`（UI）、step/cost 事件。
- DB schema 不动；现在每回合通常 1 个 `agent_run`（主循环），时间戳精确（自掌控循环，附带修掉之前 coder/reviewer 时间戳塌缩到同一秒的可观测性 bug）。

---

## 改动范围

### 新增

| 文件 | 职责 |
|------|------|
| `packages/sidecar/src/session/graph.ts` | 循环 `StateGraph`（state、节点、边、doom-loop、interrupt、compact） |
| `packages/sidecar/src/session/tools.ts` | LangChain 工具定义（基于 `FilesystemBackend`）+ `write_todos` |
| `packages/sidecar/src/session/loop-control.ts` | 步数上限、doom-loop 检测、重试退避、压缩 helper |
| `packages/sidecar/src/session/permission.ts` | 工具门控 + HITL ask |
| `packages/sidecar/src/session/system-prompt.ts` | 系统提示装配 |

### 修改

| 文件 | 改动 |
|------|------|
| `packages/sidecar/src/session/agents.ts` | → 单主 agent prompt + 可选子代理 spec；删除「正好三次 task」契约 |
| `packages/sidecar/src/session/session.ts` | `runTurn` 用 `graph.stream` 驱动循环；处理 interrupt → 发 `agent:interrupt`；处理 resume；把 per-agent 流式逻辑抽成可复用 pump（主循环 + 可选子代理共用） |
| `packages/protocol/src/index.ts` | 加 `agent:interrupt` / `session:resume`（及可选 `todo:update`） |
| `packages/sidecar/src/server/ws-server.ts` | 路由 `session:resume` |
| `packages/sidecar/package.json` | `@langchain/langgraph` 提为直接依赖 |
| 前端 `domain/*` `store/*` `components/chat/ChatPane.tsx` | 中断问答 UI；可选 todo 面板 |

### 不变

`main.ts` 启动逻辑、`session-manager.ts` 注册表、DB schema、`idle-watchdog.ts`、`verify.ts` 兜底逻辑。

---

## 分阶段交付

- **P1 核心循环**：LangGraph ReAct 环 + 文件工具 + 步数上限 + finalize/anti-phantom + 复用流式。**验收标准** = 当初失败的「HTML 自我介绍」真的写出文件。
- **P2 韧性**：doom-loop + HITL 中断/恢复（协议+UI）+ 重试退避 + 自动压缩。
- **P3 可选**：`write_todos` UI + `task` 子代理（explore）+ token/成本展示。

---

## 测试策略

贴合记忆偏好（GUI 验收真实 LLM 路径；非 LLM 流程欢迎彻底 E2E）：

- **注入假模型的确定性单测**（无 LLM、不烧钱）：有工具调用就续 / 纯文本就停 / 步数顶注入指令并终止 / doom-loop 触发中断 / resume 注入答复并续跑 / 写入后置条件 / 重试退避。
- **工具单测**：沙箱 read/write/edit/glob/grep。
- **真实 DeepSeek**：GUI 手动验收（先跑通失败用例「HTML 自我介绍」）。
- **可选 wdio E2E**：中断 UI（stub LLM，非付费）。

---

## 风险

- **R1** `@langchain/langgraph` JS 的 `interrupt` / `Command` / `MemorySaver` + 与 `ReasoningChatOpenAI` 流式共存 —— 实现前先做最小 spike 验证。
- **R2** DeepSeek `deepseek-v4-pro` 的 `tool_choice` / 工具调用可靠性需实测；守卫 reasoner 变体不支持 `tool_choice`（会 400）的情况，必要时降到 tool-capable 型号。
- **R3** `awaitingResume` 与既有 fire-and-forget WS 派发、`cancel()`、idle 看门狗的交互需小心设计（参照 `2026-06-09-conversation-resilience-design.md` 的 D4 race-free 思路）。

---

## 参考

- OpenCode v1.17.4 源码（本机 `…/20260427/opencode`）：`session/prompt.ts`（runLoop）、`session/llm.ts` + `llm/ai-sdk.ts`（streamText）、`session/processor.ts`（doom-loop）、`session/retry.ts`、`session/compaction.ts` + `overflow.ts`、`session/run-state.ts`、`tool/task.ts`、`tool/todo.ts`、`agent/agent.ts`、`core/src/session/runner/llm.ts`（MAX_STEPS=25）。
- Anthropic, *Building Effective Agents* — workflow（固定顺序用代码）vs agent（模型自主）；prompt-chaining 的程序化中间门控；evaluator-optimizer。
- Reflexion / Self-Refine — 重试上限 ≈3、verifier-in-the-loop。
- 既有相关 spec：`2026-06-07-backend-mvp-deepagents-design.md`、`2026-06-09-conversation-resilience-design.md`、`2026-06-10-per-session-config-design.md`。
