# Agent Loop P2 — 韧性层 + 人在环（HITL）

**Date**: 2026-06-13
**Status**: Approved
**Theme**: 给 P1 的单一 ReAct 循环补上 production-grade 控制旋钮 —— doom-loop 检测、人在环中断/恢复、重试退避、自动压缩。
**前置**: P1（`2026-06-13-agent-loop-design.md` 的 Phase 1）已合并到 main：`graph.ts` 的 `agent ⇄ tools` 环 + 步数上限 + finalize/anti-phantom + 复用流式。本 spec 是该总设计 §3「循环控制层」/ §5「HITL」的落地，作为单一阶段（四子系统合并）交付。

---

## 动机 — P1 之后仍裸露的四个失败面

P1 的单循环已能自适应「闲聊直答 / 任务调工具」，但循环本身还很脆：

1. **卡死打转**：模型可能反复用同一参数调同一工具（搜同一串、重读同一文件、重试同一命令），白烧 token、回合空转——P1 只有步数硬上限兜底，没有早期识别与纠偏。
2. **无人可问**：模型走进死胡同时只能继续撞到步数顶，用户无法在回合中途介入纠偏。
3. **瞬时故障即失败**：DeepSeek 偶发 429/5xx/过载，P1 的一次 stream 失败就让整个回合报错。
4. **长会话爆窗**：会话变长后输入逼近模型上下文上限，P1 无压缩，必然在某一刻 400/截断。

P2 用四个相互独立又共享同一循环的子系统消除这些失败面。

---

## 参考产品对齐（本轮网络调研）

调研 Claude Code / OpenAI Codex / Kilocode 等业内做法，结论与本设计高度一致，并据此细化了四处：

