#!/usr/bin/env bash
# Live UI eval for make-stock-money pack (opt-in paid LLM).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# shellcheck disable=SC1091
eval "$("$ROOT/scripts/hip-eval-bootstrap-msm.sh")"

export E2E_LIVE_LLM=1
export E2E_GREP="${E2E_GREP:-@eval @msm}"

echo "HIP_EVAL_MSM_PATH=$HIP_EVAL_MSM_PATH" >&2
exec yarn test:e2e --spec \
  e2e/specs/eval-msm-fix-priority.spec.ts \
  e2e/specs/eval-msm-multi-file.spec.ts \
  e2e/specs/eval-msm-add-kind-filter.spec.ts \
  e2e/specs/eval-msm-longrun-watchlist.spec.ts
