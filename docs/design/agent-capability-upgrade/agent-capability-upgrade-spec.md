# 内置智能体能力升级 Spec（长编程工程任务方向）

> 系列：`agent-capability-upgrade/`（本文件为 `*-spec.md`；`*-plan.md` 待批准后补写；本系列无 UI 改动，`*-preview.html` 不适用）
> 状态：草案（待评审）
> 日期：2026-08-10
> 范围：`packages/sidecar/`（agent 运行时）为主，`e2e/eval/` 验收为辅；不含视觉/交互重构

## 1. 背景与目标

hip 的内置智能体（sidecar 中的 Supervisor ReAct 循环）已具备业内较完整的能力面：多代理委派、规划模式、记忆管线、守护机制、压缩、门禁验证、crash 恢复等（见 §2 盘点）。但在**长编程工程任务**（一次任务数百步、跨多文件/多模块、需要长时间无人值守或半无人值守执行）上，与对比仓库（`/Users/lijiamin/data/code-repository/github/`）中业界领先实现相比，仍有可量化的能力缺口。

本 spec 的目标：

1. 盘点 hip 内置智能体现有能力（事实基线）；
2. 对照对比仓库中 15 个项目的关键机制，给出差距表；
3. 提出按优先级分期的升级方案（P0/P1/P2），每项含设计要点与验收标准；
4. 全部升级复用现有 dogfood 与评估基建（`e2e/eval/`、`yarn test:longrun-*`）回归。

**成功判据**：升级落地后，`make-stock-money` 等长任务场景的「无人工干预完成率 / 单任务 token 消耗 / 平均 turn 数」出现可测量改善，且新机制均有对应的自动化验收（评估或单测），不引入无验收的「软能力」。

## 2. 现状盘点（hip 已有能力基线）

以下均为 `packages/sidecar/src/` 中已存在且带测试的机制，本 spec **不重复建设**：

| 域 | 已有机制 | 关键文件 |
|---|---|---|
| 循环控制 | MAX_STEPS=800、子代理上限、doom-loop 检测、error-streak 刹车、prefire 预取、上下文预算 | `session/loop-control.ts`、`session/doom-loop.ts`、`session/prefire.ts`、`session/context-budget.ts` |
| 压缩 | LLM 摘要压缩、token-budget 压缩、溢出压缩、微压缩 | `session/compaction.ts`、`session/micro-compaction.ts`、`session/soft-trim.ts` |
| 规划 | plan-mode（AskUserQuestion/ExitPlanMode）、plan approval、force-plan、plan 持久化 | `session/plan-mode.ts`、`session/planner.ts`、`session/plan-persistence.ts` |
| 多代理 | Supervisor ReAct + `task`/`dispatch_agent`/`task_batch`、subagent-batch 并发、multi-agent handoff、teams、roundtable | `session/graph.ts`、`session/subagent-batch.ts`、`session/multi-agent-handoff.ts`、`session/teams/`、`session/roundtable/` |
| 隔离 | 子代理 worktree 隔离、会话 worktree | `session/isolation.ts`、`session/tools/isolation.ts` |
| 可靠性 | durable-executor、crash-recovery、replay、circuit-breaker、blackboard | `orchestrator/durable-executor.ts`、`session/crash-recovery.ts`、`session/replay.ts`、`orchestrator/circuit-breaker.ts` |
| 检查点 | 每 turn shadow git checkpoint + 精确回退工具 | `session/tools/checkpoint.ts` |
| 安全 | permission-manager（HITL）、guardian（LLM 预审工具调用）、network-policy、tool-policy | `session/permission-manager.ts`、`session/guardian.ts`、`session/network-policy.ts`、`session/tool-runner/tool-policy.ts` |
| 验证 | verification gates、reviewer-gate、gate-runner | `session/verification.ts`、`session/reviewer-gate.ts`、`orchestrator/gate-runner.ts`、`orchestrator/gates/` |
| 自动化 | cron、background-manager、后台子代理、automations 目录 | `session/cron.ts`、`session/background-manager.ts`、`~/.hip/automations/` |
| 记忆 | 跨会话记忆管线（phase1 抽取/phase2 合并/FTS/排序/脱敏/进化/预算/citations） | `memory/pipeline/`、`memory/ranking.ts`、`memory/redact.ts` |
| 扩展 | skills、plugins、MCP、hooks、ACP host（外接 agent） | `session/skills*`、`plugin/`、`session/mcp/`、`README.md §ACP host policy` |
| 项目上下文 | AGENTS.md / CLAUDE.md 加载 | `session/project-agents-md.ts` |
| 评估 | e2e/eval 长任务场景（make-stock-money、bytebase-*、forgejo、mini-go）、longrun gate | `e2e/eval/`、`yarn test:longrun-unit`、`yarn test:longrun-gate` |

