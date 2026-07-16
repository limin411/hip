# bytebase-orch (L3)

Axes: `plan_flow`, `delegate`, `hitl`.

See `SPIKE-plan-entry.md` for plan entry product path and live archive.

| Task | Live note (2026-07-16) |
|------|------------------------|
| `bb-orch-plan-then-fix` | forcePlan chip + hard PlanMode enter: plan approved + fix landed; **settle hung** after execute (killed). Scoring require may still `plan_skipped` if card never auto-approved in time. |
| `bb-orch-hitl-resume` | not run this phase |
| `bb-orch-delegate-explore-fix` | not run this phase |

```bash
export HIP_EVAL_BYTEBASE_PATH=/path/to/bytebase
E2E_LIVE_LLM=1 yarn test:e2e:eval-orch
# or
scripts/hip-eval-ui-orch.sh
```
