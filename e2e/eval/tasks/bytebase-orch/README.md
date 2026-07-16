# bytebase-orch (L3)

Axes: `plan_flow`, `delegate`, `hitl`.

See `SPIKE-plan-entry.md` for plan entry product path.

## Live archive (2026-07-16)

| Task | Result | Notes |
|------|--------|-------|
| `bb-orch-plan-then-fix` | **pass** + `planApproved=true` (~2m20s) | forcePlan chip + hard PlanMode + settle fixes |
| `bb-orch-hitl-resume` | **pass** (~53s) | `interruptResumes=0` (agent fixed without asking); Continue path still product-tested in harness |
| `bb-orch-delegate-explore-fix` | **pass** (~2m10s) | verify green; delegate not hard-required |

```bash
export HIP_EVAL_BYTEBASE_PATH=/path/to/bytebase
E2E_LIVE_LLM=1 yarn test:e2e:eval-orch
# or
scripts/hip-eval-ui-orch.sh
```