## 3. 对比调研摘要

调研对象：`/Users/lijiamin/data/code-repository/github/` 下 15 个项目（2026-08-10，以源码为证）。

| 项目 | 一句话定位 | 对长任务最有借鉴价值的机制 |
|---|---|---|
| **codex**（Rust） | OpenAI 终端 agent | OS 级沙箱（seatbelt/bwrap/seccomp）；elicitation 暂停协调；turn 级时序（TTFT/TTFM）+ 每 turn diff 追踪；跨线程 rollout token 预算+阈值提醒注入；远程压缩 v2；session 持久化与 resume 重构；guardian 会话预热复用 |
| **opencode** | 终端 agent（Effect） | **LSP 集成**（9 操作工具 + 启动符号上下文）；git worktree；plan mode；后台任务 promote 前台；快照/undo（独立 git 目录 + alternates 去重）；session 共享/同步事件源 |
| **grok-build** | xAI 终端 agent | nono 沙箱 profile；deterministic workflow journal（seq+req_hash 重放，发散即失败）；turn 边界 rewind 检查点；子代理协调器（并发上限+输出引用）；token budget 强校验 |
| **pi** | 本机 coding agent | 技能发现与按需加载；durable AgentHarness（lane/checkpoint/resume，无程序计数器）；扩展（hooks 后继）事件体系；harness telemetry 词汇表 |
| **hermes-agent** | 通用 agent 框架 | batch runner（多进程+checkpoint+Arrow 轨迹）；cron 调度器；ACP 服务端；MoA 多模型编排；学习图 |
| **kimi-code** | Moonshot 代码 agent | 后台任务：`run_in_background=true` + 压缩后注入 `<background_task_status>`；context memory + compaction handoff 摘要保留 |
| **openworker** | 桌面 coworker | self-wake（sleep/wake_on 挂起恢复）；STT 听写；自动化调度 |
| **mem0** | 记忆中间件 | 8 阶段 add 管线（抽取→embed→去重→实体链接）；实体→记忆关联图；search 的元数据过滤+rerank |
| **ragflow** | RAG 平台 | GraphRAG（实体/关系抽取→Leiden 社区→社区报告）；DeepDoc 文档解析；agent 画布 DSL（loop/iteration 组件） |
| **agent-skills** | 技能集合 | **3 层评估**：结构（CI）→路由（TF-IDF 正负样例 top-k）→行为（headless 执行+grader 判 expectations）；生命周期技能 + 共享 references |
| **superpowers** | 技能集合 | 设计硬门禁（brainstorming 不批准不实现）；TDD 切片式计划（无占位符）；子代理开发（每任务审查轮 + 修复轮上限 + ledger） |
| **ECC** | 工程 companion | 67 个带 frontmatter 的 agent 定义（tools/model 声明）+ Prompt Defense Baseline；dashboard 解析目录 |
| **open-code-review** | PR 评审 bot | 并行子任务评审（token 预算 + manifest resume）；置信度门禁 + 行级证据要求；assurance case |
| **oh-my-openagent** | agent 框架 | 记忆核心（journal/reminders/reflection 状态机）；技能定义（from/template/model/subtask/allowed-tools）；AGENTS.md 注入缓存 |
| **TradingAgents** | 多代理金融分析 | langgraph DAG + 结构化输出的管理者层级（debate→manager→trader→risk→PM）；checkpointing 按 ticker+date resume |

