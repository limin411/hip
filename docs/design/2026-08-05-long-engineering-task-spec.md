# Spec: 长编程工程任务能力升级

| Field | Value |
|-------|-------|
| Status | Draft |
| Date | 2026-08-05 |
| Scope | hip sidecar runtime + session UX + isolation primitives |
| References | OpenCode (`opencode`), Grok Build (`grok-build`) |
| Non-goals | 重写为 Rust；迁移到 Effect 全栈；复制桌面壳层 UI |

---

## 0. 背景与对比对象

**hip** 是 Tauri 桌面 AI workbench：React UI + Node sidecar + LangGraph Supervisor ReAct。
已有能力面较宽（Goal、TaskRuntime、plan mode、compaction、context-epoch、steer/queue、checkpoint、task_batch、doom-loop、guardian、work-items、memory、orchestrator DAG）。

对照：

| 项目 | 形态 | 长任务相关强项 |
|------|------|----------------|
| **OpenCode** | Bun monorepo + Effect-native Session V2 | 准入/执行分离、durable inbox、Context Epoch 代数、BackgroundJob、Todo DB、Snapshot/Worktree、task 可 resume |
| **Grok Build** | Rust monorepo + TUI/agent | compaction-core（多风格）、fast-worktree（CoW/BTRFS）、prompt-queue combine、hunk-tracker、workflow journal、plan 审批 UX、`/loop`+monitor、agent-lifecycle |

**问题不在「有没有功能名」，而在「多小时、多文件、可中断、可并行、可恢复」工程闭环的深度与边界清晰度。**

---

## 1. 场景定义（成功标准）

长编程工程任务 = 用户给出非平凡目标（例如「给 monorepo 加鉴权 + e2e + 文档」），系统在 **30 分钟～数小时** 内可持续推进，且满足：

1. **目标可驱动**：有明确 success criteria；未完成前不静默停；预算耗尽可暂停/恢复。
2. **上下文可续航**：compaction 后仍保留目标、决策、未完成项、关键路径；不丢 tool-pair。
3. **变更可回退**：按 turn / hunk / checkpoint 撤销；并行实验不污染主 worktree。
4. **执行可中断**：steer / queue / crash 后状态可解释、可恢复；进行中的 tool 不假成功。
5. **并行有隔离**：research / implement / test 可并行，文件冲突可检测。
6. **验证闭环**：写完能跑测试/typecheck；失败有结构化反馈进入下一轮，而非空转。
7. **可观测**：用户能看到 phase、todo、后台任务、diff 归属。

验收：以 `e2e` `@eval @hard` / `@eval @orch` 与新增「4 小时 synthetic long-run」harness 为 gate。

---

## 2. 现状盘点（hip 已有）

### 2.1 已具备且应对齐保留

| 能力 | 位置 | 评价 |
|------|------|------|
| Supervisor ReAct + `task` / `dispatch_agent` / `task_batch` | `session/tools/subagent.ts`, `graph.ts` | 产品默认路径正确 |
| TaskRuntime（shell/agent/monitor/schedule） | `session/task-runtime.ts` | 能力接近 Grok background tasks |
| Plan mode + enter/exit | `plan-mode.ts`, tools | 有；审批 UX 弱于 Grok |
| Goal + auto-continue | `goal.ts` (~118 LOC) | **过浅**（见 §3.1） |
| Compaction + micro-compaction + context-epoch | `compaction.ts`, `context-epoch.ts` | 有骨架；风格单一 |
| Durable input queue (steer/queue) | `session-input.ts`, store | 有；与 OpenCode V2 语义未完全对齐 |
| Turn checkpoint + worktree-only revert | `workspace-git.ts`, `tools/checkpoint.ts` | 有；缺 hunk 级 |
| Doom-loop / guardian / verifyWrites | `doom-loop.ts`, `guardian.ts`, `verify.ts` | 产品向安全网 |
| Event store + projection | `persistence/*` | 双写存在；恢复策略不完整 |
| UI Work Items | `src/domain/work-items` | **产品待办**，与 agent todo/goal **未打通** |
| Orchestrator DAG | `orchestrator/*` | 非默认路径；长任务不应依赖强制 pipeline |

