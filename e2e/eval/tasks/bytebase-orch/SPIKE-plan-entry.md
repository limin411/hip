# Spike: plan mode entry (Code surface)

**Status:** product path shipped (2026-07-16); live execute settle still flaky.

## Product path

| Surface | Behavior |
|---------|----------|
| Chip `plan-mode-chip` | Toggles `SessionConfig.forcePlan` (draft → session create, or live session) |
| Slash `/plan` [task…] | Same flag; optional task starts a turn |
| Slash `/plan-off` | Clears forcePlan |
| Protocol | `session:setForcePlan` → echo `session:forcePlan` |
| Sidecar forcePlan | Auto `planMode.enter()` at turn start (hard block writes outside plan file) + system nudge |
| After approve/reject | forcePlan cleared (one-shot) so execute turn is not re-gated |

PlanApprovalCard still only appears after real `plan:published` + `plan_approval` interrupt (or unpaid `__hipE2E.seedPlanApproval`).

## Eval policy

| plan_mode | Runner |
|-----------|--------|
| forbid | no chip; never approve |
| allow | approve if visible |
| prefer | `enablePlanModeUi()` before send; approve if visible |
| require | chip + `require_plan_approved`; `plan_skipped` if never approved |

## Live archive (2026-07-16)

| Run | Result | Notes |
|-----|--------|-------|
| Soft (prefer, pre-forcePlan product) | pass, `planApproved=false` | Agent fixed without card |
| require + chip only (soft nudge) | `plan_skipped`, verify green | Agent ignored EnterPlanMode, edited util.go directly |
| require + hard `planMode.enter` | **partial** | Plan produced, **approved**, steps completed, `HasPrefixes` fixed; then UI stuck `composer-stop` (~22m) until killed. No `run-report.json` (settle never finished). Worktree: `bb-orch-plan-then-fix-2026-07-16T07-52-05-b73f6a` |

### Known gap: post-approve settle hang

After plan approve + successful fix, product stayed `status=running` / `stopVisible=true` with no interrupt. Eval `waitForTurnSettle` cannot finish → timeout or manual kill.

**Follow-up:** diagnose why execute turn after `handlePlanResponse(approve)` does not emit terminal complete (or UI never leaves running). forcePlan is now cleared on approve to reduce re-entry risk.

## Harness (unpaid)

- `harness-plan-entry.spec.ts` — chip + slash (pass)
- `harness-plan-approval.spec.ts` — seed card + approve (pass)
