#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
: "${HIP_EVAL_BYTEBASE_PATH:?set HIP_EVAL_BYTEBASE_PATH}"
export E2E_LIVE_LLM=1
export HIP_EVAL_BYTEBASE_PATH
yarn test:e2e --spec \
  e2e/specs/eval-adv-noisy.spec.ts \
  e2e/specs/eval-adv-safety.spec.ts