### 2.2 体量信号（维护成本）

- `packages/sidecar/src` 非测试 TS ≈ **51k LOC / 262 files**
- 核心热点：`session-turn-runner.ts` ~1723、`graph.ts` ~1439、`session.ts` ~1318
- `Session` 类同时持有 Goal、TaskRuntime、InputQueue、PlanMode、ContextEpoch、Hooks、MCP… → **演进长任务能力时回归面过大**

---

## 3. 相对 OpenCode / Grok 的主要缺点

### 3.1 Goal 驱动过浅（P0）

**现象**

- `GoalManager` 仅维护单 goal + turn/token budget。
- `drive()` 注入固定句：`Continue working toward your goal: "…"` —— 无 phase、无 success criteria、无证据要求。
- Goal **默认在内存**；与 session event / SQLite 的持久化契约弱。
- 与 `write_todos` / UI Work Items / plan.md **三套状态互不相通**。

**对照**

- OpenCode：`Todo` 表持久化 + 事件；`task` 支持 `task_id` resume 同一子会话。
- Grok：Plan 文件 + 审批评论闭环；workflow journal 可重放步骤。

**影响**：多小时任务容易「空转续跑」或预算到点无成果摘要。

---

### 3.2 缺少并行 Worktree 隔离（P0）

**现象**

- 仅有 checkpoint 恢复；测试明确 **不含** `parallel_worktrees`。
- 子 agent 默认共享 cwd → 并行 `task_batch` 写同一树易冲突。
- 无 worktree pool / CoW / GC。

**对照**

- Grok：`xai-fast-worktree`（`--no-checkout` + 并行 CoW、BTRFS、metadata DB、auto GC）。
- OpenCode：`worktree` create/remove/reset + project startCommand。

**影响**：长任务无法「一边探索一边实现」或「多方案 A/B」而不脏主树。

---

### 3.3 Compaction 深度不足（P0）

**现象**

- 以 keep-recent-turns + 单次 LLM summary 为主；有 degenerate 检测但无 **multi-style** pipeline。
- Token 估计偏 chars 启发式；与真实 provider tokenizer 偏差在长上下文下放大。
- Compaction 与 Goal/Todo/Plan **未作为受保护结构**强制编入 summary seed。
- Context Epoch 有 revision fencing，但 System Context Source 注册表完整度弱于 OpenCode 代数（baseline / mid-conversation update / replace blocked）。

**对照**

- Grok：`xai-grok-compaction` 分离 full-replace / intra / inter；host 无关 core。
- OpenCode：PRUNE_PROTECT（如 skill）、preserve recent token budget、epoch 与 history 投影严格分离。

**影响**：第 N 次 compact 后丢失「还差什么 / 已否决方案 / 失败命令」。

---

### 3.4 Crash / 中断恢复不完整（P0）

**现象**

- 有 crash-recovery 测试与 event dual-write，但缺少 OpenCode 式显式策略：
  - provider 已 dispatch 但结果未知 → retry vs abandon
  - 投影中 `running` 的 tool 在进程重启后必须 **fail 为 interrupted**，禁止静默重放副作用
- Goal auto-continue 与 mid-tool 中断交织时状态机不清晰。
- Steer 语义偏「打断当前 turn」；OpenCode 在 **safe provider-turn boundary** 提升 steer，保护 tool settlement。

**对照**

- OpenCode V2 spec：admit ≠ execute；interrupt 保留 inbox；deferred durable continuation recovery 设计独立切片。
- Grok：agent-lifecycle contributors + workflow journal。

**影响**：长任务最怕的是「重启后半截写文件 / 假成功」。

---

### 3.5 变更粒度停留在 Turn Checkpoint（P1）

**现象**

- Checkpoint = 整树快照级恢复；无 per-hunk accept/reject、无「本 agent 本 turn 改动归属」。
- Diff UI 有，但 agent 侧缺少 structured patch 工具链（OpenCode `apply_patch` 类）。

