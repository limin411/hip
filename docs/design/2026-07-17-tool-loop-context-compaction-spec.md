# Tool-Loop Context Compaction — Spec

| Field | Value |
|-------|-------|
| **Title** | Mid-loop context compaction for ReAct / explore subagents (not HumanMessage-bound) |
| **Date** | 2026-07-17 |
| **Status** | Implemented M1/M2 (2026-07-17) |
| **Trigger** | Debug `uigsEO_MrE0xMEl5zAGhJ` — `task_batch` + dual explore ran 50–90 tools; context ballooned; final failure `404 model k3 / Permission denied`. Analysis: hip compact path no-ops on single-Human tool loops. |
| **Related** | Parallel fan-out fix (`task_batch` expose); idle-timeout hardening; `micro-compaction.ts` |
| **Plan** | [`2026-07-17-tool-loop-context-compaction-plan.md`](./2026-07-17-tool-loop-context-compaction-plan.md) |

---

## §0 一页纸

**问题：** hip 的会话压缩以 **`HumanMessage` turn** 为切分边界。Explore / `task` / `dispatch_agent` 典型形状是 **1 条任务 + 大量 AI↔Tool 循环**，于是：

- `compactMessages`：`humanIdxs.length <= 3` → **永远 `null`**
- 滑动窗口：整段是 **1 个超长 turn** → 几乎不删内容
- micro-compaction（清旧 Tool 正文）：**默认关**（`HIP_EXPERIMENTAL_MICRO_COMPACTION`）

结果：并行调度修好后，长探索仍 **上下文不压、token 累计爆炸、后期模型调用易失败**。

**目标：** 对齐 OpenCode / Codex / Hermes / Kimi-Code / pi 的共识——**三层防御**，且 **不依赖额外用户发言**：

1. **P0 廉价层：** 默认开启「旧 tool 结果 stub / prune」（升级现有 micro-compaction）  
2. **P0 切分层：** 压缩切点支持 **assistant/tool 组**（tool-round），不限于 Human  
3. **P1 摘要层：** token 阈值触发 LLM 滚动摘要 + 保留 recent tail  
4. **P1 环内触发：** 每步 model 调用前检查；可 mid-turn compact 后继续同一子代理任务  

**非目标（本 spec）：** 改 provider 协议、实现 OpenAI remote `/compact`、改 UI 全量 transcript 删除（model-visible ≠ durable UI 历史可分）。

---

## §1 问题复现与证据

### 1.1 会话形状（失败路径）

```
[System] explore persona + tools
[Human]  分析 backend/frontend …     ← 唯一 Human
[AI] tool_calls → [Tool] → [AI] → [Tool] × N   (N=30–60+)
```

### 1.2 当前代码为何 no-op

| 机制 | 文件 | 为何对 explore 无效 |
|------|------|---------------------|
| Token 摘要 | `compaction.ts` `compactMessages` | 仅在 Human turn 边界切；`humanIdxs.length ≤ KEEP_RECENT_TURNS(3)` → return null |
| 滑动窗口 | `context/sliding-window.ts` | turn = Human 到下一 Human；单任务 = 1 turn → over `maxMessages` 仍常 keep 全量 |
| Micro stub | `micro-compaction.ts` | 可 stub 旧 `ToolMessage`，但 **env 默认关** |
| Overflow retry | `graph.ts` agent catch | 只认 context-length 类错误；`MODEL_NOT_FOUND` 不触发；且 compact 同样 null |
| 单条 tool bound | `tool-output-store.ts` | 只压单次 tool 预览，不压历史堆积 |

### 1.3 对标结论（`/Users/lijiamin/data/code-repository/github`）

