# Spike: plan mode entry (Code surface)

**Status:** product path shipped; settle fixes in progress (2026-07-16).

## Product path

| Surface | Behavior |
|---------|----------|
| Chip `plan-mode-chip` | Toggles `SessionConfig.forcePlan` (draft → session create, or live session) |
| Slash `/plan` [task…] | Same flag; optional task starts a turn |
| Slash `/plan-off` | Clears forcePlan |
| Protocol | `session:setForcePlan` → echo `session:forcePlan` |
| Sidecar forcePlan | Auto `planMode.enter()` at turn start + system nudge |
| After approve/reject | forcePlan cleared (one-shot) |
| **respondPlan optimistic** | Clears `planApprovalPending` immediately (card unmounts); approve/amend → `running` |

PlanApprovalCard still only appears after real `plan:published` + `plan_approval` interrupt (or unpaid seed).

## Eval policy

| plan_mode | Runner |
|-----------|--------|
| forbid | no chip; never approve |
| allow | approve if **enabled** button visible |
| prefer | `enablePlanModeUi()` before send; approve enabled only |
| require | chip + `require_plan_approved` |

**Fix:** `approvePlanIfPresent` ignores **disabled** approve buttons (previously counted 18 clicks on a disabled shell).

## Live archive (2026-07-16)

| Run | Result | Notes |
|-----|--------|-------|
| Soft prefer (pre-product) | pass, `planApproved=false` | Agent fixed without card |
| require + soft nudge | `plan_skipped`, verify green | Agent skipped EnterPlanMode |
| require + hard PlanMode | **timeout**, `planApproved=true`, verify green, **`plan_approvals=18`** | Plan+fix OK; settle hung; disabled approve re-clicked. Report `…T07-52-05-b73f6a` |
| require + optimistic dismiss + disabled guard | (re-run) | See post-plan-settle plan |

## Harness (unpaid)

- `harness-plan-entry.spec.ts` — chip + slash
- `harness-plan-approval.spec.ts` — seed card → approve → **card unmounts** (optimistic)