**对照**

- Grok：`xai-hunk-tracker`（HunkId、line info、actor mutations）。
- OpenCode：Snapshot git-dir + patch/restore/revert API。

**影响**：长任务中用户难以「只回滚坏文件、保留好文件」。

---

### 3.6 验证闭环未产品化（P1）

**现象**

- `verifyWrites` 防幻觉写文件；无 **goal-attached verification recipe**（test/typecheck/lint 命令集）。
- Orchestrator 有 `verification-gate`，但不在默认 ReAct 长任务路径。
- 无「失败输出结构化回流 + 禁止重复同一失败命令 N 次」的统一策略（doom-loop 只覆盖相同 tool batch）。

**对照**

- Grok plan 强制 verification section。
- 工程实践：success criteria = 可执行检查，而非模型自述。

---

### 3.7 架构边界模糊（P1，阻塞后续）

**现象**

- `Session` god-object；turn runner 超大；工具、持久化、编排、UI 协议耦合。
- 无 OpenCode 式 package 边界（Core session runner / Location services / Schema IR）。
- 无 Grok 式 crate 级 compaction/workflow 可复用核心。

**影响**：每加一项长任务能力都在 1.7k 行文件上叠 if。

---

### 3.8 Prompt 队列与后台唤醒（P2）

**现象**

- 有 `SessionInputQueue` + `TurnEnqueuer`；wake buffer 上限 10、简单丢弃最旧。
- 无 Grok `combine-queued-prompts` 合并规则；无用户可见 queue 编辑。
- `/loop` 级 schedule 依赖 TaskRuntime schedule，与会话目标绑定弱。

---

### 3.9 子 agent 契约（P2）

**现象**

- `task` 描述字符串为主；resume 靠 `task_retry(agent_id)`，弱于 OpenCode `task_id` 续同一子会话。
- 无 persona 层（Grok）；固定 agent 有 explore/plan/coder，但 isolation 模式不统一。
- Child maxSteps 默认 25/40 —— 长子任务易被截断且父级不知道「做到哪」。

---

### 3.10 观测与评测（P2）

**现象**

- e2e 丰富，但缺少「合成长任务：compact≥3 次 + crash 1 次 + 并行 subagent」专项 gate。
- 无统一 long-run metrics：wall time、compact count、redundant tool rate、verification pass rate。

---

## 4. 目标架构（逻辑视图）

```
┌─────────────────────────────────────────────────────────────┐
│ UI (React)                                                  │
│  Goal strip · Phase/Todo · Task panel · Diff/Hunk · Queue   │
└───────────────────────────┬─────────────────────────────────┘
                            │ protocol WS
┌───────────────────────────▼─────────────────────────────────┐
│ SessionCoordinator (瘦)                                     │
│  admit input · interrupt · wake · ownership                 │
└───┬─────────────┬───────────────┬─────────────┬─────────────┘
    │             │               │             │
    ▼             ▼               ▼             ▼
 GoalEngine   RunLoop         TaskRuntime   Isolation
 (durable)    (provider       (shell/agent  (worktree
  phases       turns +         monitor/      pool +
  criteria     tools)          schedule)     checkpoint)
    │             │
    ▼             ▼
 Verification   ContextPipeline
 (commands)     (epoch + compact + protect structures)
    │             │
    └──────┬──────┘
           ▼
    Persistence (events · inbox · goal · todos · tasks · isolation meta)
```

原则：

1. **Admit ≠ Execute**（对齐 OpenCode）：inbox 先落库再跑。
2. **Goal 是一等公民**：compact / crash / UI 都读同一 durable 状态。
3. **默认路径仍是 ReAct**；不强制 Planner→Coder pipeline。
4. **隔离默认可选**：research 只读共享树；implement 可申请 worktree。
5. **Surgical**：先抽边界，再加深算法；禁止大爆炸重写。

---

## 5. 改正方案（分阶段）

### Phase A — 语义打底（1–2 周）P0

#### A1. Durable Goal Engine

**数据模型**（SQLite，session 作用域）：

