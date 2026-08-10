# 内置智能体能力升级 Plan（长编程工程任务方向）

> 系列：`agent-capability-upgrade/`；关联：`agent-capability-upgrade-spec.md`（§5 方案详情，本 plan 的实施细化）
> 状态：草案（待评审）
> 日期：2026-08-10
> 范围：`packages/sidecar/` + `e2e/eval/`；无 UI 改动，`*-preview.html` 不适用

## 0. 执行总览

| 阶段 | 内容 | 依赖 | 预计 | 提交点 |
|---|---|---|---|---|
| M1 | G1 技能评估 · G2 Turn 观测性 | 无 | 3–4 人日 | 每项独立提交（`feat(agent): …` 风格），M1 结束打 tag |
| M2 | G3 elicitation · G5 后台注入 · G6 预算 | M1（G2 记账） | 4–5 人日 | 每项独立提交 |
| M3 | G4 OS 沙箱 | M1 | 4–6 人日 | 分「policy/launcher/violation」三提交 |
| M4 | G7/G8/G9 接口预留 | M1 | 1 人日 | 单提交 |

每个阶段完成判据 = 该阶段「测试范围」全绿 + `yarn test:longrun-gate` 不回归（M2 起）。

---

## 1. M1 — P0 两项

### 1.1 G1 技能路由与行为评估

**新增文件**

```
e2e/eval/skills/
  router.test.ts        # 免费路由评估（无 LLM）
  cases/planning.json   # 首个行为样例集（含 trigger.positive/negative）
  cases/reviewer.json
  fixtures/planning/    # 行为样例的隔离仓库种子
  runner.ts             # 行为评估 runner：复用 load-task/workspace 的隔离机制
packages/sidecar/src/session/skills/router.ts   # 把「描述检索选择技能」抽成可测纯函数（若当前内联则抽取）
```

**实现步骤**

1. 定位当前技能选择逻辑（`skills/registry.ts` + `dynamic-context.ts`/工具清单注入处），抽出 `router.ts`：`rankSkills(query, skills, topK)` + `collisionCheck(descriptions)`（相似度阈值 0.75）。
2. `router.test.ts`：对 `packages/product-content/` 内置技能（含 `ops/` 编码技能）跑正负样例断言；两两描述碰撞检测。
3. `runner.ts` + cases：行为样例复用 `e2e/eval/workspace.ts` 的 worktree 隔离；grader 按 `expectations[]` 判分（`e2e/eval/verify.ts` 模式）。
4. 流程护栏：`scripts/generate-product-content.mjs`（`yarn product:content`）追加「新内置技能必须附 cases/ 路由样例」校验；CI 对 `product-content` 变更触发 `router.test.ts`。

**测试范围 T1**

| 编号 | 层级 | 文件 | 用例 | 运行通道 |
|---|---|---|---|---|
| T1-U1 | 单测（免费） | `skills/router.test.ts` | 正样例 top-1 命中率 100%；负样例不进 top-3；描述碰撞 ≥0.75 报错；空技能集不炸 | `yarn test` |
| T1-U2 | 单测（免费） | `skills/cases-schema.test.ts` | case JSON schema 校验（trigger/evals/expectations 字段齐全）；`kind: execution|dialogue` 合法 | `yarn test` |
| T1-E1 | e2e 付费（门禁） | `e2e/eval/skills/runner.ts` | planning + reviewer 各 1 条 execution 样例：headless 会话执行→grader 按 expectations 判 pass | `yarn test:longrun-gate` |
| T1-C1 | CI | 路由回归随 `product-content` 变更自动跑 | 技能新增/描述修改时拦截路由退化 | CI |

**验收**：T1-U1/U2 绿；T1-E1 在 longrun-gate 通道与 MSM 同配额跑通；新增技能 PR 检查清单生效。

---

### 1.2 G2 Turn 级可观测性

**新增文件**

```
packages/sidecar/src/session/turn-timing.ts       # TTFT/TTFM/TurnProfile 计时器
packages/sidecar/src/session/turn-diff-tracker.ts # 每 turn git diff 摘要（复用 workspace-git）
packages/sidecar/src/session/turn-timing.test.ts
packages/sidecar/src/session/turn-diff-tracker.test.ts
```

**修改点（最小侵入）**

