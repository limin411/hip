# bytebase-orch (L3)

Axes: `plan_flow`, `delegate`, `hitl`.

See `SPIKE-plan-entry.md` for plan entry product path and live archive.

| Task | Live note (2026-07-16) |
|------|------------------------|
| `bb-orch-plan-then-fix` | **pass** + `planApproved=true` (~2m20s) after plan-entry + settle fixes. |
| `bb-orch-hitl-resume` | not run this phase |
| `bb-orch-delegate-explore-fix` | not run this phase |

```bash
export HIP_EVAL_BYTEBASE_PATH=/path/to/bytebase
E2E_LIVE_LLM=1 yarn test:e2e:eval-orch
# or
scripts/hip-eval-ui-orch.sh
```