```ts
type GoalRecord = {
  id: string
  sessionId: string
  description: string
  status: 'active' | 'paused' | 'blocked' | 'completed' | 'failed'
  // 结构化，非散文
  successCriteria: string[]          // 人读 + 可映射 verification
  phases: GoalPhase[]                // ordered
  activePhaseId: string | null
  budget: { maxTurns: number; maxTokens: number; maxWallMs?: number }
  usage: { turns: number; tokens: number; wallMs: number }
  evidence: GoalEvidence[]           // 已满足的 criteria 引用
  blockedReason?: string
  createdAt: number
  updatedAt: number
}

type GoalPhase = {
  id: string
  title: string
  status: 'pending' | 'active' | 'done' | 'skipped'
  todos: { id: string; content: string; status: 'pending' | 'in_progress' | 'done' | 'cancelled' }[]
}

type GoalEvidence = {
  criterionIndex: number
  kind: 'command' | 'file' | 'manual'
  ref: string                        // command id / path / note
  at: number
}
```

**行为**

| API / Tool | 行为 |
|------------|------|
| `goal_create` | 要求 description + 至少 1 条 successCriteria；可选 phases |
| `goal_update_phase` / todo 工具 | 写同一 store；发 `goal:updated` |
| `goal_drive`（内部） | 注入 **结构化 continuation**（见下），非一句 Continue |
| budget 耗尽 | `paused` + 用户可见；可 `goal_resume` |
| session 重启 | 从 DB restore；active 则可选 auto-drive（设置项） |

**Continuation prompt 模板（摘要）**

```
## Active goal
{description}
## Success criteria
- [ ] / [x] …
## Current phase + todos
…
## Evidence so far
…
## Constraints
- Do not repeat failed commands from last N turns without change
- Prefer verification commands before claiming done
- Update todos when status changes
```

**打通**

- Agent `write_todos` → 写 GoalPhase.todos（session 内单一真相）。
- UI Work Items：**可选链接** `links.sessionId` + goal id；不强制合并产品模型。

**验收**

- 杀进程重启后 goal 状态一致。
- compact 后 summary 必含 goal 块（A2）。
- e2e：create → 3 turns drive → pause on budget → resume。

#### A2. Compaction 保护结构 + 双路径

1. **Protected structures**（不可被 prune 掉语义）：
   - Active goal snapshot
   - Open todos / phase
   - Last verification results
   - Plan.md 路径与状态（若 plan mode）
2. **Summary seed** 强制拼接 protected JSON/YAML 块。
3. **Overflow recovery path**：provider context error → aggressive compact（已有钩子则收紧阈值）。
4. **Token**：对主 provider 引入 tiktoken/模型官方估算适配层（可先 DeepSeek/OpenAI 兼容）；chars fallback 保留。
5. **微压缩**：工具输出继续进 `ToolOutputStore`；history 只留指针 + 摘要。

**不在 A 做**：完整移植 Grok intra/inter 三引擎（放到 C）。

#### A3. 中断与 Crash 契约

| 状态 | 重启后行为 |
|------|------------|
| inbox pending | restore + 可 drain |
| assistant tool `running` | 标记 `interrupted`，tool result 写入错误，**不重放** |
| goal active | restore；不自动跑危险 tool 直到用户或设置允许 |
| background TaskRuntime | 已有 reconcile；补齐 agent 子会话指针 |

Steer 策略调整（可配置，默认 `boundary`）：

- `boundary`（新默认，对齐 OpenCode）：当前 tool 批结算后再提升 steer。
- `abort`（现行为）：立即 abort，兼容旧测试。

**验收**：集成测试模拟「tool 执行中 kill sidecar」→ 重开后无重复 write。

---

### Phase B — 隔离与并行（2–3 周）P0/P1

#### B1. Worktree Isolation MVP

**API（协议 + tools）**

```ts
// isolation:create
{ name?: string, baseRef?: 'HEAD' | string } -> { worktreeId, path, branch }

// isolation:run  — 在指定 worktree 跑 subagent
{ worktreeId, prompt, agent?: string }

// isolation:merge | isolation:discard
```