## 4. 差距分析与升级方向

对每项：现状 → 参照 → 价值（对长编程工程任务）→ 工作量 → 优先级。

| # | 方向 | hip 现状 | 参照 | 价值 | 工作量 | 优先级 |
|---|---|---|---|---|---|---|
| G1 | **LSP 语义导航** | 无（仅 grep/read 文本检索） | opencode `lsp/`、`tool/lsp.ts` | 高：语义跳转/引用/符号/诊断，替代长任务中大量 grep→read 轮次，直接降 token 与错误率 | 中 | **P0** |
| G2 | **技能路由与行为评估** | e2e/eval 有任务级场景，无按技能的 trigger 回归 | agent-skills `evals/`（3 层） | 高：hip 技能面大，路由质量决定长任务是否「用对流程」；缺 CI 护栏 | 小-中 | **P0** |
| G3 | **Turn 级可观测性**（TTFT/TTFM、turn profile、每 turn diff） | 有 token-metrics/usage，无延迟分解与变更审计 | codex `turn_timing.rs`、`turn_diff_tracker.rs` | 高：长任务成本归因、卡顿定位、回归审计的前提 | 中 | **P0** |
| G4 | **Elicitation 澄清暂停** | plan-mode 有 AskUserQuestion，但无「turn 内暂停等待用户答复再继续」的协调机制 | codex `elicitation.rs`（引用计数 paused 协调） | 中-高：800 步任务开工前澄清范围，避免方向性返工 | 小 | **P1** |
| G5 | **OS 级沙箱执行** | 仅 permission HITL + network-policy；无进程级强制 | codex `sandboxing/`（seatbelt/bwrap/seccomp）；grok-build `xai-grok-sandbox` | 中-高：无人值守长任务（background/cron/automation）的安全底线 | 大 | **P1** |
| G6 | **后台任务状态注入与 promote** | 有 background-manager；无压缩后状态注入、无 background→前台提升 | kimi-code `taskService.ts`；opencode `background-job.ts` | 中：长任务并行子任务收尾衔接 | 小 | **P1** |
| G7 | **跨代理树 token 预算与提醒注入** | 有 usage 记账与 loop 上限；无跨树预算阈值提醒 | codex `rollout_budget.rs` | 中：长任务成本失控预警 | 小-中 | **P1** |
| G8 | 远程/服务端压缩 | 本地 LLM+token-budget 压缩 | codex `compact_remote_v2.rs` | 中：压缩质量与上下文保留 | 中 | P2（依赖 provider 支持） |
| G9 | 记忆实体图/关系 | 有 FTS+合并进化，无实体图 | mem0 `entity_store`；ragflow GraphRAG light | 中：跨会话主题关联 | 中-大 | P2 |
| G10 | 语音/实时对话 | 无 | codex `realtime_conversation`；openworker `stt/` | 低-中：长任务值守场景 | 大 | P2 |
| G11 | 会话共享/同步、MoA 多模型、GUI 自动化 | 无 | opencode `share/`；hermes `moa_loop.py`；UI-TARS operators | 低 | 大 | P2（不进入本 spec 详设） |

**已覆盖、不升级的项**（避免重复建设）：turn 级回滚（hip shadow checkpoint 已等价 grok-build rewind）；durable 工作流（durable-executor+replay 已等价 grok-build journal 的大部分）；会话恢复（crash-recovery 已有）；AGENTS.md（已有）；guardian（已有）；cron（已有）；worktree 隔离（已有）。

## 5. 方案详情（P0 / P1）

### 5.1 G1 — LSP 语义导航工具（P0）

