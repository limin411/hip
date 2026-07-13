# Plan: Code 场景 grep / DSML / 子代理空输出 / TIMEOUT

> **For agentic workers:** Implement task-by-task. Checkbox steps. Prefer surgical diffs. Do **not** rewrite the multi-agent graph or switch the default model.

**Goal:** Code surface 探索类对话在 DeepSeek V4 与 PCRE 风格 grep 下能完成检索并回传可用结果，不再以 raw DSML + invalid regex + TIMEOUT 结束。

**Spec:** [`../specs/2026-07-13-code-surface-grep-dsml-timeout-spec.md`](../specs/2026-07-13-code-surface-grep-dsml-timeout-spec.md)

**Evidence:** `logs/bug.json`（session `UvOv31jfhzrA8Q_alfTgH`）

**Architecture (minimal):**

```text
Model stream ──► [DSML normalize] ──► Graph tool loop
                                           │
grep(pattern) ──► [strip (?i) / caseInsensitive] ──► RegExp / walk
                                           │
dispatch_agent ──► lastAiText || synthesize(trajectory)
```

**Tech stack:** 现有 sidecar TypeScript、Vitest、zod tool schema。P0 不引入 ripgrep 依赖。

---

## Dependency graph

```text
T1 grep 归一化 + caseInsensitive + 单测          ──► 可独立合入
T2 DSML parser + model-runner 挂钩 + 单测        ──► 可与 T1 并行
T3 子代理空结果合成（dispatch/task）             ──► 依赖轨迹数据结构（已有）
T4 explore 步数 / 结束提示（可选）               ──► 独立
T5 idle kick / TIMEOUT 文案（可选）              ──► 独立
T6 文档与工具 description                        ──► 随 T1/T2
```

**推荐合入顺序：** T1 → T2 → T3 → T6 →（T4/T5 视工期）

---

## T1 — Grep：JS 正则健壮化（P0）

**Files:**

- `packages/sidecar/src/session/tools/file.ts`
- 新建或扩展：`packages/sidecar/src/session/tools/helpers.ts`（`compileGrepPattern`）
- 测试：`packages/sidecar/src/session/tools/file.grep.test.ts`（或现有 tools 测试文件）

**Steps:**

- [x] 抽出 `compileGrepPattern(pattern: string, caseInsensitive?: boolean): { re: RegExp; notes: string[] } | { error: string }`
  - 剥离前缀 `(?i)` / `(?m)` / `(?s)` / 组合 `(?im)` 等；映射到 flags
  - `caseInsensitive` → 追加 `i`
  - 构造 `new RegExp` 包 try/catch；error 含 Hint 文案
- [x] `grep` tool schema 增加 `caseInsensitive: z.boolean().optional()`
- [x] description 写明：JavaScript RegExp；prefer `caseInsensitive`；do not use PCRE `(?i)`
- [x] 单测：
  - pattern `(?i)zuolin` 匹配 `ZuolinConfig`
  - `caseInsensitive: true` + `zuolin` 匹配
  - 未 strip 的真正非法 pattern 仍 error
  - notes 非空时可选附加到 tool 返回（首行 note 或尾注）

**Acceptance:** bug.json 中的两个 `(?i)...` pattern 在 fixture 文本上可匹配；无 Invalid group。

**参考：** kimi-code `"-i"`、pi `ignoreCase`、zed 默认不敏感（我们 **不** 改默认全局不敏感）。

---

## T2 — DeepSeek DSML → tool_calls（P0）

**Files:**

- 新建 `packages/sidecar/src/session/dsml.ts`（纯函数：normalize + parse）
- `packages/sidecar/src/session/model-runner.ts`（stream 结束后调用）
- 测试：`packages/sidecar/src/session/dsml.test.ts`

**Steps:**

- [x] 实现检测：content 是否含 DSML tool_calls 块（全角 `｜DSML｜` 与退化 `||DSML||` / 文档中的变体）
- [x] 解析 `invoke name="..."` 与嵌套 `parameter name="..." ...>value</parameter>`
- [x] 输出 LangChain 兼容 `tool_calls[]` + 剥离后的 `content`
- [x] 在 `RealModelRunner.run` 返回前：若无 structured tool_calls 且 parse 成功 → 挂到 AIMessage
- [x] 解析失败：尽量 strip markup，保留前后自然语言；`logInfo('model', 'dsml_parse_failed', ...)`
- [x] 单测：使用 bug.json 中的 `run_script` DSML 片段；多 invoke；无 DSML identity

**Acceptance:** fixture 解析出 `name: 'run_script'` 与 `command`/`reason` 参数；graph 在 mock runner 下可进入 tools 节点（可选轻集成）。