**实现策略（务实）**

1. MVP：`git worktree add` + 目录登记在 `~/.hip/isolation/<projectHash>/`。
2. macOS APFS clonefile 可选加速（探测失败则 copy/worktree）。
3. GC：session 结束或 TTL；上限 N 个/项目。
4. **不做** Linux BTRFS 第一期（可后续借鉴 Grok）。

**策略**

- `task_batch` + `isolate: true`（默认 false）时每个 task 独立 worktree。
- explore agent 默认 **不** isolate（只读共享树）。
- coder 后台任务默认 isolate。

**验收**：两 agent 同时改不同文件无互相覆盖；discard 后主树干净。

#### B2. Checkpoint ↔ Isolation

- Turn checkpoint 仍在 **session cwd**（主树或当前 bound tree）。
- Isolation worktree 有独立 checkpoint 链。
- UI：右栏 Tasks 显示 worktree path。

#### B3. Hunk 级回退（可 B 末或 C 初）

- MVP：基于 `git diff` 解析 hunk，UI 多选 revert（不必完整移植 hunk-tracker actor）。
- Agent tool：`revert_paths` / `revert_hunks`（受限权限）。

---

### Phase C — 验证闭环与 Compaction 深化（2 周）P1

#### C1. Verification Recipe

```ts
type VerificationRecipe = {
  commands: { id: string; cmd: string; cwd?: string }[]
  // e.g. yarn test, yarn type-check
}
```

- Goal create / plan exit 时可附着 recipe；缺省从项目探测（package.json scripts）。
- `goal_complete` **前**必须跑 recipe（失败则拒绝 complete，写回 evidence）。
- Orchestrator `verification-gate` 逻辑复用到默认 ReAct 路径的 goal 完成钩子。

#### C2. Failure memory（短窗）

- 最近 K 次失败命令指纹（cmd + exit + stderr hash）。
- System reminder：禁止无修改重复；doom-loop 与此合并计数。

#### C3. Compaction-core 抽取

- 将 `compaction.ts` 纯函数 + policy 抽到 `packages/sidecar/src/session/context/compaction-core/`。
- 增加 **structured full-replace**（goal/todos 块）与 **tail-keep tool-pair safe** select（对齐 Grok `select`）。
- 可选：专用 `compactionModel` 配置项。

---

### Phase D — 架构消肿（持续，与 A–C 并行可做薄切片）P1

#### D1. 拆分 Session

按依赖方向切模块（每次 PR 只搬一类）：

1. `SessionInput` / drain（已有雏形）
2. `SessionGoal` facade
3. `SessionIsolation`
4. `SessionTurn`（runner 已部分抽出）
5. 保留 `Session` 为 composition root < 400 LOC

#### D2. 协议稳定

- 新增消息：`goal:updated`、`isolation:*`、`verification:*` 进 `@hip/protocol`。
- 旧字段兼容一个版本。

#### D3. 明确不做

- 不引入 Effect 全栈重写。
- 不把默认路径改回强制 multi-agent handoff DAG。
- 不把 UI Work Items 与 Goal 强行合成一个表。

---

### Phase E — 评测与观测（穿插）P2

| Gate | 内容 |
|------|------|
| `longrun-compact` | 合成对话强制 ≥3 次 compact，goal criteria 仍在 |
| `longrun-crash` | turn 中 kill，恢复后无双写文件 |
| `longrun-isolate` | 双 worktree 并行 edit |
| `longrun-verify` | 故意红测 → 修复 → recipe 绿 → goal complete |
| Metrics | compact_count, redundant_tool_rate, wall_ms, verify_pass |

---

## 6. 与对照项目的能力映射（落地优先级）