- **压缩（Claude Code）**：约 95% 容量触发；**暂停当前回合 → 总结全历史 → 摘要替换早期轮次 → 带着同一任务/文件状态继续**。保留：任务目标、关键决策、约束、最近工具结果；丢弃：中间推理、被否方案、早期冗长输出。→ 印证「钉住目标 + 压缩中段 + 保留最近 K」，并据此写摘要 prompt 的「保留/丢弃」清单。
- **压缩（Codex）**：**pre-turn 触发**（发下一条消息前先查 token 是否超阈值，超了先压缩再发），压缩**织入循环本体**而非事后处理。已知 bug：headless 下阈值不触发 → 直接撞硬上限崩溃（[openai/codex#16033](https://github.com/openai/codex/issues/16033)）；以及压缩自身打转（[#8481](https://github.com/openai/codex/issues/8481)）。→ 我们的 `compact` 节点同时挂在 START（pre-turn）和 `tools` 回流（mid-loop）；预算取保守值；加「每次访问至多压一次」护栏防压缩 loop。
- **Doom-loop（Kilocode / hermes-agent）**：工具调用按 `(name, hash(args))` 指纹化，滑窗追踪；阈值 = 同指纹连续 **3** 次。**两段式升级**：第 3 次 → 注入告警并**跳过该次工具执行**；若告警后仍复现 → 升级为 approval 暂停（[NousResearch/hermes-agent#512](https://github.com/NousResearch/hermes-agent/issues/512)）。另一派（[dev.to](https://dev.to/alanwest/how-to-fix-tool-use-loops-in-autonomous-coding-agents-540e)）只注入反思、不暂停。→ 我们采用两段式「先纠偏一次，再问用户」。**与 Kilocode 不同，我们在 `tools` 执行之后判定、不跳过那次调用**：Kilocode 跳过执行是因其工具有外部代价，而我们的工具是廉价的本地沙箱 op（read/write/ls/glob/grep），跳过反而会让带 `tool_calls` 的 assistant 消息**没有配对的 `ToolMessage`** → 下一次 DeepSeek 请求 400（"tool_calls must be followed by tool messages"）。故第 N 次重复照常执行（无害、幂等），随后再 nudge。
- **HITL（Claude Code）**：无 checkpointer；`canUseTool` 回调**暂停执行直到返回**，「inline 回答 → 会话恢复」；auto-mode 新理念是「分类器拦截时**优先自恢复、能绕则绕，不轻易停下等人**」（[anthropic.com/engineering/claude-code-auto-mode](https://www.anthropic.com/engineering/claude-code-auto-mode)）。原生中途暂停改 prompt 仍是 open feature request（[claude-code#29291](https://github.com/anthropics/claude-code/issues/29291)）。→ 正好对应我们的「nudge 先自恢复 → 仍卡才问人」+ **Option Z**（不引 checkpointer，恢复=把答复并回历史再跑）。
- **重试**：业界共识 = 指数退避 + jitter + 每次封顶 ~30s + `max(retry_after, backoff)` 尊重 `retry-after`；429 比 5xx 多重试；**绝不重试 401/403/400/上下文溢出**（[callsphere](https://callsphere.ai/blog/retry-strategies-llm-api-calls-exponential-backoff-jitter-tenacity)、[helicone#5672](https://github.com/Helicone/helicone/issues/5672)）。→ 直接采纳。

---

## Locked decisions

- **P2-D1 — 暂停/恢复用「协作式 message-replay」(Option Z)，不引 LangGraph checkpointer / `interrupt()`。** P1 每回合本就「全量重灌消息 + 重新 invoke」。要暂停时，`pause` 节点只置 `status='awaiting_user'` 并走 END；`runTurn` 的 `invoke()` 正常 resolve，读回 `finalState.messages`+`steps` 暂存到 Session，发 `agent:interrupt`，返回。恢复时把用户答复作为 `HumanMessage` 追加，带着暂存 messages + 续接的 `steps` **从 START 重新 invoke**。
  - **理由**：P2 唯一的 HITL 触发点是「步与步之间」的 doom-loop（工具已沙箱 `allow`、无 bash —— 见总设计 J2），不需要 node 内中途暂停。Option Z 因此**消解总设计 R1 风险**（`interrupt()`/`Command`/`MemorySaver` + 自管流式的未验证组合），无 checkpointer 生命周期/泄漏，且「答复后从 agent 重新规划」对本场景**更正确**；与 Claude Code「inline 回答→恢复」模型一致。原总设计 D4/J4/R1 的 checkpointer 路线**作废**，仅在未来需要 node 内权限门控时再评估。
- **P2-D2 — Doom-loop「先 nudge 一次，再问用户」，在 `tools` 执行之后判定（不跳过）。** 工具正常执行并写回 `ToolMessage`（保持 OpenAI 消息格式合法），随后看 `recentSigs` 尾部：同指纹连续达 **N=3** → 若该指纹尚未 nudge 过：注入一条纠偏 `SystemMessage` → 回 agent；若已 nudge 过仍复现：`pause` → 问用户。不同指纹打断连击并允许新一轮 nudge。重复的本地工具 op 无害且幂等，其代价远低于跳过执行导致的悬空 `tool_calls`（见上「参考产品对齐」）。
- **P2-D3 — 自动压缩「压中段、钉目标」。** 逼近预算时：逐字保留 `system` + **首条用户消息（原始目标）** + 最近 **K** 轮；中段经**一次廉价模型调用**总结成一条摘要消息替换。`compact` 同时挂 START 与 `tools` 回流，每次访问至多压一次。
- **P2-D4 — 中断 UI = inline 气泡 + 复用输入框。** `agent:interrupt` 渲染为一条特殊 assistant 气泡；用户在普通输入框回话，前端在 `interruptPending` 态下把这条作为 `message:resume` 发出（而非 `message:send`）。无新控件。
- **P2-J1** 指纹 = 该 agent 消息**整批** tool_calls 的 `name:JSON(args)` 拼接（join，排序后）；v1 不做 per-call 拆分（够抓常见单调用复读，后续可细化）。
- **P2-J2** Nudge 注入为 `SystemMessage`；若实测 DeepSeek 拒绝 list 中段的 system 角色，则降级为 user 角色加 `[系统]` 前缀（dev.to 的 user-message 模式）。spike 时确认。
- **P2-J3** 压缩 token 估算用启发式 `ceil(字符数 / 3)`（CJK/代码偏密，保守略高以提前触发）；预算 `COMPACT_BUDGET_TOKENS` 取保守默认（sidecar 拿不到 active model 的窗口元数据 —— 见 `config/providers.ts`，无 context-window 字段），默认按 64k 窗口留 ~16k headroom → 约 **48k** 触发，可经常量/env 覆盖。
- **P2-J4** 摘要模型：`cheapModelFor('deepseek') → 'deepseek-chat'`，未知 provider 回退到 active model；经 `Summarizer` 接口注入，单测用假实现。
- **P2-J5** 重试：可重试 = `429/500/502/503/504/529` + 网络 `ECONNRESET/ETIMEDOUT/EAI_AGAIN`；不可重试 = `400/401/403/404/422` + 上下文溢出（交给压缩）。`maxRetries` 默认 4；退避 `base=1s × 2^n + jitter`，每次 `wait = min(30s, max(retryAfter, backoff))`；**仅在本步尚未吐出任何 delta 时重试**（避免重复 token）；`AbortSignal` 立即短路。

---

## 架构

### 1. 循环拓扑（在 P1 上增节点）

```
START → compact → agent ─┬─ 有 tool_calls & 未到顶 ─► tools ─► (routeAfterTools)
                  ▲ ▲     └─ 无 tool_calls / 步数顶 ─────────► END（runTurn finalize）
                  │ │
                  │ │  routeAfterTools（执行后判 doom-loop）：
                  │ ├──── 正常 ───────────────────► compact ─► agent
                  │ ├──── doom-loop & 该指纹未 nudge ─► nudge ─► agent
                  │ └──── doom-loop & 该指纹已 nudge ─► pause(awaiting_user) ─► END（runTurn 发 interrupt 并暂停）
                  └── nudge / compact 回到 agent
```

- **compact**（入口 + 正常回流）：估 token；超 `COMPACT_BUDGET_TOKENS` 则压中段（见 §4），否则空操作。每次访问至多压一次。恒接 `agent`。
- **agent**：跑一次模型（重试在 runner 内，见 §3），流式吐 token/reasoning，追加 `AIMessage`，`steps++`。触顶（`steps >= maxSteps-1`）不绑工具、强制收尾（P1 既有逻辑不变）。
- **tools**：执行上一条 `AIMessage` 的 tool_calls，emit，追加 `ToolMessage`，把本批指纹推入 `recentSigs`（滑窗）。**doom-loop 的第 N 次重复也照常执行**（保持 `tool_calls`↔`ToolMessage` 配对合法，见 P2-D2）。
- **nudge**：在 `ToolMessage` 之后追加一条纠偏 `SystemMessage`（「你已用完全相同参数调用 `X` 3 次且没有进展——换个方法或停止」），记下 `nudgedSig`。恒接 `agent`。
- **pause**：置 `status='awaiting_user'` + `pendingQuestion`（「我似乎卡在 X 上——希望我怎么做？」）。接 END。

**路由（`tools` 出边，执行后判 doom-loop）**：取刚推入 `recentSigs` 尾部的本批指纹 `lastSig`，数尾部与之相同的连击数 `r`：
- `r >= N` → 该指纹未 nudge 过则 `nudge`，已 nudge 过则 `pause`；
- 否则 → `compact`（正常回流）。

**路由（`agent` 出边）**：最后 `AIMessage` 有 tool_calls 且 `steps < maxSteps` → `tools`；否则 → END。

### 2. State（在 P1 的 `messages`/`steps` 上加四通道）

```ts
recentSigs: string[]                       // 已执行批次的指纹，按序，滑窗保留最近 W（默认 6）
nudgedSig?: string                         // 当前已 nudge 过的指纹（每个不同指纹各享一次 nudge）
status: 'running' | 'awaiting_user'        // pause 节点置位
pendingQuestion?: string                   // 待问用户的话
```

`recentSigs` 用 `slice(-W)`；`nudgedSig` 在出现不同指纹的 tools 执行后随连击打断而自然失配（新指纹 != `nudgedSig` → 可再 nudge）。

### 3. 重试退避（新 `retry.ts`，包住 runner 内取流）

`withRetry(fn, opts)` + `isRetryable(err)` + `parseRetryAfter(err)`。`RealModelRunner.run` 把「建立 stream + 取首块」包进 `withRetry`：

- 仅当错误在**首个 delta 吐出之前**抛出才重试（幂等，避免重复 token）；首块之后的 mid-stream 错误照 P1 抛出（abort/error 路径）。
- 分类见 P2-J5；`parseRetryAfter` 读 `err.headers['retry-after']`（秒或 HTTP date）—— OpenAI SDK 的 `APIError` 带 `.status`/`.headers`，但 langchain 包装后字段位置需 spike 确认（见 R1）。
- 纯函数，单测用「抛 N 次后成功 / 始终抛 / 抛后被 abort」的假 fn。

### 4. 自动压缩（新 `compaction.ts` + `Summarizer` 接口）

- **触发**：`estimateTokens([system, ...messages]) > COMPACT_BUDGET_TOKENS`（估算见 P2-J3）。
- **保形**：`[system, firstUser, …middle…, 最近 K 轮]` → 仅总结 `middle`（首条用户消息之后、最近 K 轮之前的跨度）为一条 `SystemMessage`「[对话摘要] …」；`system`/`firstUser`/最近 K 逐字保留。一「轮」= 一条用户消息及其后续全部 AI/工具消息直到下一条用户消息；`KEEP_RECENT_TURNS` 默认 3。
- **落到 LangGraph**：`messagesStateReducer` 仅追加，故压缩节点返回 `{ messages: [...middle 的 RemoveMessage, 摘要消息] }`（`RemoveMessage` 来自 `@langchain/core/messages`，按 id 删除）。
- **摘要 prompt**（取自 Claude Code 的保留/丢弃清单）：保留任务目标、关键决策、约束、已写文件与近期工具结果；丢弃中间推理、被否方案、早期冗长输出。
- **护栏**：中段不足（消息太少）则不压；每次节点访问至多压一次，压后即便仍超预算也放行 agent（宁可降级也不进压缩 loop —— 防 Codex #8481）。
- `Summarizer.summarize(messages): Promise<string>` 注入（真实 = 一次廉价模型调用，假 = 返回固定摘要），使压缩可无 LLM 单测。

### 5. HITL 暂停/恢复（Option Z）

**模型：两回合，不是续接同一 turnId。** 续接同一回合得跨暂停暂存并重建整个 trajectory/emit 机器（脆）。改为：暂停把当前回合 A **收尾为一条 `stopped` 助手消息**（复用 P1 的 `finalizeAndPersist(..., stopped=true)`，连同其工具轨迹落库/渲染），随后恢复**起一个新回合 B**——但 B 用**暂存的富图消息**（含工具结果）重灌，故上下文不丢。转录呈现：`[A：卡住的工具轨迹（stopped）] → [⏸ 中断气泡：问题] → [用户答复] → [B：续做]`，语义清晰。

- **暂停**：图走到 `pause` → END，`finalState.status==='awaiting_user'`。`runTurn`：
  - 暂存 `this.paused = { messages: finalState.messages.slice(1), steps: finalState.steps }`（去掉首条 system；恢复时换新 system），置 `this.awaitingResume = true`；
  - `finalizeAndPersist(send, turnIdA, supervisorText, trajectory, /*stopped*/ true)` 收尾 A；
  - 发 `agent:interrupt { sessionId, turnId: turnIdA, agentId:'supervisor', question, context? }`；
  - 从 `runTurn` 返回（`finally` 自然停 idle 看门狗、置 `running=false`）。
- **恢复**：`message:resume { sessionId, content }` → `session-manager` 路由到 `Session.resume(content, send)`：
  - 守卫 `awaitingResume`；持久化并 `this.messages.push(new HumanMessage(content))`（答复进正式历史）；
  - 以 `base = { messages: [...this.paused.messages, new HumanMessage(content)], steps: this.paused.steps }` 调 `runTurn(send, base)`：`runTurn` 用 **新 turnIdB**、新 trajectory，invoke 初值 `{ messages: [新 system, ...base.messages], steps: base.steps, recentSigs: [], nudgedSig: undefined, status: 'running' }`，续跑到完成或再次 pause；
  - 清 `awaitingResume`/`paused`。`runTurn` 重构为接受可选 `base`（默认 `{ messages: this.messages, steps: 0 }`），首回合与恢复共用同一驱动。
- **并发/取消**：
  - `awaitingResume` 与 P1 的 `running` 并存为再入守卫；`awaitingResume` 期间 `sendMessage`/`regenerate` 为 no-op。
  - `cancel()` 于 `awaitingResume` 态：清 `paused`/`awaitingResume`（A 已落库为 stopped，无活跃 AbortController，无需再 finalize）。
  - idle 看门狗：暂停=从 `runTurn` 返回，看门狗已停，**等人期间不会 60s 误中止**（无需特判）。

### 6. 协议改动（+2，沿用既有 `message:*` / `agent:*` 命名）

```ts
// ServerMessage
| { type: 'agent:interrupt'; sessionId: string; turnId: string; agentId: string; question: string; context?: string }
// ClientMessage
| { type: 'message:resume'; sessionId: string; content: string }
```

DB schema 不动。暂停回合 A 落库为一条 `stopped` 助手消息（`message:complete` 带 `stopped`），随后 `agent:interrupt` 携问题；恢复回合 B 是一条新的助手消息，最终各自一条 `message:complete`。

### 7. 前端（最小改动）

- domain store：收到 `agent:interrupt` 置 `interruptPending`（带 question/context），渲染一条特殊 assistant 气泡（`⏸` + 问题文案）。
- 输入框逻辑不变；发送处在 `interruptPending` 时发 `message:resume` 并清标志，否则照常 `message:send`。
- 无模态、无新控件、无按钮组。

---

## 改动范围

### 新增

| 文件 | 职责 |
|------|------|
| `packages/sidecar/src/session/retry.ts` | `withRetry` / `isRetryable` / `parseRetryAfter`（§3） |
| `packages/sidecar/src/session/compaction.ts` | `estimateTokens` / `compactMessages` / `Summarizer` 接口 + 真实/廉价实现（§4） |
| `packages/sidecar/src/session/doom-loop.ts` | 指纹化 `sigOf(toolCalls)` + 尾部连击计数 + 阈值常量（§1/§2） |

### 修改

| 文件 | 改动 |
|------|------|
| `packages/sidecar/src/session/graph.ts` | 加 `compact`/`nudge`/`pause` 节点、出边 doom-loop 判定、四个 state 通道；START→compact、tools→compact 回流 |
| `packages/sidecar/src/session/model-runner.ts` | `RealModelRunner.run` 取流包进 `withRetry`；首-delta 前才重试 |
| `packages/sidecar/src/session/loop-control.ts` | `recursionLimit()` 提升到 `MAX_STEPS*3+10`（每循环现 3 visits：compact+agent+tools）。**常量随模块就近**：`DOOM_LOOP_N`/`SIG_WINDOW`/nudge·pause 文案在 `doom-loop.ts`；`COMPACT_BUDGET_TOKENS`/`KEEP_RECENT_TURNS` 在 `compaction.ts`；`MAX_RETRIES` 在 `retry.ts`。 |
| `packages/sidecar/src/session/session.ts` | `runTurn` 重构接受可选 `base`（首回合默认 `this.messages`/steps 0，恢复传暂存富图消息+steps，二者共用驱动）；读 `finalState` 判 `awaiting_user`：finalize A 为 `stopped` + 发 `agent:interrupt` + 暂存 `paused`/`awaitingResume`；`resume()`；`cancel()` 清暂停态；`Summarizer` 注入（注入态/无 env-model 时用 noop） |
| `packages/protocol/src/index.ts` | +`agent:interrupt`（Server）/`message:resume`（Client） |
| `packages/sidecar/src/session/session-manager.ts` | 路由 `message:resume` → `Session.resume` |
| `packages/sidecar/src/config/providers.ts` | 加 `cheapModelFor(providerID, activeModelID)` 小映射（deepseek→deepseek-chat，余回退） |
| 前端 `src/domain/*` + `src/components/chat/ChatPane.tsx` | `interruptPending` 态、中断气泡、发送分支 `message:resume` |

### 不变

P1 的 `tools.ts`/`system-prompt.ts`/`verify.ts` 兜底、`idle-watchdog.ts`、`workspace-*`、`main.ts`、DB schema、`session-manager` 其余路由。

---

## 测试策略

全部确定性、注入假 runner/Summarizer，**不烧 LLM**：

- **doom-loop**：假 runner 连发同一工具同参 → 第 3 次跳过执行 + 注入 nudge（断言 tools 未执行该次、消息含纠偏）；nudge 后仍复现 → `pause`、`status==='awaiting_user'`；不同指纹打断连击、可再 nudge。
- **HITL**：pause 后 `runTurn` 返回且发 `agent:interrupt`、未写完成消息；`resume(answer)` 追加并续跑到完成、发 `message:complete`；`cancel()` 于暂停态 finalize `stopped`。
- **重试**：抛 N 次后成功（断言重试 N 次）；始终抛达上限后冒泡；abort 立即短路；`parseRetryAfter` 解析秒/日期；不可重试类（400/上下文溢出）不重试。
- **压缩**：超预算触发、钉住 system+firstUser+最近 K、中段被 `RemoveMessage`+摘要替换、调用假 `Summarizer`；中段不足不压；压后仍超预算只压一次即放行。
- **工具/既有**：P1 单测与既有 Session 单测保持绿（FakeListChatModel / 注入 runner 路径不破）。

**真实 DeepSeek（付费、手动 GUI）**：仅端到端验证「doom-loop → 中断气泡 → inline 回答 → 恢复续跑」一条；与 P1 仍 PENDING 的 live 验收**捆绑一次做**（先确认 P1 能真写文件，再验 P2 中断回合）。

---

## 风险

- **R1（spike，付费）**：langchain 包装后的 OpenAI `APIError` 上 `.status`/`.headers['retry-after']` 的实际可达性；DeepSeek 是否接受 messages 列表**中段**的 `SystemMessage`（nudge）—— 不行则按 P2-J2 降级 user 角色。这两点在与 P1 spike 同一次 `scratch/spike-loop.mts` 里一并验。
- **R2**：`estimateTokens` 启发式偏差导致压缩过早/过晚。偏早只是多花一次廉价摘要；偏晚才危险 → 预算取保守值 + 真实 GUI 跑一长会话观察。
- **R3**：`awaitingResume` 与 fire-and-forget WS 派发、`cancel()`、idle 看门狗的竞态（参照 `2026-06-09-conversation-resilience-design.md` D4）。Option Z 因「恢复=普通重 invoke」已大幅简化，但 `resume` 与并发 `send`/`cancel` 的守卫顺序需单测覆盖。
- **R4**：压缩 loop（Codex #8481）/ 阈值不触发（#16033）。靠「每访问至多压一次 + 压后放行」与保守预算两道护栏；单测覆盖「压后仍超预算不再压」。

---

## 参考

- 调研：Claude Code 压缩（[code.claude.com](https://code.claude.com/docs/en/how-claude-code-works)、[claudelog](https://claudelog.com/faqs/what-is-claude-code-auto-compact/)）；Codex 压缩与已知 bug（[openai.com](https://openai.com/index/unrolling-the-codex-agent-loop/)、[#16033](https://github.com/openai/codex/issues/16033)、[#8481](https://github.com/openai/codex/issues/8481)）；doom-loop 两段式（[hermes-agent#512](https://github.com/NousResearch/hermes-agent/issues/512)、[claude-code#4277](https://github.com/anthropics/claude-code/issues/4277)、[dev.to](https://dev.to/alanwest/how-to-fix-tool-use-loops-in-autonomous-coding-agents-540e)）；HITL/auto-mode（[anthropic auto-mode](https://www.anthropic.com/engineering/claude-code-auto-mode)、[agent-sdk user-input](https://platform.claude.com/docs/en/agent-sdk/user-input)、[claude-code#29291](https://github.com/anthropics/claude-code/issues/29291)）；重试（[callsphere](https://callsphere.ai/blog/retry-strategies-llm-api-calls-exponential-backoff-jitter-tenacity)、[helicone#5672](https://github.com/Helicone/helicone/issues/5672)、[fast.io](https://fast.io/resources/ai-agent-retry-patterns/)）。
- 既有：`2026-06-13-agent-loop-design.md`（P1/总设计，本 spec 的 §3/§5 落地）、`2026-06-09-conversation-resilience-design.md`（取消/看门狗/竞态）、OpenCode v1.17.4 源码（`session/processor.ts` doom-loop、`session/retry.ts`、`session/compaction.ts`+`overflow.ts`、`session/run-state.ts`）。
</content>
</invoke>