| 项目 | 触发单位 | 单 Human + 长 tool 环 | 关键手法 |
|------|----------|----------------------|----------|
| **OpenCode** | token + overflow | 能 | 三层：tool bound → prune 旧 tool → LLM compact；auto-continue |
| **Codex** | token 阈值 pre/mid-turn | **能** | **mid-turn compact** 后继续同一 turn；tool 写入时截断 |
| **Hermes** | 每 API 前 token % | **能** | 先 prune tool 正文，再 head/tail + 中间摘要 |
| **Kimi-Code** | 每 step 前 used≥85% | **能** | Full compact：几乎只留 user + summary |
| **pi** | tokens / overflow | 能 | **允许 mid-turn 在 assistant 边界切开** |
| **OpenHands** | event count | 能 | 按 action/observation 数 condense |
| **hip 现状** | Human turn | **不能** | 切点错误 + micro 默认关 |

**可抄共识：**

1. Durable 历史 ≠ model-visible 投影  
2. 廉价 prune 先于 LLM summary  
3. **环内 / mid-turn** 压缩，不能等用户再说一句  
4. Recent tail 按 **token** 保留，不能只数 Human 条数  
5. Overflow 单次 compact+retry，禁止无限循环  

**慎抄：**

- 仅用 `chars/4` 当唯一权威（可作启发式；有 usage 时优先 last step input）  
- Full drop 全部 assistant/tool（Kimi 过猛，探索质量可能伤；hip 先 prune + 摘要）  
- 复杂 reorder filterCompacted（OpenCode V1 坑多；优先 seq cutoff + 摘要消息）  

---

## §2 范围与原则

| ID | 原则 |
|----|------|
| P1 | **Model-visible 可压缩；UI/debug 可保留更全**（至少保留 agentRun 工具轨迹与导出） |
| P2 | 压缩 **不得破坏 tool_call_id 配对**（切点落在完整 AI+Tools 组边界） |
| P3 | **廉价优先**：stub/prune → 仍超预算再 LLM summarize |
| P4 | 子代理与 supervisor **共用** 同一 compact 栈；subagent 默认更积极 |
| P5 | 一次 compact 必须 **可测的 token/条数下降**；`after ≈ before` 则升级策略或 fail soft |
| P6 | 不依赖用户再发消息；auto-continue 用 **内部 synthetic 指令**（可标记不进 UI） |
| P7 | 配置可关；默认 **开启** prune（与 OpenCode V1 prune 默认关不同——我们要修的就是默认失效） |

---

## §3 需求

### 3.1 Tool-round 切点（P0）

**定义 Tool-round：** 一条含 `tool_calls` 的 `AIMessage` + 其对应全部 `ToolMessage`（同一批 call ids）。

**`compactMessages` 扩展：**

| 模式 | 切点 | 适用 |
|------|------|------|
| `user-turn`（现状） | HumanMessage | 多轮对话 |
| `tool-round`（新增） | 完整 AI+Tool 组 | 单任务 ReAct / explore |

算法（tool-round）：

1. 保护：`SystemMessage`（会话 system）+ **首条 Human（goal）**  
2. 将后续消息解析为有序 **tool-rounds[]**（无 tool 的纯 AI 文本段可并入 round 或单独保护最近 N 条）  
3. 保留尾部最近 **`keepRecentToolRounds`**（默认 **6**）或尾部 **`keepRecentTokens`**（默认 **12_000** 估计 token）中 **较严者**  
4. 中间 rounds → summarizer（或仅 stub tool 正文，见 3.2）  
5. 摘要以 `SystemMessage`（或 Human 角色带固定 prefix，二选一，见 §5）写入，**不得**拆开未完成的 tool 配对  

当 `humanIdxs.length <= KEEP_RECENT_TURNS` 时 **不得再 return null**：应 fallback 到 `tool-round` 模式。

### 3.2 默认开启 Tool Result Prune（P0）

升级 `MicroCompaction` 为 **默认生产路径**（不再依赖 experimental env，或 env 仅作强制关闭）：

| 项 | 值 |
|----|-----|
| 默认 | **on**（supervisor + subagent） |
| 保护窗口 | 最近 **`PRUNE_PROTECT_ROUNDS = 8`** 个 tool-round 的 Tool 全文保留 |
| 更早 ToolMessage | 替换为 stub：`[Old tool result cleared | name=… | callId=… | chars=N]` |
| 保护工具名（可选） | 暂无强制；`write_todos` 结果可保留更久 |
| 触发 | 每进入 `compactNode`；且 `estimateTokens > PRUNE_TRIGGER_TOKENS`（默认 **24_000**）或 tool-round 数 > **12** |
| 最小回收 | 估计回收 < **4_000** tokens 则跳过（避免无意义重写） |