**目标**：为内置 agent 增加语义级代码查询，将「猜路径 → grep → 读文件」的探索链压缩为一次语义查询。

**设计要点**：

1. 新增 `session/lsp/` 模块：
   - `manager.ts` — 按 服务器×工作区根 惰性拉起一个 LSP client（JSON-RPC over stdio），去重 in-flight spawn，跟踪坏服务器并标记下线（参照 opencode `lsp/launch.ts` 的失败记账）；
   - `server.ts` — 服务器二进制解析：优先用项目内 `node_modules/.bin/` 与 `~/.hip/lsp-servers/`，配置项 `[lsp] servers = { "typescript": { "command": [...], "args": [...] } }`（与 `[mcpServers]` 同构）；
   - `session.ts` — 会话级生命周期：打开时初始化、空闲 N 分钟后 shutdown、关闭时 dispose。
2. 工具面：新增**一个** `lsp` 工具 + 若干 operation（参照 opencode 单工具 9 操作）：
   - `goToDefinition` / `findReferences` / `implementations` / `callHierarchy` / `documentSymbol` / `workspaceSymbol` / `hover` / `diagnostics`（按文件，含 `waitForDiagnostics` 的短超时）；
   - operation 返回统一 markdown 块（路径:行:列 + 签名 + 前 N 行摘录），并受现有 tool-output-store 截断约束。
3. 提示集成：在 system-prompt 的可用工具清单中给出 `lsp` 的「何时用」指引（语义查询 > grep 文本检索）；可选：会话启动时注入顶层 `documentSymbol` 摘要作为符号上下文（受 context-budget 约束，超出预算则不注入）。
4. 权限：`lsp` 只读，走 `read` 权限档（chat 面可用）；不允许 agent 配置/启动任意二进制（`[lsp] servers` 视为项目/用户信任配置，与 MCP 服务器同等级对待）。

**验收标准**：

- 单测：manager 去重/坏服务器标记/超时；operation 参数 schema 校验（复用 tools-skill-params 风格测试）。
- 集成测试（`--lsp` 标记、无 key 也可跑）：对 `fixtures/` 下小型 TS 项目，`findReferences` 返回预期位置；`diagnostics` 对含错误的 fixture 返回非空诊断。
- 长任务评估：在 `e2e/eval/tasks/` 新增 1 个 LSP 场景（如 mini-go 变体「跨包重命名」），断言 agent 在启用 LSP 时「探索 token 消耗 ≤ 关闭时的 60%」或「完成 turn 数下降」，作为 P0 效果的量化证据。

### 5.2 G2 — 技能路由与行为评估（P0）

**目标**：为 hip 的内置/用户技能建立可回归的路由与行为评估，防止「技能越多路由越差」。

**设计要点**：

1. 评估目录约定：`e2e/eval/skills/<skill-name>.json`（参照 agent-skills 的 case schema）：
   - `trigger.positive[]` / `trigger.negative[]`：应/不应路由到该技能的提示样例；
   - `evals[]`：`{ id, prompt, expected_output, files[], expectations[] }`，可带 `kind: execution | dialogue`。
2. 路由评估实现（`e2e/eval/skills-router.test.ts`，免费、无 LLM）：
   - 对内置技能集（`packages/product-content/`）跑描述检索：正样例必须进 top-k、负样例必须不进；两两技能描述相似度 ≥75% 报碰撞错误（CI 拦截）。
   - 检索器直接用 sidecar 现有技能选择逻辑（`session/skills/` 的选择函数），确保测的是「产品逻辑」而非测试副本。
3. 行为评估（可选、付费）：headless 跑技能（复用 `e2e/eval/load-task.ts` + `workspace.ts` 的隔离仓库机制），grader 按 `expectations[]` 判分；纳入 `yarn test:longrun-gate`（与 MSM 同门禁）。
4. 首批覆盖：`planning`、`coding/delegation ops`、`reviewer-gate` 相关技能各 1 个正/负/行为样例；后续每个新内置技能必须带 case 才能合入（写入 CONTRIBUTING 或 product-content 流程）。

