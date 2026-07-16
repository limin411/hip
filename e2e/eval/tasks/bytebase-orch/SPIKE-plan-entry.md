# Spike: how to enter plan mode from Code surface

**Status:** best-effort for eval.

## Product facts

- `PlanApprovalCard` has testids: `plan-approval-card`, `plan-approve`, `plan-reject`, `plan-amend`.
- E2E can seed plan via `__hipE2E.seedPlanApproval` (unpaid harness only — not for live skill scoring of plan *entry*).
- Live eval for `plan_mode: require` **approves** when the card appears; it does **not** force the agent into plan mode if the product does not surface it.

## Eval policy

| plan_mode | Runner behavior |
|-----------|-----------------|
| forbid | never click approve |
| allow | approve if visible |
| prefer | approve if visible; soft note if never seen |
| require | approve if visible; score `plan_skipped` if never approved |

## Current eval approach (2026-07-16)

- Prompt tasks to call agent tool `enter_plan_mode` so PlanApprovalCard can appear.
- Runner uses `plan_mode: prefer` + auto-click `plan-approve` when visible.
- Hard gate remains verify green; `planApproved` is reported for axis portrait.

## Live result (2026-07-16)

| Task | Score | planApproved | Notes |
|------|-------|--------------|-------|
| `bb-orch-plan-then-fix` | **pass** (~41s) | **false** | Agent fixed `HasPrefixes` and verify green without ever showing `PlanApprovalCard`. Prompt + tool request alone is insufficient for plan *entry* scoring. |

Report: `~/.hip/eval-runs/bb-orch-plan-then-fix-2026-07-16T07-28-20-fd50a7`

## Future

- Product slash / chip to enter plan mode without relying on the model tool.
- Optional `plan_mode: require` once UI entry is reliable.