- `model-runner.ts`：`runModel` 内 `onText` 首块回调打 TTFT 戳、末块打 TTFM 戳；返回元数据带 `timing`。
- `session-turn-runner.ts`：每 turn 组装 `TurnProfile`（采样/压缩/工具阻塞分段——工具阻塞时长由 tool-runner 调用边界计时），写入 `loop-events` 事件与 SQLite（事件表新增 `turn_timing` 事件类型，复用现有事件落库路径）。
- `session/trace-export.ts`：trace 块增补 per-turn timing。
- `packages/cli/src/types.ts`：`HipRunResult` 增可选 `turnTiming[]`（向后兼容，`result-builder.ts` 从 sidecar 事件组装）。
- 配置：`[agentLoop].turnTiming = true` 默认开，关闭时不采集。

**测试范围 T2**

| 编号 | 层级 | 文件 | 用例 | 运行通道 |
|---|---|---|---|---|
| T2-U1 | 单测（免费） | `turn-timing.test.ts` | 假流式回调序列（延迟可控）：TTFT=首个 onText 前耗时、TTFM=结束耗时；profile 分段求和=总耗时（±ε）；`turnTiming=false` 时零采集 | `yarn test` |
| T2-U2 | 单测（免费） | `turn-diff-tracker.test.ts` | fixture 仓库：改动后 diff 摘要（文件数/增删行）正确；无改动→空摘要；diff 超时（模拟慢 git）→降级无记录不抛错 | `yarn test` |
| T2-U3 | 单测（免费） | `trace-export.test.ts`（扩展） | 含 timing 的 trace 块 schema 校验；缺 timing 的旧 trace 仍可导出（兼容） | `yarn test` |
| T2-I1 | 集成 | `session-turn-runner` 相关现有测试扩展 | fake runner 一个完整 turn → loop-events 含 turn_timing 事件、SQLite 可查 | `yarn test` |

**验收**：T2 全绿；对 MSM 场景产物 `trace.jsonl` 可输出每 turn TTFT/TTFM 与工具耗时 Top 榜（手工抽查 1 次）。

---

## 2. M2 — P1 三项

### 2.1 G3 Elicitation 澄清暂停

**新增文件**：`packages/sidecar/src/session/elicitation.ts`（+ `.test.ts`）
**修改点**：

- `graph.ts`：Supervisor 步骤投递 ToolMessage 前检查 `elicitation.isPaused()`（挂在 GraphCtx）；注册期间工具结果挂起。
- `session-input.ts`：用户消息解析优先匹配 pending elicitation（答复走 resolve，不当作新指令）。
- 协议：`@hip/protocol` 增 `session:elicitation` 事件 + `message:resolve-elicitation` 请求（UI 侧本轮仅透传，不做新 UI）。
- system-prompt 增「任务边界优先 ask_user」指引（提示层，非强制）。

**测试范围 T3**

| 编号 | 层级 | 文件 | 用例 | 运行通道 |
|---|---|---|---|---|
| T3-U1 | 单测（免费） | `elicitation.test.ts` | 注册→paused=true→resolve→false；并发注册计数（2 个 pending 需全部 resolve）；超时自动取消（假时钟）；resolve 未知 id 幂等 | `yarn test` |
| T3-I1 | 集成 | `graph` 相关集成（扩展现有 `graph-parallel-tools`/turn 集成） | fake runner：turn 中模型调用 ask_user → 断言后续工具结果不投递（消息历史无新增 ToolMessage）；resolve 后继续投递 | `yarn test` |
| T3-E1 | e2e 付费（可选量化） | MSM 新 scenario `scenarios/elicitation-guide.md` | 开启引导提示 vs 关闭，对比首轮（前 3 turn）内完成方向确认的次数与最终返工次数 | `yarn test:longrun-gate`（标记 optional） |

**验收**：T3-U1/I1 绿；T3-E1 产出对照记录（不强制阈值）。

### 2.2 G5 后台任务状态注入与 promote

**修改点**：

- `compaction.ts`：新增 `afterCompact` hook 点（当前无 hook，见 `micro-compaction.ts` 同源路径）；压缩完成后回调。
- `background-manager.ts` / `session-background.ts`：`completeTask` 成功后把结果挂起（`pendingResults: Map<taskId, summary>`）；主循环空闲或下一用户 turn 开始时注入一次摘要（system 注入，注入后即清除）。
- 压缩后注入：hook 触发时枚举活动任务（id/status/已运行时长/最新输出摘要）→ 作为 user fragment 注入当前上下文（参照 kimi-code `<background_task_status>` 时机：压缩后）。
- 配置：`[agentLoop].backgroundStatusInjection = true` 默认开。

