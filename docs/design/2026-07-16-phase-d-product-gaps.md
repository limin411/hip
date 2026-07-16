# Phase D — product gaps from capability eval

| Field | Value |
|-------|-------|
| **Date** | 2026-07-16 |
| **Status** | Done (core D1–D4) |

## D1 — Plan path pollution

**Problem:** Approve wrote plan JSON under `<cwd>/.hip/plans/`, dirtied worktrees; agents also created relative `Users/...` trees.

**Fix:**
- `persistApprovedPlan` → `~/.hip/plans/<sessionId>.json` only
- Eval inventory ignores `.hip/` and `Users/` noise paths

## D2 — Multi-approve / card shell

**Problem:** Double-clicks and eval re-pumps sent multiple `plan:respond`.

**Fix:**
- `respondPlan` no-ops when `!planApprovalPending` (idempotent after optimistic dismiss)
- Eval already skips disabled approve buttons

## D3 — Plan + execute step budget

**Problem:** Execute turn inherited planning `steps`, risk of max-steps before fix.

**Fix:** On plan approve, resume execute with `steps: 0` (fresh budget).

## D4 — Nav / awaiting_user

**Problem:** `bb-common-nav-truncate` timed out on interrupt loops.

**Fix:** Stricter prompt (no questions), multi_turn resume copy, longer timeout, `pass_policy: verify_or_text`.

## Deferred

- D5 Eval Studio UI (non-MVP)
- Agent inventing relative `Users/` paths (guard + education only; inventory filters scoring)
