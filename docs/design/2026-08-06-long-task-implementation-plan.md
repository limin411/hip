# Plan: 长编程工程任务能力 — 实施计划

| Field | Value |
|-------|-------|
| Status | Implemented (M1–M4 core; M5 ongoing) |
| Date | 2026-08-06 |
| Spec | [2026-08-05-long-engineering-task-spec.md](./2026-08-05-long-engineering-task-spec.md) |
| Dogfood | `make-stock-money` · pack `e2e/eval/tasks/make-stock-money/` |
| References | OpenCode · Grok Build（见 §0） |
| Non-goals | Rust 重写 · Effect 全栈迁移 · 强制 Planner→Coder 默认路径 · UI Work Items 与 Goal 并表 |

---

## 0. 参照与靶场

| 来源 | 路径 | 本计划主要借鉴 |
|------|------|----------------|
| OpenCode | `/Users/lijiamin/data/code-repository/github/opencode` | admit≠execute、`session_input`、steer@boundary、Todo 持久化、tool interrupted 不重放、Context Epoch 语义 |
| Grok Build | `/Users/lijiamin/data/code-repository/github/grok-build` | compaction 保护结构 / full-replace、worktree 隔离、plan verification 段、bg wait 语义 |
| 靶场 | `/Users/lijiamin/data/code-repository/project-rust/make-stock-money` | 真实多文件 Rust 长任务；journal → 改 hip → 同 task 回归 |

**默认产品路径不变**：Supervisor ReAct + `task` / `task_batch`。本计划只加深「可续航 / 可恢复 / 可验证 / 可隔离」。

---

## 1. 成功标准（可验收）

完成 M3 后，在 msm 上满足：

| # | 标准 | 验收方式 |
|---|------|----------|
| S1 | Goal 跨进程仍在，criteria/phases/todos 可恢复 | kill sidecar 后 restore；unit + dogfood |
| S2 | Compact ≥1 次后 criteria 与 open todos 仍在 prompt | `msm-longrun-watchlist` + 强制 compact 测试 |
| S3 | Tool 执行中崩溃 → 标记 interrupted，不重放副作用 | 集成测试 |
| S4 | `goal_complete` 前 verification 失败则拒绝完成 | unit + dogfood |
| S5 | 可选 worktree 隔离并行 task，主树 primary-guard 干净 | `task_batch isolate` + msm dogfood |
| S6 | 桌面可见 goal strip（phase/todo/budget） | UI smoke |

**主回归命令**（贯穿全程）：

```bash
eval "$(scripts/hip-eval-bootstrap-msm.sh)"
yarn dogfood:msm -- --task msm-multi-file-db          # 短
yarn dogfood:msm -- --task msm-longrun-watchlist      # 长（M2+）
# 记问题 → docs/design/msm-dogfood-journal.md
```

---

## 2. 里程碑总览

```
M0 基线冻结（0.5d）
 │
 ▼
M1 Durable Goal + protected compact + interrupt 契约     ← P0  · ~1.5–2w
 │  dogfood: msm-multi-file-db 必过；longrun 试跑记 journal
 ▼
M2 Verification recipe + failure memory + steer boundary ← P0/P1 · ~1w
 │  dogfood: longrun-watchlist verify 闭环
 ▼
M3 Worktree isolation MVP + task_batch isolate           ← P0/P1 · ~1.5w
 │  dogfood: 并行场景 + primary-guard
 ▼
M4 Hunk/path revert MVP + 观测 metrics                   ← P1/P2 · ~1w
 │
 ▼
M5 Session 消肿（并行薄切片）+ longrun e2e gate          ← 持续
```

每个 milestone：**实现 → unit → msm dogfood → journal → 必要时对照 OC/Grok 补洞 → 再进下一 M**。

---

## 3. M0 — 基线冻结（0.5 天）

| 任务 | 产出 |
|------|------|
| M0.1 确认 msm `cargo test` 基线绿 | journal 记 HEAD |
| M0.2 跑通 `yarn dogfood:msm -- --list` 与 unpaid pack load | 已有 `@eval @smoke` |
| M0.3 固定对照阅读清单（只读，不改 hip） | 见下 |

