# Spec: Code 场景对话失败（grep 正则 / DSML / 子代理空输出 / TIMEOUT）

| 字段 | 值 |
|------|-----|
| 日期 | 2026-07-13 |
| 状态 | **Implemented**（T1–T5：grep / DSML / 合成 / explore 步数 / idle TIMEOUT） |
| 范围 | Code surface 会话：`grep` 工具、DeepSeek V4 tool-call 归一化、`dispatch_agent` 结果回传、turn idle TIMEOUT |
| 证据 | [`logs/bug.json`](../../../logs/bug.json)（session `UvOv31jfhzrA8Q_alfTgH`） |
| 关联 plan | [`../plans/2026-07-13-code-surface-grep-dsml-timeout.md`](../plans/2026-07-13-code-surface-grep-dsml-timeout.md) |
| 参考实现 | `opencode` / `kimi-code` / `pi` / `zed` grep 工具；vLLM DeepSeek V4 tool parser；Hermes/Cherry Studio DSML 相关 issue |

---

## 1. Overview

### 1.1 用户可见现象

在 **Code** 场景（`surface: "code"`）下，用户提问：

> 当前项目与 Zuolin 做了哪些数据的同步

会话使用 `deepseek` / `deepseek-v4-pro`，`orchMode: "fast"`，`permissionMode: "full"`。最终：

- 助手消息以 raw **DSML** 标记与 **`(timed out)`** 结束；
- `recentErrors` 含 `code: "TIMEOUT"`；
- 工具轨迹中多次出现 `Error: invalid regex: ... Invalid group`；
- `dispatch_agent` 返回 `(sub-agent produced no output)`，尽管子代理实际跑了大量 grep/ls/read。

用户感知：**探索中途报错并超时，没有得到可用总结。**

### 1.2 问题分层（因果链）

本 bug **不是单一缺陷**，而是一条串联故障链：

```text
Supervisor dispatch explore
        │
        ▼
Sub-agent 探索成功（发现 ZuolinConfig / DataSyncService 等）
        │
        ├─► (A) 末轮 DeepSeek 输出 DSML 文本 tool-call，未进入结构化 tool_calls
        │         → lastAiText 为空或无用 → dispatch 回传 “(sub-agent produced no output)”
        │
        ▼
Supervisor 自行补搜
        │
        ├─► (B) grep pattern 使用 PCRE 内联标志 (?i)...
        │         → JS RegExp 抛 Invalid group → 搜索失败
        │
        └─► (C) 长 turn / abort / idle → TIMEOUT，消息追加 “(timed out)”
```

| ID | 根因 | 严重度 | 可复现性 |
|----|------|--------|----------|
| **R1** | `grep` 用 `new RegExp(pattern)`，**不支持** PCRE/Python 风格内联 `(?i)`；无 `case_insensitive` 参数 | **P0** | 高（模型常发 `(?i)foo`） |
| **R2** | DeepSeek V4 偶发把 **DSML** tool-call 写进 `content`，API/`@langchain` 未解析为 `tool_calls`；hip 无 fallback 解析 | **P0** | 中高（V4-Pro 已知问题） |
| **R3** | `dispatch_agent` 仅返回 `lastAiText`；空串 → `(sub-agent produced no output)`，**忽略** 轨迹中已完成的 tool 证据 | **P1** | 与 R2 叠加必现 |
| **R4** | 探索型子代理 `CHILD_MAX_STEPS = 15`，工具轮次耗尽后模型易乱输出（含 DSML）而非结构化总结 | **P1** | 中（大仓库探索） |
| **R5** | Turn idle watchdog 60s；或 abort 传播导致进行中的 grep `This operation was aborted` + TIMEOUT | **P2** | 视环境与长工具 |

### 1.3 证据摘录（`logs/bug.json`）

**会话配置：**

- `surface: "code"`，cwd 为 Windows 路径（含中文目录）
- `llmProvider: "deepseek"`, `model: "deepseek-v4-pro"`

**R1 — 无效正则：**

```text
grep pattern="(?i)zuolin|zuo_lin|zuo-lin"
→ Error: invalid regex: Invalid regular expression: /(?i)zuolin|zuo_lin|zuo-lin/: Invalid group

grep pattern="(?i)sync|同步"
→ Error: invalid regex: ... Invalid group
```

对比：同一子代理用字面量 `"zuolin"` / `"Zuolin"` 时 **成功命中** 业务代码。

**R2 — DSML 泄漏：**