OpenCode 类比：`PRUNE_PROTECT≈40k` / `PRUNE_MINIMUM≈20k`——hip 首版用 **round 数 + 粗 token** 即可，后续可调。

**配置：**

```toml
[agentLoop.compaction]
prune = true                 # default true
pruneProtectRounds = 8
pruneTriggerTokens = 24000
microExperimentalEnvOverride = false  # true 时仍认 HIP_EXPERIMENTAL_MICRO_COMPACTION
```

### 3.3 Token 阈值 LLM 摘要（P1）

| 项 | 说明 |
|----|------|
| 预算 | 默认 **`compactBudget = 48_000`** 保留；**优先**用上一轮 `usage.input_tokens`（若有）与 `estimateTokens` 取 max |
| 触发 | `used >= compactBudget` **或** tool-rounds > **20** |
| 摘要模板 | 结构化：Goal / Findings / Key paths / Open questions / Next（中英文均可；与现有 SUMMARY_TEMPLATE 对齐并加 **paths/versions** 字段） |
| 保留 tail | 最近 tool-rounds 按 token 预算 **12k** 原文 |
| `compacted` 标志 | **不得** 永久禁用后续 compact：改为 `lastCompactedAtStep` 或每 N 步允许再压；至少 prune 每步可跑 |
| Subagent | `buildGraph(childMaxSteps)` 使用 **更紧预算** 可选：`subagentCompactBudget = 32_000`（explore 默认） |

**现有 bug 修复：** `if (state.compacted) return` 导致 **整 invoke 只压一次** 且 prune 也可能被短路——改为：

- prune：**每步可运行**  
- LLM compact：冷却 `minStepsBetweenLlmCompact`（默认 **4**）或 token 再次超阈值  

### 3.4 Mid-loop / Mid-turn 继续（P1）

对齐 Codex：压缩后 **同一子代理任务继续**，不结束 turn。

| 场景 | 行为 |
|------|------|
| compactNode 成功 LLM 摘要 | 下一 agent 步正常调用模型 |
| overflow（context length） | 先 prune → 再 tool-round compact → **一次** retry；仍失败则返回 partial + 错误 |
| 摘要后模型需续跑 | 若最后一条不是「可行动」状态，注入 **synthetic** System/Human：`Continue the delegated task from the summary. Do not restart from scratch.`（`metadata.synthetic = true`，UI 可隐藏） |

**不要求** 用户再发消息。

### 3.5 Overflow 与错误分类（P1）

| 错误类 | 行为 |
|--------|------|
| context length / too many tokens | compact 路径（现有 `isOverflowError` 扩展正则若缺） |
| rate limit 429 | 不 compact；batch 已有串行退避 |
| `MODEL_NOT_FOUND` / permission | **不 compact**；友好错误 + 建议换模型；**尽量返回 partial**（见 3.6） |
| 其它 | 上抛 / 现有 safeError |

### 3.6 Partial 结果（P0 附带，低成本）

子代理 catch 模型错误时：

1. 若 trajectory 已有 tool 输出 / stream text → `synthesizeSubagentResult` + 附加 `Error: stopped early: …`  
2. **禁止** 仅返回 `Error: 404…` 丢掉已读文件线索  

（直接服务上次 k3 失败体验，与 compact 解耦但同 PR 可做。）

### 3.7 可观测性（P1）

| 事件 | 字段 |
|------|------|
| `emit.compaction` | reason: `prune` \| `tool_round_summary` \| `overflow`；beforeTokens, afterTokens, roundsPruned, roundsSummarized |
| Debug bundle v2 | 可选 `compactionEvents[]`（若易接） |
| 单测 | 断言 before > after |

### 3.8 配置面（P1）

`hip.toml` / `[agentLoop]` 扩展（名称可微调）：