**对照精读（实施时打开）**

| 主题 | OpenCode | Grok |
|------|----------|------|
| Goal/Todo | `packages/opencode/src/session/todo.ts` · `specs/v2/session.md` | plan mode docs · workflow journal |
| Compact | `packages/opencode/src/session/compaction.ts` | `crates/common/xai-grok-compaction` |
| Interrupt | `specs/v2/session.md`（interrupted tools） | agent-lifecycle |
| Worktree | `packages/opencode/src/worktree` | `crates/codegen/xai-fast-worktree` |
| Task/bg | `packages/opencode/src/tool/task.ts` · `background-job.ts` | user-guide `20-background-tasks.md` |

**退出**：团队同意按 M1→M3 顺序；不穿插无关 Session 大重构。

---

## 4. M1 — Durable Goal + Compact 保护 + Crash 契约（P0）

### 4.1 工作项

| ID | 工作 | 主要触点 | 对照 |
|----|------|----------|------|
| **M1.1** | Goal 数据模型扩展：`successCriteria` / `phases` / `todos` / `evidence` / `budget` / `usage` | 新 `goal-types.ts`；扩 `goal.ts` | OC Todo 表字段 |
| **M1.2** | SQLite 持久化：`session_goals`（或 session 旁表）+ load/save on session create/resume | `persistence/store.ts` · schema | OC drizzle Todo |
| **M1.3** | `drive()` 改为结构化 continuation（criteria 勾选、phase、evidence、禁重复失败提示位） | `goal.ts` · turn-runner 注入点 | Grok reminder 块思路 |
| **M1.4** | Tools：`goal_create`（强制 ≥1 criterion）、`goal_update`、`goal_status`、`goal_complete`、`goal_pause/resume` | `tools/goal.ts` · protocol | — |
| **M1.5** | `write_todos` → 写入 active goal 当前 phase（单一真相） | planning tools · graph tool registry | OC todo tool |
| **M1.6** | UI：`goalStore` + strip 展示 description / phase / todo / budget | `src/store/goalStore.ts` · Chat chrome | — |
| **M1.7** | Compaction **protected structures**：goal snapshot + open todos + last verify 摘要强制进 summary seed | `compaction.ts` · `context-budget.ts` | Grok full-replace 保护；OC PRUNE_PROTECT |
| **M1.8** | Crash：投影中 `running` tool → restart 后 `interrupted` 结果，**禁止**自动重放 | event-store / projector / turn-runner | OC V2 session spec |
| **M1.9** | 协议：`goal:updated` 等 | `@hip/protocol` | — |

### 4.2 实现约束

- Goal **每 session 至多一个 active**（与现行为一致）；completed 可保留快照一行。
- 不把 UI Work Items 合并进 Goal 表；仅可选 `links` 预留。
- Compact 算法暂不拆 crate；只加 protect + seed 拼接。
- Steer 默认行为 **M1 不改**（仍 abort）；M2 再加 `boundary`。

### 4.3 测试

| 层 | 内容 |
|----|------|
| Unit | goal CRUD、persist roundtrip、drive 文本含 criteria、budget pause |
| Unit | compact 后 messages 含 protected goal 块 |
| Integration | tool running 时模拟重启 → interrupted |
| Dogfood | `msm-multi-file-db`；手动 longrun 半程 kill 看 goal 是否还在 |

### 4.4 退出标准

- [ ] S1、S2（至少 1 次 compact）、S3 满足  
- [ ] 现有 goal/compaction 单测全绿  
- [ ] journal 至少 1 条 msm 短任务记录  

### 4.5 建议 PR 切片

1. `feat(sidecar): durable goal schema + store`  
2. `feat(sidecar): structured goal drive + tools`  
3. `feat(ui): goal strip from goal:updated`  
4. `feat(sidecar): compaction protects goal/todos`  
5. `fix(sidecar): mark running tools interrupted on resume`  