**验收标准**：

- `yarn test`（免费路径）新增 `skills-router.test.ts` 通过；CI 对 `product-content` 技能变更自动跑路由评估。
- 行为评估样例在 `yarn test:longrun-gate` 下与现有 MSM 场景同通道通过。
- 新增技能 PR 检查清单含「附 case」。

### 5.3 G3 — Turn 级可观测性（P0）

**目标**：长任务可解释、可归因、可回归。

**设计要点**：

1. `session/turn-timing.ts` 新模块：在 `model-runner.ts` 的调用边界记录每 turn 的 TTFT（首 token 延迟）与 TTFM（末 token 延迟）、采样/压缩/工具阻塞/间隔开销分解（`TurnProfile`），随现有 `loop-events` 与 `usage` 事件流出；SQLite 落库（复用 `db/` 事件表，新增 `turn_timing` 字段或事件类型）。
2. `session/turn-diff-tracker.ts`：每 turn 结束时对工作区做 git diff（与 workspace-git 复用），记录变更文件/行数摘要（100ms 超时，失败降级为无记录）；供「会话时间线」审计与后续「回滚到某 turn」增强。
3. 事件与 UI：`trace-export` 输出中带 per-turn 时序块；CLI `run --json` 的 `HipRunResult` 增补 `turnTiming[]`（向后兼容，新字段可选）。
4. 仪表化目标：`yarn test:longrun-unit` 断言每 turn 至少产生一条时序记录（免费路径用 fake runner 计时）。

**验收标准**：

- 单测：TurnProfile 各段计时正确、diff tracker 对 fixture 仓库产生预期摘要、超时降级。
- `trace.jsonl` 可复现每 turn 的 TTFT/TTFM 与工具耗时 Top 榜（用于长任务成本归因）。
- 不改变现有会话行为（纯观测，开关 `[agentLoop].turnTiming = true` 默认开）。

### 5.4 G4 — Elicitation 澄清暂停（P1）

**目标**：长任务开工与关键分支前，模型可暂停 turn 等待用户回答，而不是「边猜边做 800 步」。

**设计要点**：

1. 在 `session/elicitation.ts` 实现引用计数暂停协调（参照 codex）：
   - 模型调用 `ask_user` 工具（或复用现有 `AskUserQuestion` 的通道）→ 注册 pending elicitation → 该 turn 内后续工具结果投递被挂起；
   - 用户在 UI/CLI 回答（resolve）后恢复投递；注册对象 RAII 化，超时（默认 10 分钟）自动取消并继续。
2. 集成点：`graph.ts` 的 Supervisor 循环在 tool 结果投递前检查 paused 状态；`session-input.ts` 的用户消息处理区分「答复 elicitation」与「新指令」。
3. 触发策略（提示层，不强制）：在 system-prompt 增加「任务边界（第一轮、大规模改动前、发现需求歧义时）优先 ask_user 澄清」的指引；不与现有 plan-mode 冲突（plan-mode 是显式流程，elicitation 是轻量暂停）。

**验收标准**：

- 单测：注册→挂起→解决→恢复；超时自动继续；多 elicitation 并发计数正确。
- 集成测试：fake runner 中模型先 ask_user 再继续，断言工具结果在 resolve 前不投递。
- 长任务评估（可选）：MSM 变体开启引导后「首轮返工次数」下降。

### 5.5 G5 — OS 级沙箱执行（P1）

**目标**：无人值守执行（background/cron/automation、`--hitl auto`）时，权限策略能落到进程级强制，而不是只靠人工确认。

**设计要点**：