```text
assistant.content / subagent.output:
<｜｜DSML｜｜tool_calls>
  <｜｜DSML｜｜invoke name="run_script">
  ...
</｜｜DSML｜｜tool_calls>
(timed out)
```

**R3 — 子代理“无输出”：**

```text
dispatch_agent → output: "(sub-agent produced no output)"
```

同时 `agentRuns[subagent-1]` 的 `output` 为 DSML 文本（token tee 积累），且 toolCalls 中已有大量有效 `grep`/`read_file` 结果。  
实现位置：`session-turn-runner.ts` — `return text || '(sub-agent produced no output)'`；`ensureFinished` 用 tee 回填 trajectory，但 **返回值不回填**。

**R5 — TIMEOUT：**

```json
"recentErrors": [{ "code": "TIMEOUT", "message": "", "at": ... }]
```

`IdleWatchdog` 默认 `DEFAULT_IDLE_TIMEOUT_MS = 60_000`；`send()` 会 kick，但 abort 后进行中的工具会得到 `This operation was aborted`。

### 1.4 代码锚点

| 区域 | 路径 | 说明 |
|------|------|------|
| grep 实现 | `packages/sidecar/src/session/tools/file.ts` L152–188 | `new RegExp(pattern)`，无 case 开关，无内联 flag 归一化 |
| 子代理步数 | `packages/sidecar/src/session/loop-control.ts` | `CHILD_MAX_STEPS = 15`，`MAX_STEPS_NOTE` 强制纯文本 |
| dispatch 回传 | `packages/sidecar/src/session/session-turn-runner.ts` ~L825 | 空 text → 占位句 |
| lastAiText | `packages/sidecar/src/session/subagent.ts` L69–80 | 仅最后一条 AI 文本，不合成工具摘要 |
| model stream | `packages/sidecar/src/session/model-runner.ts` | 透传 content；无 DSML 解析 |
| idle 超时 | `packages/sidecar/src/session/session.ts` `DEFAULT_IDLE_TIMEOUT_MS`；`session-turn-runner` / `workflow-runner` | TIMEOUT + `(timed out)` |

### 1.5 目标

| ID | 目标 |
|----|------|
| G1 | 模型使用 `(?i)...` 或等价大小写不敏感写法时，**grep 成功**，不抛 Invalid group |
| G2 | DeepSeek V4 将 DSML 写在 content 时，**尽量执行工具** 或至少剥离 DSML 并提示重试，不把 raw 标记当最终答案 |
| G3 | 子代理有实质 tool 轨迹但无最终文本时，supervisor **收到可用摘要**（非 “produced no output”） |
| G4 | Code 探索类 turn 在正常工具活动下 **不误杀** 为 TIMEOUT；超时信息可诊断 |
| G5 | 单测覆盖 R1/R2/R3 核心路径，无需付费 LLM |

### 1.6 非目标

| ID | 非目标 | 说明 |
|----|--------|------|
| NG1 | 本期全面换成 ripgrep 原生二进制 | 可作为 P1.5 增强；P0 先修 JS 路径 + 参数语义 |
| NG2 | 修复 DeepSeek 官方 API 侧 DSML 规范化 | 只能客户端防御 |
| NG3 | 重写整个 multi-agent 编排 | 只改回传与解析边界 |
| NG4 | Windows 路径 / 中文 cwd 专项 | 日志中简单 pattern 已工作；非本 bug 主因 |
| NG5 | 调整产品默认模型 | 可文档提示，不强制 |

---

## 2. 外部与仓库内最佳实践

### 2.1 Grep 工具设计（参考 `/Users/lijiamin/data/code-repository/github/`）

| 项目 | 做法 | 可借鉴点 |
|------|------|----------|
| **kimi-code** | ripgrep + schema 显式 `"-i": boolean` | **一等公民 case-insensitive**；pattern 文档写清 rg 语法 |
| **pi** | `ignoreCase` / `literal` 布尔参数 | 布尔 flag 优于内联 `(?i)` |
| **zed** | `case_sensitive` 默认 **false**（默认不敏感） | 降低模型踩坑概率 |
| **opencode** | ripgrep 后端 + 结果截断 | 性能与大仓稳定性 |
| **deer-flow RFC** | 原生 grep/glob 替代 bash；结构化、限流、审计 | hip 已走原生工具，方向正确 |

**结论：** 编码 agent 生态普遍：

1. **显式 case 开关**（不要依赖 PCRE `(?i)`）；
2. **ripgrep 或等价引擎** 处理大仓；
3. 工具描述写明「JS/rg 语法差异」与「勿用 shell grep」。