---

## 5. M2 — Verification + Failure memory + Steer boundary（P0/P1）

### 5.1 工作项

| ID | 工作 | 触点 | 对照 |
|----|------|------|------|
| **M2.1** | `VerificationRecipe`：`{ commands: {id, cmd, cwd?}[] }` 挂在 Goal | goal 模型 · protocol | Grok plan verification section |
| **M2.2** | 项目探测默认 recipe（有 `src-tauri/Cargo.toml` → cargo test；有 package.json → test/type-check） | 小模块 `verification-detect.ts` | — |
| **M2.3** | `verification_run` tool + `goal_complete` 门闩：失败则不可 complete，evidence 写入 | tools · goal | orchestrator `verification-gate` 复用逻辑 |
| **M2.4** | Failure memory：最近 K 次失败命令指纹 → system reminder / drive 注入 | doom-loop 旁路或合并 | Grok 禁空转 |
| **M2.5** | Steer mode：`boundary`（默认新）vs `abort`（兼容）；配置 + protocol | `session-input` · turn-runner · handlers | OC safe provider-turn boundary |
| **M2.6** | msm longrun task metadata 声明 recipe（cargo test）与 pack 对齐 | pack JSON 可选字段或 session 自动探测 | — |

### 5.2 退出标准

- [ ] S4  
- [ ] `msm-longrun-watchlist` CLI dogfood：无 recipe 绿不得 claim complete（agent 侧 tool 拒绝）  
- [ ] steer boundary 单测：tool 批未完不提升 steer  

### 5.3 PR 切片

1. verification recipe + complete gate  
2. failure memory  
3. steer boundary mode  

---

## 6. M3 — Worktree Isolation MVP（P0/P1）

### 6.1 工作项

| ID | 工作 | 触点 | 对照 |
|----|------|------|------|
| **M3.1** | Isolation store：`~/.hip/isolation/<projectHash>/` + git worktree add | 新 `isolation/` 或 `session/isolation.ts` | OC worktree · Grok fast-worktree（MVP 只用 git worktree） |
| **M3.2** | Tools：`isolation_create` / `isolation_discard`；（merge 可二期） | tools | — |
| **M3.3** | `task` / `task_batch` 增加 `isolate?: boolean`；isolate 时子 agent cwd=worktree | subagent · task-runtime | Grok 并行子会话 |
| **M3.4** | 策略默认：explore **不** isolate；coder/background **可** isolate | agent profile | — |
| **M3.5** | GC：session 结束或 TTL；每项目上限 N | isolation GC | Grok auto_gc 思路简化 |
| **M3.6** | UI Tasks 面板显示 worktree path | 右栏 task | — |
| **M3.7** | primary-guard 与现有 eval workspace 一致（主树不动） | 已有 eval；产品路径自测 | msm pack |

### 6.2 明确不做（M3）

- BTRFS / APFS clonefile 加速（可记 follow-up）  
- 自动 merge 回主树（人工 git 或二期）  

### 6.3 退出标准

- [ ] S5  
- [ ] 双 isolate task 改不同文件，discard 后主树干净  
- [ ] msm dogfood 主路径仍默认非 isolate（不拖慢短任务）  

---

## 7. M4 — 回退粒度 + 观测（P1/P2）

| ID | 工作 | 说明 |
|----|------|------|
| **M4.1** | `revert_paths` tool（worktree-only，安全 checkpoint 先拍） | 现有 checkpoint 基础设施 |
| **M4.2** | UI 多选 path revert（hunk 级可只做 diff 解析 MVP） | 对照 Grok hunk-tracker **不**整搬 |
| **M4.3** | Long-run metrics：compact_count、verify_pass、redundant_tool_rate、wall_ms | 写入 dogfood report.json |
| **M4.4** | dogfood report 自动 append journal 草稿行 | 脚本增强 |

退出：S6 已在 M1；M4 补「可回退 + 可量化」。

---

## 8. M5 — 架构消肿 + Gate（持续）

