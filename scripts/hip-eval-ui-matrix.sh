#!/usr/bin/env bash
# Run full capability matrix packs sequentially, then write byAxis cluster.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
: "${HIP_EVAL_BYTEBASE_PATH:?set HIP_EVAL_BYTEBASE_PATH}"
export E2E_LIVE_LLM=1
export HIP_EVAL_BYTEBASE_PATH
export HIP_EVAL_ROOT="${HIP_EVAL_ROOT:-$HOME/.hip/eval-runs}"

echo "[matrix] pilot fix (baseline)"
yarn test:e2e --spec e2e/specs/eval-bytebase-fix-has-prefixes.spec.ts || true

echo "[matrix] hard"
bash scripts/hip-eval-ui-hard.sh || true

echo "[matrix] orch"
bash scripts/hip-eval-ui-orch.sh || true

echo "[matrix] adv"
bash scripts/hip-eval-ui-adv.sh || true

echo "[matrix] cluster"
bash scripts/hip-eval-cluster.sh
