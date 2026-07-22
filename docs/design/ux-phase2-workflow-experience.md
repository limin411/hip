# hip UX Phase 2 — Workflow Experience

| Field | Value |
| --- | --- |
| **Date** | 2026-07-22 |
| **Status** | Implemented (2026-07-22) |
| **Depends on** | Phase 1 `ux-visual-interaction-elevation.md` |
| **Constraints** | No brand hex / shell IA / new product capabilities |

## Goals

1. **2a Composer Tune** — Secondary controls live in a Tune popover; non-default permission/plan/effort chips stay pinned outside.
2. **2b Runtime narrative** — Clearer running phase labels; parallel sub-agent one-line summary.
3. **2c First-run** — No API key → setup card on empty conversation with CTA to Settings → Model.
4. **2d Finish adoption** — Skeleton/EmptyState on history + recycle bin empties.
5. **2e Surface tone** — Minor Chat empty-state rhythm only.

## Non-goals

Hiding primary agent/model/attach; changing e2e testids of pickers; rebrand.

## Done when

- Code InputBar shows `composer-tune`; secondary pickers still have same testids inside popover or pinned.
- Activity running phases use phase keys; parallel summary when ≥2 nested agents.
- First-run card when no keys; opens settings model page.
- History/trash empty use `EmptyState`.
- Unit tests + dialect + tsc green.
