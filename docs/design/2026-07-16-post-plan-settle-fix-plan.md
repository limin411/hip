# Plan: Fix post-plan settle hang (eval timeout with planApproved)

| Field | Value |
|-------|-------|
| **Date** | 2026-07-16 |
| **Status** | Done — live pass with planApproved (2026-07-16) |
| **Trigger** | Live `bb-orch-plan-then-fix` (hard PlanMode): `planApproved=true`, verify green, score `timeout` (~25m) |
| **Parent** | N1 plan entry product path (shipped) |

---

## §0 一页纸（1 分钟）

```text
现象: plan 审批成功 + 代码修好 + go test 绿，但 UI 一直 composer-stop → eval settle 超时
证据: plan_approvals=18, planApproved=true, verifyPassed=true, settled=false
根因候选:
  A. Eval 对已 disabled 的 plan-approve 重复 click 并计数（确定 bug）
  B. 产品 approve 后 planApprovalPending 不乐观清除 → 卡仍挂着整段执行
  C. 执行 turn 未可靠发出 message:complete / status 卡在 running（待验）
  D. forcePlan 在 approve 后仍生效（已修 clearForcePlan，需回归）

原则: 先修确定 bug + 乐观 UI，再 harness 闭环，再短 live 验证；不空等 25m。
```

---

## §1 证据（来自 live report）

Run: `~/.hip/eval-runs/bb-orch-plan-then-fix-2026-07-16T07-52-05-b73f6a`

| 字段 | 值 | 含义 |
|------|-----|------|
| `planApproved` | true | Plan 入口 + 审批闭环已通 |
| `plan_approvals` | **18** | 审批卡在 DOM 中被反复 click |
| `verifyPassed` | true | 代码正确 |
| `settled` / `timedOut` | false / true | settle 从未 idle |
| `durationMs` | ~1.51e6 | 打满 task timeout |
| assistant | 含 fix summary | 执行侧基本完成 |
| paths | util.go + `.hip/plans` + 错误 `Users/...` | 计划文件路径污染（次要） |

**Eval 确定 bug：** `approvePlanIfPresent` 只要找到 `#plan-approve` 就 `click` 并 `return true`，**不检查 disabled**。`PlanApprovalCard` 点击后本地 `responded` 只是 disable 按钮、**不卸载**。settle `onTick` 每 ~500ms 调一次 → 18 次 “审批”。Sidecar 在 `!awaitingResume` 时 no-op，故不致重入；但说明 **审批 UI 在整段执行期间仍挂着**，且 eval 误判。

**产品缺口：** `respondPlan` 只发 WS，**不乐观** `planApprovalPending=false` / `status='running'`。卡依赖执行结束的 `message:complete` 才卸掉 → 用户与 eval 在执行期仍见审批壳。

**执行 hang：** 日志长时间 `stopVisible:true, streaming:false, interruptOpen:false`。若 `message:complete` 已到，store 应 `status=idle`。更像 **running 未清** 或 complete 丢失/未发出。clearForcePlan 在该 live **之后** 合入，回归时需再验。

---

## §2 目标与非目标

### 目标（本阶段）

1. Eval 只对 **可点** 的 approve 点一次；不再刷 18 次。
2. 产品 approve/reject 后 **立刻** 卸审批卡，并进入 running（与 Continue 体验一致）。
3. Harness：**plan entry → seed 或真路径 → approve → status idle** 的 unpaid 闭环（不依赖 25m live）。
4. 短 live（或带日志的一次 live）确认：`planApproved` + `settled` + verify，**timeout 不再作为常态**。
5. 更新 SPIKE 归档最终 `timeout + planApproved true` 结论。

### 非目标

- 不重做 hard pack 矩阵
- 不扩大 plan 语义（不改 PlanItem schema）
- 不修 worktree 下 `Users/...` 路径污染（可记 follow-up）
- 不把 live 塞进 CI gate

---

## §3 实施步骤（渐进）

### P0 — Eval 热修（小、确定）