**测试范围 T4**

| 编号 | 层级 | 文件 | 用例 | 运行通道 |
|---|---|---|---|---|
| T4-U1 | 单测（免费） | `compaction.test.ts`（扩展） | afterCompact hook 注册/触发/异常隔离（hook 抛错不影响压缩结果） | `yarn test` |
| T4-U2 | 单测（免费） | 新增 `background-inject.test.ts` | 活动任务枚举→注入文本格式；完成结果挂起→下个 turn 注入一次→清除（不重复注入）；无任务时不注入 | `yarn test` |
| T4-I1 | 集成 | `background-subagent.integration.test.ts`（扩展） | 后台任务运行中执行压缩 → 压缩后上下文含状态注入；任务完成后下一 turn 模型可引用其结果 | `yarn test` |

**验收**：T4 全绿；现有 background 集成不回归。

### 2.3 G6 跨代理树 token 预算与提醒

**新增文件**：`packages/sidecar/src/session/rollout-budget.ts`（+ `.test.ts`）
**修改点**：

- 记账：以 G2 的 usage 事件为数据源，按会话树聚合（parent + task_batch 子代理）；权重（采样+prefill）参照 codex 简化实现。
- 提醒：50%/80%/90% 阈值注入 fragment（per 树去重，注入内容：已用/上限/收敛策略建议）。
- 硬上限：超出走 `loop-control` 现有收尾路径（复用 force-plan 的 `clearForcePlanFlag` 机制风格，触发 `session:interrupt` 收尾），后台任务记 `budget_exceeded`。
- 配置：`[agentLoop].rolloutBudgetTokens`（默认 0=不限）。

**测试范围 T5**

| 编号 | 层级 | 文件 | 用例 | 运行通道 |
|---|---|---|---|---|
| T5-U1 | 单测（免费） | `rollout-budget.test.ts` | 加权记账（子树聚合）；阈值只触发一次（50% 重复记账不重复注入）；硬上限→收尾回调触发；`0`=不限不记账 | `yarn test` |
| T5-I1 | 集成 | `subagent-batch` 相关集成扩展 | task_batch 扇形展开下预算聚合正确、超限收尾路径被调用 | `yarn test` |

**验收**：T5 全绿；`[agentLoop].rolloutBudgetTokens` 未配置时行为与现状完全一致（回归关键点）。

---

## 3. M3 — G4 OS 级沙箱

**新增文件**

```
packages/sidecar/src/session/sandbox/
  policy.ts        # permission profile + network-policy → 沙箱要求（读/写根、只读 carveout、网络放行；fail-closed）
  policy.test.ts
  launcher.ts      # macOS seatbelt 渲染 + sandbox-exec 启动（路径固定）；Linux bwrap 参数生成（先渲染后接线）；Windows 占位（NotImplemented 报错降级）
  launcher.test.ts
  violation.ts     # 拒绝输出归一化为 FileSystemSandboxViolation/NetworkSandboxViolation + 恢复引导文案
  violation.test.ts
  index.ts         # wrapExec(profile, argv) 门面；mode=off|auto|require 决策
```

**修改点**：

- `task-runtime.ts`（shell 执行路径）：`[sandbox] mode=require` 或 `auto`+无人值守（background/cron/automation/`--hitl auto`）时走 `wrapExec`。
- `permission-manager.ts`：批准语义不变，沙箱为执行层兜底（拒绝≠撤销批准，只报 violation 事件）。
- 配置：`[sandbox] mode = off | auto | require`，默认 `auto`；交互前台（HITL 在场）不强制。

**测试范围 T6**

| 编号 | 层级 | 文件 | 用例 | 运行通道 |
|---|---|---|---|---|
| T6-U1 | 单测（免费） | `sandbox/policy.test.ts` | profile→要求推导：读写根/只读 carveout/网络放行正确；无网络代理信息时网络 fail-closed；windows 平台返回 unsupported 而非崩溃 | `yarn test` |
| T6-U2 | 单测（免费） | `sandbox/launcher.test.ts` | seatbelt 策略渲染快照（fixture profile → 期望 .sbpl 文本，含 deny read 规则）；sandbox-exec 路径固定（PATH 注入场景下仍解析固定路径）；argv 包装正确 | `yarn test` |
| T6-U3 | 单测（免费） | `sandbox/violation.test.ts` | 关键词/退出码 → 类型归一化；恢复引导文案包含「请求加白/切换权限档」 | `yarn test` |
| T6-I1 | 集成（macOS 实机） | `sandbox/exec.integration.test.ts` | 沙箱内写 `$HOME/x` 拒绝、写工作区根允许；`mode=require` 下 `--hitl auto` CLI 冒烟（touch 工作区文件） | `yarn test`（macOS CI） |
| T6-R1 | 回归 | 现有 CLI `--hitl auto` 测试 + background 集成 | `[sandbox] mode=auto`（默认）下行为不变 | `yarn test` |

