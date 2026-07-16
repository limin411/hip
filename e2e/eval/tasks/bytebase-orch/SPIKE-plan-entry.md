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

## Future

- Product slash / chip to enter plan mode → wire `prefer` to click it before first send.
