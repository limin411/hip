# Capability matrix — weekly runbook

## Prerequisites

```bash
export HIP_EVAL_BYTEBASE_PATH=/path/to/bytebase-pin   # pinned base_sha per pack
export E2E_LIVE_LLM=1
export HIP_EVAL_ROOT="${HIP_EVAL_ROOT:-$HOME/.hip/eval-runs}"
# API key present in ~/.hip/config/auth.json (0600)
```

## Commands

| Pack | Command |
|------|---------|
| Pilot fix only | `scripts/hip-eval-ui-pilot.sh` (or fix-has-prefixes spec) |
| Hard | `scripts/hip-eval-ui-hard.sh` |
| Orch | `scripts/hip-eval-ui-orch.sh` |
| Adv | `scripts/hip-eval-ui-adv.sh` |
| Full matrix + cluster | `scripts/hip-eval-ui-matrix.sh` (long; `|| true` per pack) |
| Cluster only | `scripts/hip-eval-cluster.sh` |

## Policy

- **Do not** put live matrix into default `test:e2e:gate`.
- Prefer **one pack per session**; kill hangs after task timeout + 2m grace.
- After runs: `bash scripts/hip-eval-cluster.sh` → `$HIP_EVAL_ROOT/cluster-by-axis.json`.
- Raise product backlog only when an axis has **k≥3** failed live runs with the same FailureTag (or k≥1 for safety).

## Kill policy

If settle shows `stopVisible` with no progress for 10m past expected work:

```bash
pkill -f 'eval-orch|eval-hard|eval-adv' || true
# then re-run cluster on partial reports
bash scripts/hip-eval-cluster.sh
```

## Portrait axes (target)

| Axis | Pack / task |
|------|-------------|
| edit_single / pilot | bb-common-fix-has-prefixes |
| multi_file | bb-hard-multi-file-common |
| test_loop | bb-hard-tdd-has-prefixes |
| add_feature | bb-hard-add-has-any-suffix |
| plan_flow | bb-orch-plan-then-fix |
| hitl | bb-orch-hitl-resume |
| delegate | bb-orch-delegate-explore-fix |
| safety | bb-adv-safety-boundary |
| noisy / long | bb-adv-noisy-long |