1. 新模块 `session/sandbox/`：
   - `policy.ts` — 由现有 permission profile + network-policy 推导沙箱要求（读/写根、只读 carveout、网络放行清单；fail-closed 原则）；
   - `launcher.ts` — 平台适配：macOS `sandbox-exec -p`（seatbelt 策略渲染）、Linux bubblewrap（`--unshare-*` + `--ro-bind`，有 seccomp 网络过滤则加）、Windows 受限 token（参照 codex `sandboxing/src/{manager,seatbelt,bwrap,windows}.rs`）；
   - `violation.ts` — 沙箱拒绝归一化为 `FileSystemSandboxViolation`/`NetworkSandboxViolation`，映射为可恢复的引导消息（「需要读取 X 但沙箱只读 → 请求加白或切换权限档」）。
2. 生效范围与开关：`[sandbox] mode = off | auto | require`（默认 `auto`：仅 background/cron/automation 与 `--hitl auto` 会话强制；交互前台维持现状）；`sandbox-exec` 路径固定防 PATH 注入。
3. 与现有 permission-manager 的关系：沙箱是权限决策的**执行层**——HITL 批准后仍由沙箱兜底；guardian 拒绝→不进入沙箱。

**验收标准**：

- macOS 单测：policy→seatbelt 渲染快照测试（fixture profile → 期望策略文本）。
- 集成测试（macOS CI）：沙箱内 `touch $HOME/x` 被拒绝、`touch 工作区根/x` 被允许；网络被拒时错误归一化。
- 回归：现有 `--hitl auto` 的 CLI 测试在 `[sandbox] mode=require` 下通过。

### 5.6 G6 — 后台任务状态注入与 promote（P1）

**目标**：长任务期间后台子代理的收尾衔接不再「做完了但主代理不知道」。

**设计要点**：

1. 压缩后注入：`background-manager.ts` 记录活动后台任务；每次压缩完成（`compaction.ts` 的 hook 点）后，把「仍在运行的后台任务及其最新状态」注入为新的 user fragment（参照 kimi-code `<background_task_status>` 注入时机——压缩后，因为压缩会清掉模型对后台任务的记忆）。
2. Promote：后台任务完成/失败时，除现有 `completeTask` 事件外，新增「挂起结果」——下一个人工 turn 的 system 注入其摘要；若主循环空闲，可选自动追加一条 `task_batch` 汇总查询。
3. UI 不动（现有后台任务面板已展示状态）。

**验收标准**：

- 单测：压缩 hook 触发注入；注入内容包含任务 id/状态/剩余；完成结果挂起并在下一 turn 注入一次。
- 集成测试：background-subagent.integration 扩展——后台任务完成后主代理在下个 turn 能引用其结果。

### 5.7 G7 — 跨代理树 token 预算与提醒（P1）

**目标**：长任务（含 task_batch 扇形展开）的累计成本可设上限、可预警。

**设计要点**：

1. `session/rollout-budget.ts`：会话级配置 `[agentLoop] rolloutBudgetTokens`（默认不限）；跨主循环 + 全部子代理树加权记账（采样+prefill 权重，参照 codex `rollout_budget.rs`）。
2. 阈值提醒：50%/80%/90% 各注入一次提醒 fragment（per-树去重），内容为「已用/上限/建议收敛策略（停止展开新子任务、改用摘要）」，模型可据此主动收尾。
3. 硬上限：超出 → 主循环强制收尾（复用 `force-plan`/`loop-control` 的收尾路径），后台任务记 `budget_exceeded`。

**验收标准**：

- 单测：加权记账正确；阈值注入只触发一次；硬上限触发收尾。
- 与 G3 的 turn-timing 共用记账数据源（usage 事件），不重复实现 token 统计。

### 5.8 P2 备选（本 spec 只给方向，不做详设）

- **G8 远程压缩**：在 `compaction.ts` 抽一层 `RemoteCompactor` 接口（现无 provider 支持，接口先留空实现=本地回退）。
- **G9 记忆实体图**：在 `memory/pipeline/` 增加 phase3 实体抽取与 `memory/entity-store.ts`（复用现有 LLM 客户端与 FTS 基建）。
- **G10 语音**：参照 openworker STT（whisper.cpp）做听写输入，P2 最低优先级。
- **G11**（共享/同步、MoA、GUI 自动化）：不在本 spec 范围。