**文件：** `e2e/helpers/eval-plan.ts`

- `approvePlanIfPresent`：仅当按钮存在且 **未 disabled** 时 click；否则 false。
- `pumpPlanApprovals`：可选，若 card 仍在但按钮 disabled，视为 “已响应、不再点”。
- 单测：若有 pure 逻辑可提；否则 harness 覆盖。

**验收：** 本地 mock/DOM 或 harness 中 disable 后不再增加 clicks。

### P1 — 产品乐观状态（中、高 ROI）

**文件：**  
- `src/domain/sessionService.ts` — `respondPlan`  
- `src/domain/sessionStore.ts` — 若需 `apply` 乐观 action  
- 单元：`sessionService.test.ts` / `sessionStore.test.ts`

行为：

| action | 乐观更新 |
|--------|----------|
| approve | `planApprovalPending=false`；`interrupt=null`（或仅 plan 上下文）；`status='running'` |
| reject | `planApprovalPending=false`；`interrupt=null`；`status='idle'`；可保留 error 由 sidecar `PLAN_REJECTED` 覆盖 |
| amend | `planApprovalPending=false`；`status='running'` |

Sidecar 真完成时 `message:complete` 仍权威覆盖。

**验收：** 单元 + `harness-plan-approval`：approve 后卡消失（不依赖 sidecar 再 complete 才卸卡）。

### P2 — 执行 turn 完成可靠性（中，按需加深）

仅当 P0+P1 后 harness/短 live 仍 `status=running` 卡住时深入：

1. 对照 sidecar：`handlePlanResponse(approve)` → `runTurn` 是否总是 `finally { running=false }` + `message:complete`。
2. 检查 Stop hook / goal drive 是否在 plan 执行后二次 `runTurn` 挂死。
3. 若 complete 已发而 UI 仍 running：查 store  reducer / 会话 id 错配。
4. 已合入的 `clearForcePlanFlag`：确认 approve 路径在执行 turn 前 forcePlan=false。

**文件（可能）：**  
`session-turn-ops.ts`、`session-turn-runner.ts`、相关测试。

### P3 — 闭环验证（必做）

| 层级 | 内容 | 时长预算 |
|------|------|----------|
| Unit | store/service + eval helper | <1m |
| Harness unpaid | `harness-plan-entry` + `harness-plan-approval`；必要时新 spec：approve 后卡卸 + status | <2m |
| Live | 单条 `eval-orch-plan`，**有结果即停**（不空等）；目标 `pass` 或明确 tags | 限时观察，超时杀 |

### P4 — 文档

- `SPIKE-plan-entry.md`：最终 live 行改为 `timeout + planApproved true + plan_approvals=18`；记 P0/P1 修复。
- 本 plan 状态 → Done。

---

## §4 风险与取舍

| 风险 | 缓解 |
|------|------|
| 乐观 running 后 sidecar reject/fail | error/complete 覆盖 status |
| 仅修 eval 不修产品 | 用户仍见审批壳；P1 必做 |
| 执行 hang 是模型/工具死循环 | idle watchdog 应杀；若 kick 过勤，另开 issue |
| 再跑 25m live | 禁止空等；预算到点 kill + 归档 |

---

## §5 验收标准

1. `approvePlanIfPresent` 对 disabled 按钮返回 false（代码 + harness）。  
2. 产品 approve 后 **立即** 无 `plan-approval-card`（harness）。  
3. Live 或 unpaid 等价路径：不再出现 `plan_approvals` ≫ 1。  
4. 理想：`bb-orch-plan-then-fix` → `tags:['pass']`；至少不再因 “卡挂着+重复点” 导致假 timeout。  
5. 工作树 clean commit；不 push 除非要求。

---

## §6 建议默认执行顺序

```text
P0 eval disabled-guard  →  P1 乐观 respondPlan  →  unit+harness
  →  若仍 hang: P2  →  限时 live  →  P4 文档
```

**默认不并行开 live。**  
实现前本 plan 需确认；确认后按 P0→P1→验收 开干。