### 2.2 DeepSeek V4 DSML（外部）

- V4 使用 DSML special token + XML 风格 tool-call（`tool_calls` / `invoke` / `parameter`）。
- 社区多次报告：DSML 出现在 **`message.content`**，未进入 OpenAI 风格 `tool_calls`（Hermes #15453、Cherry Studio #14714、HF DeepSeek-V4-Pro #209）。
- vLLM 提供 `deepseekv4_tool_parser`：把 DSML 解析为标准 tool calls。
- 客户端防御模式：检测 content 中的 DSML → 解析为结构化 `tool_calls` → 清空/剥离 content 中的 markup → 进入正常 tool 执行环。

### 2.3 子代理结果合成

当 `lastAiText` 为空时：

- 合成 **tool 轨迹摘要**（读过的文件、命中关键词、错误列表）作为 dispatch 返回值；
- 或强制再跑一轮「仅文本、无工具」总结（代价更高）；
- hip 已有 `MAX_STEPS_NOTE` 与 `ensureFinished` 的 tee 回填雏形，但 **未用于 tool 返回字符串**。

---

## 3. 解决方案设计

### 3.1 P0-A：健壮 `grep`（必做）

**Schema 扩展：**

```ts
z.object({
  pattern: z.string(),
  path: z.string().optional(),
  caseInsensitive: z.boolean().optional().describe(
    'Case-insensitive match. Prefer this over (?i) inline flags. Default false.',
  ),
})
```

**Pattern 归一化（在 `new RegExp` 之前）：**

1. 若 pattern 匹配 `/^\(\?i\)/` 或常见内联 flag 前缀（`(?i)`、`(?m)`、`(?s)`、`(?im)` 等），则：
   - 剥离 flag 前缀；
   - 将对应能力映射到 JS flags（`i` / `m` / `s`）；
   - 在返回结果中 **hint**：`Note: stripped PCRE-style (?i); used caseInsensitive instead.`
2. 支持 scoped 形式若简单可解析：`(?i:foo)` → `foo` + `i`（可选 P0.5）。
3. `caseInsensitive === true` 时 `new RegExp(body, flags + 'i')`。
4. 非法 pattern：错误文案明确：

```text
Error: invalid regex: ... 
Hint: This tool uses JavaScript RegExp. Do not use PCRE flags like (?i); set caseInsensitive=true instead.
```

**Description 更新：** 写明 JS RegExp、推荐 `caseInsensitive`、禁止 `(?i)`。

**测试：**

- `(?i)zuolin|zuo_lin` → 命中 `Zuolin`；
- `caseInsensitive: true` + `zuolin` → 同上；
- 真正非法 pattern 仍 error，且含 Hint。

### 3.2 P0-B：DeepSeek DSML 内容 → 结构化 tool_calls（必做）

**插入点：** `RealModelRunner.run` 在 stream 聚合完成后，或 graph agent 节点拿到 `AIMessage` 之后（优先集中一处，避免重复）。

**行为：**

1. 若 `msg.tool_calls?.length` 已有有效项 → 不处理（API 已正确）。
2. 若 `content` 匹配 DSML 块（兼容全角 `｜DSML｜` 与退化 `||DSML||` / 双竖线变体）→ 解析 `invoke name` + `parameter name` 列表。
3. 转为 LangChain `tool_calls`：`{ id, name, args, type: 'tool_call' }`。
4. 从 content 中 **剥离** DSML 块，保留前后自然语言。
5. 日志：`model.dsml_recovered` 计数，便于观测。

**失败策略：** 解析失败则剥离已知 DSML 标签（避免用户看到 raw 标记），不假装成功；可选向模型注入短 system nudge 要求用 native function calling（P1）。

**测试：** 用 fixture 字符串（从 bug.json 提取）解析出 `run_script` + 参数；无 DSML 时 identity。

### 3.3 P1-A：子代理空结果合成（强烈建议）

**当** `dispatch_agent` / `task` 返回 text 为空，或 text 仅为 DSML/空白：

1. 从该 child 的 trajectory / toolCalls 生成简短摘要（最多 N 条 tool 结果、总字符 cap）；
2. 前缀：`[sub-agent finished without a prose summary; reconstructed from tool results]`；
3. 若无 tool 记录，才返回明确错误：`Error: sub-agent produced empty output. Retry or do the work yourself.`

**对齐** `tools/subagent.ts` 与 `session-turn-runner` 的文案，避免两套占位句。