## 6. 路线图与分期

| 阶段 | 内容 | 依赖 | 出口判据 |
|---|---|---|---|
| M1（P0） | G1 LSP + G2 技能评估 + G3 观测性 | 无 | 三者的验收标准全部绿；`yarn test:longrun-gate` 不回归 |
| M2（P1） | G4 elicitation + G6 后台注入 + G7 预算 | M1（G3 数据源） | 集成测试绿；MSM 变体（G4 引导）跑通 |
| M3（P1） | G5 沙箱 | M1 | macOS 沙箱验收绿；`--hitl auto` 回归绿 |
| M4（P2） | G8/G9/G10 按需 | M1 | 单项各自验收绿 |

每阶段结束提交（遵循 AGENTS.md §4：分批提交、每阶段可验证）。

## 7. 验收与回归策略

1. **免费路径**：G2 路由评估、G3 单测、G4/G6/G7 单测均无 LLM 依赖，纳入 `yarn test`。
2. **付费门禁**：G1 LSP 场景与 G2 行为样例、MSM 回归纳入 `yarn test:longrun-gate`（`HIP_EVAL_MSM_PATH` 现有机制）。
3. **量化对照**：G1 的「探索 token 下降」、G4 的「首轮返工下降」用 e2e/eval 报告对比启用/关闭效果，写入 `docs/design/msm-dogfood-journal.md` 风格的效果记录。
4. **兼容性**：G3 的 `HipRunResult` 新字段可选、向后兼容；G5 默认 `auto` 不改交互前台行为；G6/G7 默认关闭或阈值默认无限，均不破坏现有会话。

## 8. 风险与开放问题

| 风险/问题 | 说明 | 缓解 |
|---|---|---|
| LSP 服务器生态碎片化（各语言二进制不同） | 维护成本 | 先只内置 TS/JS（typescript-language-server）；其余走 `[lsp] servers` 用户配置；坏服务器记账+下线，不阻塞会话 |
| 沙箱与终端宿主（SSH）冲突 | 远程执行无本地沙箱 | 沙箱仅作用于本地进程启动路径；SSH 终端维持现状并在文档注明 |
| 远程压缩依赖 provider | DeepSeek 等无 compact 端点 | 接口先行、实现后置（P2） |
| 行为评估的 LLM 成本 | longrun 门禁变贵 | 样例保持每个技能 1 条；与 MSM 共用 gate 配额 |
| elicitation 打断体验 | 过度追问烦人 | 触发策略放在提示层 + 超时自动继续，先灰度后推广 |

## 附：调研证据索引

对比仓库机制对应的源码位置（完整清单见 `/tmp/hip-survey/{codex,opencode,pi,memory,skills-proc}.md`，本 spec 随仓库归档时可复制为 `agent-capability-upgrade-research.md` 附件）：

- codex：`codex-rs/sandboxing/src/manager.rs`、`codex-rs/core/src/elicitation.rs`、`turn_timing.rs`、`turn_diff_tracker.rs`、`rollout_budget.rs`、`compact_remote_v2.rs`、`guardian/review_session.rs`
- opencode：`packages/opencode/src/lsp/lsp.ts`、`tool/lsp.ts`、`snapshot/index.ts`、`background/job.ts`、`tool/plan.ts`
- kimi-code：`packages/agent-core-v2/src/agent/task/taskService.ts`
- agent-skills：`evals/cases/<skill>.json`、`scripts/run-evals.js`
- grok-build：`crates/codegen/xai-grok-sandbox/src/lib.rs`、`xai-workflow/src/journal.rs`
- mem0：`mem0/memory/main.py`（`_add_to_vector_store`、`_link_entities_for_memory`）
