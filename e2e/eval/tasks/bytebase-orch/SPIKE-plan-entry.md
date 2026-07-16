# Spike: how to enter plan mode from Code surface

**Status:** product path implemented (2026-07-16).

## Product facts

- `PlanApprovalCard` has testids: `plan-approval-card`, `plan-approve`, `plan-reject`, `plan-amend`.
- Product entry (not seed):
  - **Chip** `data-testid="plan-mode-chip"` — toggles `SessionConfig.forcePlan` (draft or session).
  - **Slash** `/plan` [task…] / `/plan-off` — same flag; optional task starts a turn.
  - Protocol: `session:setForcePlan` → echo `session:forcePlan`.
- Sidecar with `forcePlan`: injects system nudge to call `EnterPlanMode`, sets `planningMode: 'plan'`.
- E2E can still seed plan via `__hipE2E.seedPlanApproval` (unpaid harness only — not for live skill scoring of plan *entry*).

## Eval policy

| plan_mode | Runner behavior |
|-----------|-----------------|
| forbid | never click approve; do not enable chip |
| allow | approve if visible |
| prefer | enable plan chip before send; approve if visible; soft note if never seen |
| require | enable plan chip before send; approve if visible; score `plan_skipped` if never approved |

## Current eval approach

- `eval-run` calls `enablePlanModeUi()` when `plan_mode` is prefer/require **before** first prompt (draft forcePlan → session create).
- Auto-click `plan-approve` when `PlanApprovalCard` appears.
- Live task `bb-orch-plan-then-fix` uses `plan_mode: require` + `require_plan_approved`.

## Harness

- `harness-plan-entry.spec.ts` — chip toggles forcePlan (unpaid).
- `harness-plan-approval.spec.ts` — seed card + approve (unpaid).