| 能力 | OpenCode | Grok | hip 现状 | 目标 Phase |
|------|----------|------|----------|------------|
| Durable goal/todo | Todo DB | plan+workflow | 浅 Goal | A1 |
| Admit/execute 分离 | Session V2 | lifecycle | 部分 | A3 |
| Steer at boundary | 有 | prompt-queue | abort 为主 | A3 |
| Multi-style compact | prune+epoch | compaction-core | 单路径 | A2→C3 |
| Worktree isolate | 有 | fast-worktree | 无 | B1 |
| Hunk tracking | snapshot | hunk-tracker | turn cp | B3 |
| Background tasks | BackgroundJob | bg+loop+monitor | TaskRuntime | 保持+绑 goal |
| task resume | task_id | subagent session | task_retry | B 加强 |
| Verification | 弱 | plan section | gate 非默认 | C1 |
| God-object 控制 | package 边界 | crates | Session 膨胀 | D1 |

---

## 7. API / 协议草案（摘要）

### 7.1 Client → Server

```ts
// 已有扩展
{ type: 'input:steer', sessionId, content, mode?: 'boundary' | 'abort' }

// 新增
{ type: 'goal:create', sessionId, description, successCriteria, phases?, budget?, recipe? }
{ type: 'goal:resume' | 'goal:pause' | 'goal:complete', sessionId, goalId }
{ type: 'isolation:create' | 'isolation:discard' | 'isolation:merge', sessionId, ... }
{ type: 'verification:run', sessionId, goalId? }
```

### 7.2 Server → Client

```ts
{ type: 'goal:updated', sessionId, goal: GoalRecord | null }
{ type: 'verification:result', sessionId, ok: boolean, results: {...}[] }
{ type: 'isolation:updated', sessionId, worktrees: IsolationInfo[] }
```

### 7.3 Agent tools（增量）

| Tool | 说明 |
|------|------|
| `goal_create` / `goal_status` / `goal_update` / `goal_complete` | 结构化 goal |
| `write_todos` | 绑定 active goal phase |
| `isolation_create` / `isolation_run` | 可选 |
| `verification_run` | 跑 recipe |
| 保留 `task` / `task_batch` / TaskRuntime 工具 | 增加 `isolate?`、`resume_task_id?` |

---

## 8. 风险与缓解

| 风险 | 缓解 |
|------|------|
| Worktree 占磁盘 | 上限 + GC + 默认不 isolate |
| Boundary steer 改手感 | flag + e2e 双模式 |
| Goal 与 plan 重复 | plan mode 产出写入 goal phases；单一展示 |
| Compaction 过贵 | MIN_STEPS 门闸 + 专用小模型 |
| 拆 Session 回归 | 每切片保持现有 vitest；禁止行为改+搬家同 PR |

---

## 9. 里程碑与退出标准

| Milestone | 退出标准 |
|-----------|----------|
| **M1** A1+A2+A3 | 重启保 goal；compact 保 criteria；tool interrupted 不重放 |
| **M2** B1+B2 | 并行 isolate 绿；主树可 discard 干净 |
| **M3** C1+C2 | goal_complete 必须 verification 绿 |
| **M4** D1 初切 + E gates | Session composition root < 400 LOC；longrun e2e 进 CI gate |

**总成功标准（产品）**：在真实仓库完成「跨 1h+、含 compact、可中断、可验证」的功能开发任务，用户无需手动「再发一句 continue」超过每 phase 一次。

---

## 10. 建议实施顺序（工程）

```
Week 1:  A1 Goal schema + tools + UI strip + persist tests
Week 2:  A2 protected compact + A3 interrupt contract + steer mode
Week 3:  B1 git worktree MVP + task_batch isolate flag
Week 4:  B2/B3 checkpoint 联动 + path/hunk revert MVP
Week 5:  C1 verification recipe + C2 failure memory
Week 6:  C3 compaction-core extract + E longrun gates
并行:    D1 每次只搬一个子系统
```

---

## 11. 附录：关键代码锚点（hip）