```toml
[agentLoop.compaction]
enabled = true
prune = true
pruneProtectRounds = 8
pruneTriggerTokens = 24000
compactBudgetTokens = 48000
subagentCompactBudgetTokens = 32000
keepRecentToolRounds = 6
keepRecentTokens = 12000
minStepsBetweenLlmCompact = 4
autoContinueAfterCompact = true
```

Env 覆盖（可选）：`HIP_COMPACTION_PRUNE=0` 强制关 prune。

---

## §4 架构（逻辑）

```
toolsNode settle
  → (已有) ToolOutputStore.bound 单条预览
compactNode (每步):
  1. prune 旧 ToolMessage（默认 on）          # 廉价
  2. if token/rounds 超阈值:
       tool-round LLM summary + keep tail   # 中价
  3. 更新 lastCompact meta；emit.compaction
agentNode:
  model call
  on overflow → prune → summary → retry once
  on other error → partial synthesize
```

**与 OpenCode/Codex 映射：**

| 层 | OpenCode | Codex | hip 本 spec |
|----|----------|-------|-------------|
| Bound tool | truncate.ts | output-truncation | ToolOutputStore（已有） |
| Prune | prune old tools | mid-turn tool trim | **默认 micro/prune** |
| Summarize | SessionCompaction | compact.rs | tool-round compactMessages |
| Mid-turn | auto-continue | MidTurn compact | compactNode + continue |

---

## §5 设计决策（待审核选项）

### D1 — 摘要消息角色

| 选项 | 利 | 弊 | 建议 |
|------|----|----|------|
| A. `SystemMessage` `[对话摘要]`（现状） | 实现简单 | 部分模型对中段 system 不敏感 | **首版 A** |
| B. User 角色 + 固定 prefix（Codex/Kimi） | 更接近训练 | 污染 user 列表 | 二期若 A 效果差再迁 |

### D2 — Prune 默认力度

| 选项 | 说明 | 建议 |
|------|------|------|
| A. 激进（保护 4 rounds） | 省 token | 探索易丢细节 |
| B. 中等（保护 8 rounds） | 平衡 | **推荐** |
| C. 保守（保护 15 rounds） | 质量 | 长 explore 仍易爆 |

### D3 — LLM compact 频率

| 选项 | 说明 | 建议 |
|------|------|------|
| A. 每超预算就摘要 | 最稳 | 摘要费用高 |
| B. 先 prune，仍超再摘要 + 冷却 4 步 | 成本可控 | **推荐** |
| C. 仅 overflow 时摘要 | 太晚 | 否 |

### D4 — 与 `compacted: boolean` 的关系

**必须改掉「整图只压一次」语义。** 建议字段：

```ts
compactionMeta: {
  llmCompactCount: number
  lastLlmCompactStep: number
  lastPruneStep: number
}
```

### D5 — Subagent 是否比 supervisor 更紧

| 选项 | 建议 |
|------|------|
| explore/child 用 32k 预算 + 保护 6 rounds | **是**（explore 是事故源） |
| supervisor 保持 48k | **是** |

---

## §6 成功标准

| ID | 标准 | 验证 |
|----|------|------|
| S1 | 单 Human + 30 个 tool-round 的 fixture：prune 后 `estimateTokens` 下降 ≥ **30%** | 单测 |
| S2 | 同 fixture 且强制超预算：LLM tool-round compact **不** return null；摘要存在；tail rounds 仍含最近 tool 全文 | 单测 |
| S3 | `humanIdxs.length === 1` 不再成为 compact 永久失败条件 | 单测 |
| S4 | micro/prune **默认 on**；无需 env | 单测 + 默认配置 |
| S5 | compact 后 graph **继续** agent 步（不结束 subagent） | 单测 / 集成 |
| S6 | 模型抛错时 subagent 返回 **partial + error**，非纯 404 字符串（有 tool 时） | 单测 |
| S7 | 回归：多 Human 多轮对话 compact 行为不劣于现状 | 现有 compaction 测试更新后仍绿 |
| S8 | 手动：双 explore `task_batch` 长扫，debug 见 `compaction` 事件且后期 input tokens 不再单调线性暴涨 | 手工 / 可选 harness |