### 3.4 P1-B：探索子代理步数与结束行为

- 将 explore 类 fixed agent 的 `childMaxSteps` 提高到 **25–40**（或可配置），或在 `MAX_STEPS_NOTE` 后强制本地合成摘要（不依赖模型）。
- 系统提示补充：结束前必须用中文/英文 **纯文本** 列出文件路径与结论，禁止输出 DSML/XML。

### 3.5 P2：TIMEOUT 可诊断性与误杀

- 工具执行路径（尤其 `grep` walk）周期 `watchdog.kick` 或通过 `tool:progress` 事件 kick（当前依赖 `send`；长 walk 无 send 时可能误杀）。
- TIMEOUT error `message` 填入可读原因：`Idle timeout after ${ms}ms with no outbound activity`。
- Code surface 默认 idle 可考虑 120s（配置项，默认仍可 60s + 工具内 kick）。

### 3.6 P1.5（可选后续）：ripgrep 后端

与 opencode/kimi 对齐：优先 `rg`，失败回退 JS walk。带来：速度、gitignore、大仓稳定性。本期 **不阻塞** P0。

---

## 4. 用户体验

### 4.1 修复后期望路径

1. 用户在 Code 项目问「与 Zuolin 的数据同步」；
2. Supervisor 可 `dispatch_agent(explore)` 或自行 `grep`；
3. `(?i)zuolin` 或 `caseInsensitive` 均能命中 `ZuolinConfig` / `DataSyncService` 等；
4. 若模型吐出 DSML，系统静默转为 tool 执行，用户 UI 看到正常 tool 卡片，而非 raw 标记；
5. 子代理即使未写长总结，supervisor 也能基于合成摘要继续回答；
6. 正常活跃 turn 不 TIMEOUT；若仍超时，错误文案可诊断。

### 4.2 降级

| 场景 | 行为 |
|------|------|
| DSML 解析失败 | 剥离 markup + 保留前后文本；turn 继续 |
| grep 仍非法 | 带 Hint 的 error，模型可改 pattern |
| 子代理零 tool | 明确 Error，supervisor 自行搜 |

---

## 5. 测试计划

| 层 | 用例 |
|----|------|
| 单测 `file.ts` / helpers | `(?i)` 剥离；`caseInsensitive`；hint 文案；合法/非法 pattern |
| 单测 DSML parser | bug.json fixture；双竖线退化；多 invoke；无 DSML identity |
| 单测 dispatch 合成 | empty text + tool trajectory → 非空摘要；无 trajectory → error |
| 集成（可选 mock model） | stream 返回 DSML content → tools 实际执行一次 |
| 回归 | 现有 file tools / subagent / idle-watchdog 测试全绿 |

付费真 LLM 不作为门禁。

---

## 6. 风险与权衡

| 风险 | 缓解 |
|------|------|
| 错误解析 DSML 导致假 tool call | 严格匹配 invoke/parameter；失败只剥离不执行 |
| `(?i:...)` 复杂嵌套解析不全 | P0 只做全串前缀 `(?i)`；scoped 作 P0.5 |
| 提高 CHILD_MAX_STEPS 增加费用/时延 | 仅 explore profile 或可配置 |
| 默认 case-insensitive（zed 风格）改变语义 | **不**默认改全局；用显式参数 + 归一化 |

---

## 7. 成功标准

- [x] `grep` 对 `(?i)zuolin|zuo_lin|zuo-lin` 返回命中而非 Invalid group
- [x] bug.json 中的 DSML `run_script` fixture 可解析为 tool_call
- [x] dispatch 在「仅有 tool 轨迹、无 prose」时返回合成摘要
- [x] 相关单测通过；`yarn test` 中 sidecar 相关套件无新增失败
- [x] 文档/工具 description 明确 JS RegExp 与 `caseInsensitive`

---

## 8. 附录：故障时间线（逻辑）

| 阶段 | 观察 |
|------|------|
| T0 | 用户提问 Zuolin 同步 |
| T1 | Supervisor `dispatch_agent(explore, 长任务)` |
| T2 | Subagent 多轮 grep/ls/read，发现 Sync/Zuolin 相关 Java 代码 |
| T3 | 末轮 content 变为 DSML `run_script`；dispatch 回传 no output |
| T4 | Supervisor 用 `(?i)...` 自搜 → invalid regex；一次 grep aborted |
| T5 | Turn 以 TIMEOUT / `(timed out)` 结束；用户无完整答案 |