| 主题 | 路径 |
|------|------|
| Goal | `packages/sidecar/src/session/goal.ts` |
| Goal tools | `packages/sidecar/src/session/tools/goal.ts` |
| TaskRuntime | `packages/sidecar/src/session/task-runtime.ts` |
| Compaction | `packages/sidecar/src/session/compaction.ts` |
| Context epoch | `packages/sidecar/src/session/context-epoch.ts` |
| Input queue | `packages/sidecar/src/session/session-input.ts` |
| Turn runner | `packages/sidecar/src/session/session-turn-runner.ts` |
| Checkpoint | `packages/sidecar/src/session/tools/checkpoint.ts`, `workspace-git.ts` |
| Subagent tools | `packages/sidecar/src/session/tools/subagent.ts` |
| Verification gate | `packages/sidecar/src/orchestrator/verification-gate.ts` |
| UI work items | `src/domain/work-items/*` |
| UI goal store | `src/store/goalStore.ts` |

### 对照锚点

| 主题 | OpenCode | Grok Build |
|------|----------|------------|
| Session V2 | `specs/v2/session.md`, `packages/core/src/session/*` | — |
| Todo | `packages/opencode/src/session/todo.ts` | plan.md + workflow |
| Task/bg | `packages/opencode/src/tool/task.ts`, `packages/core/src/background-job.ts` | user-guide `20-background-tasks.md` |
| Compaction | `packages/opencode/src/session/compaction.ts` | `crates/common/xai-grok-compaction` |
| Worktree | `packages/opencode/src/worktree` | `crates/codegen/xai-fast-worktree` |
| Hunks | snapshot | `crates/codegen/xai-hunk-tracker` |
| Prompt queue | delivery steer/queue | `crates/codegen/xai-prompt-queue` |

---

## 12. 一句话结论

hip **功能清单已接近**桌面 coding-agent 第一梯队，但在长工程任务上输在：  
**（1）Goal 状态机过浅且未持久化闭环，（2）无并行 worktree 隔离，（3）compaction/中断恢复缺少「保护结构 + 不重放副作用」硬契约，（4）验证未挂到 goal 完成条件，（5）Session 单体阻碍安全加深。**  

按 Phase A→E 先补语义与恢复，再补隔离与验证，最后消肿与评测，即可在不重写运行时的前提下逼近 OpenCode 的会话代数与 Grok 的工程 isolation/compaction 深度。

---

## 13. Dogfood 靶场：make-stock-money

真实工程靶场（非玩具 fixture），用于持续发现长任务问题并回写本 spec / 代码。

| 项 | 值 |
|----|-----|
| 仓库 | `/Users/lijiamin/data/code-repository/project-rust/make-stock-money` |
| Env | `HIP_EVAL_MSM_PATH`（`eval "$(scripts/hip-eval-bootstrap-msm.sh)"`） |
| Eval pack | `e2e/eval/tasks/make-stock-money/` |
| 场景文案 | `e2e/eval/tasks/make-stock-money/scenarios/*.md` |
| 问题日志 | `docs/design/msm-dogfood-journal.md` |
| 靶场 AGENTS | 靶场仓库根 `AGENTS.md` |

### 怎么跑

```bash
eval "$(scripts/hip-eval-bootstrap-msm.sh)"

# 1) 无钱：pack 加载 smoke
yarn test:e2e:eval-smoke --spec e2e/specs/eval-matrix-load.spec.ts

# 2) 桌面自由开发（推荐日常）
yarn tauri dev   # hip
# Code 会话绑定 $HIP_EVAL_MSM_PATH，粘贴 scenarios/*.md

# 3) CLI 隔离 worktree + hip run + cargo test
yarn dogfood:msm -- --list
yarn dogfood:msm -- --task msm-multi-file-db
yarn dogfood:msm -- --scenario watchlist
E2E_EVAL_KEEP_WORKSPACE=1 yarn dogfood:msm -- --task msm-longrun-watchlist

# 4) Live UI eval
yarn test:e2e:eval-msm
yarn test:e2e:eval-msm-longrun
```

### 任务梯度

| Task | 用途 |
|------|------|
| `msm-fix-*` | 冒烟：单点修复 + verify |
| `msm-multi-file-db` | 多 bug + TDD 环 |
| `msm-add-kind-filter` | 加 API + 测试 |
| `msm-longrun-watchlist` | **主长任务**：迁移/模块/命令/测试/文档 |

发现问题 → 记 journal → 改 hip → 用同一 task 回归。
