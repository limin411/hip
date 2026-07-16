#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# shellcheck disable=SC1090
eval "$("$ROOT/scripts/hip-eval-bootstrap-mini-go.sh")"
export E2E_LIVE_LLM=1
export HIP_EVAL_MINI_GO_PATH
yarn test:e2e --spec e2e/specs/eval-mini-fix-greet.spec.ts
