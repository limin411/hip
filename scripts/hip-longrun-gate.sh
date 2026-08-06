#!/usr/bin/env bash
# Unpaid long-run gate (M5): unit harness + msm pack load.
# Live dogfood is opt-in via HIP_LONGRUN_LIVE=1.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "== longrun unit harness =="
yarn vitest run \
  packages/sidecar/src/session/longrun-harness.test.ts \
  packages/sidecar/src/session/goal-types.test.ts \
  packages/sidecar/src/session/isolation.test.ts \
  packages/sidecar/src/session/crash-recovery.test.ts \
  packages/sidecar/src/persistence/schema.test.ts

echo "== msm pack load (no LLM) =="
yarn test:e2e:eval-smoke --spec e2e/specs/eval-matrix-load.spec.ts

if [[ "${HIP_LONGRUN_LIVE:-}" == "1" ]]; then
  echo "== live msm dogfood (paid) =="
  # shellcheck disable=SC1091
  eval "$("$ROOT/scripts/hip-eval-bootstrap-msm.sh")"
  yarn dogfood:msm -- --task msm-multi-file-db
fi

echo "longrun gate OK"