与功能 **并行薄切片**，禁止「大搬家 + 行为变更」同 PR。

| 顺序 | 从 Session 拆出 | 目标 |
|------|-----------------|------|
| 1 | Goal facade（M1 已边界清晰则只收口） | Session 少直接字段 |
| 2 | Isolation | M3 自然模块 |
| 3 | Input drain / steer | 已有 session-input |
| 4 | Turn runner 继续减依赖 | composition root &lt; ~400 LOC 长期目标 |

**E2E gate**

| Gate | 命令 / 标签 |
|------|-------------|
| pack load | `@eval @smoke` matrix（含 msm） |
| msm 短 | `dogfood:msm --task msm-multi-file-db`（CI 可选 nightly live） |
| msm 长 | `dogfood:msm --task msm-longrun-watchlist`（nightly / 手工） |
| 合成 | 后续 `longrun-compact` / `longrun-crash` harness（M2 后补） |

---

## 9. 周历（建议）

| 周 | 内容 | Dogfood |
|----|------|---------|
| W0 | M0 + M1.1–1.2 schema/store | 基线 cargo test |
| W1 | M1.3–1.6 drive/tools/UI | msm-multi-file-db |
| W2 | M1.7–1.9 compact protect + interrupt | kill 恢复试跑；longrun 半程 |
| W3 | M2 verification + failure + steer | longrun-watchlist |
| W4–5 | M3 isolation MVP | 并行 isolate 场景 |
| W6 | M4 revert + metrics；M5 开始拆 | journal 复盘 → backlog |

若人力紧：**W1–3 必须做完（M1+M2）**，M3 可延后但不可删出路线图。

---

## 10. 风险与决策

| 风险 | 决策 |
|------|------|
| Goal 与 plan.md 双源 | plan exit 时 **写入** goal phases；展示以 Goal 为准 |
| Compact 成本 | 保持 `MIN_STEPS_BETWEEN_LLM_COMPACT`；protect 只加文本不另调模型 |
| Isolation 占盘 | 默认 off；上限 + GC |
| Steer 手感变化 | M2 默认 boundary；`abort` 保留 + e2e 覆盖旧行为 |
| Session 大文件回归 | 每 PR 只改一类；msm 短任务作烟测 |
| 对照代码许可 | 只借鉴设计与接口语义，不复制大段专有实现 |

---

## 11. 交付物清单

| 交付物 | 状态 |
|--------|------|
| 分析 Spec | ✅ `2026-08-05-long-engineering-task-spec.md` |
| 本实施 Plan | ✅ 本文 |
| msm eval pack + dogfood 脚本 | ✅ 已落地 |
| msm journal | ✅ `msm-dogfood-journal.md`（持续填） |
| M1–M4 代码 | ✅ Goal 持久化 / verification / isolation / revert_paths / metrics |
| Nightly longrun gate | ⬜ 可选 CI；本地 `yarn dogfood:msm` |

---

## 12. 立刻可执行的第一步（M1.1 开工清单）

1. 在 `packages/sidecar` 增加 `goal-types.ts`（纯类型，无 IO）。  
2. 扩展 `GoalManager`：内存 API 先支持 criteria/phases/todos（单测绿）。  
3. `SessionStore` 增表 + `saveGoal` / `loadGoal`。  
4. Session 构造 / resume 时 hydrate；`goal:updated` 广播。  
5. 跑：`yarn workspace @hip/sidecar test` 相关文件 + `yarn dogfood:msm -- --task msm-fix-priority-order`（确认未回归）。  

**DoD for first PR**：重启 sidecar 后同一 sessionId 的 goal 仍在；tools 可读写 criteria。

---

## 13. 一句话

> 用 **msm 真实长任务** 作闸，按 **Goal 持久化 → 验证门闩 → worktree 隔离** 三刀切开，对照 OpenCode 的会话契约与 Grok 的工程 isolation/compaction 深度，**不改默认 ReAct 产品路径**，每刀可 dogfood、可回滚。