**不做成功标准：** 保证 Kimi `k3` 会员权限错误消失（那是账号/模型选择问题）。

---

## §7 测试计划

| 层 | 内容 |
|----|------|
| Unit | `compactMessages` tool-round 模式；1 Human 不 null；配对不拆 |
| Unit | prune 保护窗口 / 最小回收 / 默认 on |
| Unit | `compacted` 不再阻断 prune；LLM 冷却 |
| Unit | overflow vs MODEL_NOT_FOUND 分流 |
| Unit | partial synthesize on error |
| Graph | fake 长 tool 环 → compactNode 降 token → agent 再调用 |
| 回归 | 现有 `compaction` / sliding-window / micro 测试适配默认 on |

避免 paid LLM：summarizer mock 返回固定摘要。

---

## §8 风险与缓解

| 风险 | 缓解 |
|------|------|
| 摘要丢掉关键路径/版本 | 摘要模板强制 paths；tail 保留最近 tool 全文 |
| prune 后模型「幻觉」已读内容 | stub 标明 cleared；摘要写 findings |
| 摘要 LLM 费用 | 先 prune；冷却；subagent 更紧阈值 |
| tool 配对破坏 | 仅在 round 边界切；单测 orphan tool |
| UI 时间线变短 | model-visible 压缩 ≠ 删 SQLite tool_calls；UI 仍用事件轨迹 |
| 与 LangGraph RemoveMessage 复杂交互 | 沿用现有 remove + summary id 模式；集成测 |

---

## §9 实施分期（供 plan 拆 PR）

| 阶段 | 内容 | 优先级 |
|------|------|--------|
| **M1** | tool-round 切点 + 1-Human fallback；修 `compacted` 阻断；prune 默认 on | P0 |
| **M2** | subagent 更紧预算；emit 指标；partial on error | P0/P1 |
| **M3** | 结构化摘要模板增强；auto-continue synthetic；配置 toml | P1 |
| **M4** | usage-based 阈值；debug compactionEvents；可选更激进 full-compact 策略开关 | P2 |

---

## §10 明确不做

- 不实现 provider remote compact API  
- 不把 supervisor `maxSteps` 从 800 下调作为「压缩替代」  
- 不在本 spec 解决 Kimi 会员/`k3` 权限（仅友好错误 + partial）  
- 不删除用户可见的完整会话导出中的 tool 历史（除非另开 privacy spec）  

---

## §11 已锁定决策（2026-07-17）

| # | 决策 | 锁定值 |
|---|------|--------|
| 1 | Prune 保护 | **8 tool-rounds**（≈ keepRecent messages 窗口，与 OpenCode protect + Hermes tail 平衡） |
| 2 | 摘要角色 | **SystemMessage + `[对话摘要]`**（与现有 hip compact 一致；LangGraph system 注入友好） |
| 3 | 默认 prune | **接受默认开启** |
| 4 | Subagent 预算 | **32_000** tokens（explore/child 更紧；supervisor 仍 48k） |
| 5 | Partial-on-error | **并进本阶段**（同 M1/M2） |

---

## §12 参考路径

| 来源 | 路径 |
|------|------|
| hip 现状 | `packages/sidecar/src/session/{graph,compaction,micro-compaction}.ts`, `context/sliding-window.ts` |
| OpenCode | `…/opencode/packages/opencode/src/session/compaction.ts`, `tool/truncate.ts` |
| Codex | `…/codex/codex-rs/core/src/{compact.rs,session/turn.rs}` |
| Hermes | `…/hermes-agent/agent/context_compressor.py` |
| Kimi-Code | `…/kimi-code/packages/agent-core/src/agent/compaction/` |
| pi | `…/pi/packages/agent/src/harness/compaction/` |
| 触发日志 | `docs/hip-debug-uigsEO_MrE0xMEl5zAGhJ-2026-07-17.json` |

---

**End of draft.** 审核通过后补 plan（任务拆分 + 测试清单 + PR 顺序）再动手实现。
