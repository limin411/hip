# Spike: plan mode entry (Code surface)

**Status:** closed-loop green (2026-07-16).

## Product path

| Surface | Behavior |
|---------|----------|
| Chip `plan-mode-chip` | Toggles `SessionConfig.forcePlan` (draft → session create, or live session) |
| Slash `/plan` [task…] | Same flag; optional task starts a turn |
| Slash `/plan-off` | Clears forcePlan |
| Protocol | `session:setForcePlan` → echo `session:forcePlan` |
| Sidecar forcePlan | Auto `planMode.enter()` at turn start + system nudge |
| After approve/reject | forcePlan cleared (one-shot) |
| `respondPlan` optimistic | Clears `planApprovalPending` immediately; approve/amend → `running` |

## Eval policy

| plan_mode | Runner |
|-----------|--------|
| forbid | no chip; never approve |
| allow / prefer / require | `enablePlanModeUi()` when prefer/require; click **enabled** plan-approve only |
| require | `require_plan_approved` |

Settle busy only if plan-approve is **enabled** (disabled shell does not block idle).

## Live archive (2026-07-16)

| Run | Result | Notes |
|-----|--------|-------|
| Soft prefer (pre-product) | pass, `planApproved=false` | Agent fixed without card |
| require + soft nudge | `plan_skipped` | Agent skipped EnterPlanMode |
| require + hard PlanMode | timeout, `planApproved=true`, `plan_approvals=18` | Disabled re-click hang |
| require + optimistic dismiss | 56s settled, `planApproved=true`, verify_failed | Max-steps before fix |
| require + settle busy fix | **pass**, `planApproved=true` (~2m20s) | Report under `~/.hip/eval-runs/bb-orch-plan-then-fix-2026-07-16T08-55-*` |

## Harness (unpaid)

- `harness-plan-entry.spec.ts` — chip + slash
- `harness-plan-approval.spec.ts` — seed → approve → card unmounts