**验收**：T6-U 全绿；T6-I1 在 macOS 绿（Linux/Windows 记为 unsupported 降级+文档注明）；T6-R1 不回归。

---

## 4. M4 — P2 接口预留（1 人日）

| 项 | 动作 | 测试 |
|---|---|---|
| G7 远程压缩 | `compaction.ts` 抽 `RemoteCompactor` 接口，默认实现=本地回退（空壳不接 provider） | 单测：接口缺省走本地路径（`compaction.test.ts` 扩展 1 例） |
| G8 记忆实体图 | `memory/pipeline/` 预留 phase3 枚举位（不实现），`memory/entity-store.ts` 只建类型与空 store 接口 | 单测：空 store 的 add/get 幂等 |
| G9 语音 | 不做代码，仅 spec 记录方向 | — |

---

## 5. 测试总范围矩阵

| 通道 | 内容 | 命令 | 期望时长 |
|---|---|---|---|
| 免费单测 | T1-U1/U2、T2-U1~U3、T3-U1、T4-U1/U2、T5-U1、T6-U1~U3、M4 两例 | `yarn test`（vitest） | +2~3 min |
| 集成（无 key） | T2-I1、T3-I1、T4-I1、T5-I1、T6-I1（macOS） | `yarn test` 集成标签 / macOS CI | +3~5 min |
| 付费门禁 | T1-E1（技能行为）、T3-E1（optional）、既有 MSM/bytebase/forgejo 回归 | `yarn test:longrun-gate`（`HIP_EVAL_MSM_PATH` 机制） | +30~60 min |
| e2e 冒烟（免费 dry） | 既有 `yarn test:longrun-unit` | `yarn test:longrun-unit` | 既有时长 |
| CI | T1-C1（技能路由随 product-content 变更回归） | CI workflow 扩展 | — |

**新增测试文件汇总**：单测/集成约 12 个新文件（router、cases-schema、turn-timing、turn-diff-tracker、elicitation、background-inject、rollout-budget、sandbox policy/launcher/violation、exec.integration、entity-store），7 处既有测试扩展（trace-export、session-turn-runner、graph 集成、compaction、background-subagent、subagent-batch、CLI `--hitl auto`）；e2e 新增 1 个 skills 行为评估目录（含 planning/reviewer 2 个 case）+ 1 个可选 scenario（elicitation-guide）。

## 6. 提交与回归节奏

1. 每工作项独立提交（功能 + 其测试同提交，符合 AGENTS.md §4）。
2. M1 结束：`yarn test` + `yarn test:longrun-unit` 全绿后打 tag `agent-m1`。
3. M2/M3 结束：追加 `yarn test:longrun-gate` 回归（付费通道一次）。
4. 量化记录：T3-E1 对照数据写入效果记录（参照 `docs/design/msm-dogfood-journal.md`）。

## 7. 风险与回滚

| 风险 | 触发信号 | 回滚/缓解 |
|---|---|---|
| 沙箱误伤正常开发流 | T6-R1 回归失败 / 用户工作区写入被拒 | 默认 `auto` 仅无人值守强制；`mode=off` 一键关闭；violation 文案引导加白 |
| 预算/注入机制改变长任务行为 | T5-I1、T4-I1 集成失败 | 两者默认配置保持「现状等价」（预算默认不限、注入可关），回滚=关配置即可 |
| 付费门禁时长膨胀 | longrun-gate 超配额 | T1-E1 每技能限 1 条样例；对照实验用同一 gate 配额内分批 |

## 8. 工时估算

| 阶段 | 估算 | 说明 |
|---|---|---|
| M1 | 3–4 人日 | G1 技能评估 1.5、G2 观测性 1.5–2 |
| M2 | 4–5 人日 | G3 1.5、G5 1.5、G6 1.5 |
| M3 | 4–6 人日 | policy 1、launcher 2–3（平台差异）、violation+接线 1–2 |
| M4 | 1 人日 | 接口预留 |
| 合计 | 12–16 人日 | 不含 longrun-gate 排队等待时间 |