**注意：** 勿把 reasoning/thinking 块误当 DSML；只匹配 tool_calls 包裹。

---

## T3 — 子代理空输出合成（P1）

**Files:**

- `packages/sidecar/src/session/session-turn-runner.ts`（`dispatchAgent` 返回）
- `packages/sidecar/src/session/tools/subagent.ts`（task 空输出路径，文案统一）
- 新建小纯函数：`packages/sidecar/src/session/subagent-result.ts` — `synthesizeSubagentResult(text, toolSummaries)`
- 测试：`subagent-result.test.ts`

**Steps:**

- [x] 定义「无用文本」：`!trim` 或仅匹配 DSML/空白
- [x] 从 child trajectory 的 toolCalls（name + 截断 output）拼摘要，cap 例如 4k chars / 12 tools
- [x] `return synthesize(...)` 替代裸 `'(sub-agent produced no output)'`
- [x] 无 tool 时返回 **Error:** 前缀句（与 `tools/subagent.ts` 一致），提示 retry / 自己做

**Acceptance:** 模拟 empty text + 2 条 grep finished → 返回含文件路径片段的摘要；supervisor 可继续推理。

---

## T4 — Explore 步数与结束提示（P1，可选）

**Files:**

- `packages/sidecar/src/session/loop-control.ts` 或 explore agent 配置
- `packages/sidecar/src/session/system-prompt.ts` / fixed agent prompt
- `packages/protocol` 中 FIXED_AGENTS explore 描述（若存在）

**Steps:**

- [x] 评估将 `CHILD_MAX_STEPS` 自 15 提到 25，**或** 仅 explore profile 更高 cap（优先局部，避免全局涨费用）→ `EXPLORE_CHILD_MAX_STEPS = 30`
- [x] `MAX_STEPS_NOTE` 后仍无 prose 时依赖 T3 合成（不单靠模型）
- [x] explore 提示增加：结束时必须纯文本结论；禁止 XML/DSML

**Acceptance:** 大任务探索更少「做到一半无总结」；单测不依赖真模型时可 mock steps。

---

## T5 — Idle TIMEOUT 健壮性（P2，可选）

**Files:**

- `packages/sidecar/src/session/tools/file.ts`（grep walk 中周期性 activity callback）
- `packages/sidecar/src/session/session-turn-runner.ts` / `workflow-runner.ts`（TIMEOUT message）
- `packages/sidecar/src/session/session.ts`（可选：code surface idle 默认）

**Steps:**

- [x] 长工具执行期间 ToolRunner `onActivity` 脉冲 → GraphEmit.activity → idle kick（覆盖 grep/glob walk）
- [x] TIMEOUT 的 `error.message` 改为非空可读字符串（`idleTimeoutMessage`）
- [x] 文档注明 60s 为 **idle** 非 wall-clock

**Acceptance:** 单测或 mock 长 walk 期间 watchdog 被 kick；TIMEOUT 文案断言。

---

## T6 — 文档与收尾

**Steps:**

- [ ] 更新 spec 状态为 Implemented（完成项打勾）
- [ ] 若有用户可见 release note / CHANGELOG 习惯则补一行（无则跳过）
- [ ] 跑：`yarn test` 中涉及 sidecar tools/session 的子集；`yarn tsc` 如项目惯例

---

## Out of scope（本 plan）

- 默认切换全局模型离开 deepseek-v4-pro
- 完整 ripgrep 集成（可开 follow-up plan）
- Windows 中文路径专项（当前非主因）
- 修改 UI 消息导出格式

---

## Verification checklist（实现者自检）

```bash
# 聚焦单测（路径按实际文件调整）
yarn vitest run packages/sidecar/src/session/dsml.test.ts \
  packages/sidecar/src/session/tools/file.grep.test.ts \
  packages/sidecar/src/session/subagent-result.test.ts

# 类型
yarn tsc -p packages/sidecar
```

手工（可选，真模型）：

1. Code surface 打开任意仓库，问「搜索大小写不敏感的 Config」；确认不再 Invalid group。
2. deepseek-v4-pro 下多轮 tool 对话；若出现 DSML 泄漏，工具仍应执行或至少不展示 raw 块作为唯一答案。

---

## Effort estimate

| Task | 规模 |
|------|------|
| T1 | S–M（~1 文件逻辑 + 测） |
| T2 | M（parser 边界 + runner 挂钩） |
| T3 | S–M |
| T4 | S |
| T5 | S |
| T6 | S |

P0（T1+T2）建议同一 PR 或紧密串联两个 PR；T3 紧随其后。
