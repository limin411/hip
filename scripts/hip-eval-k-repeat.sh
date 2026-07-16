#!/usr/bin/env bash
# Run one live e2e spec K times and write pass-rate summary (Phase E2).
# Usage:
#   HIP_EVAL_BYTEBASE_PATH=... scripts/hip-eval-k-repeat.sh e2e/specs/eval-orch-hitl.spec.ts 3
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
SPEC="${1:?spec path e.g. e2e/specs/eval-orch-hitl.spec.ts}"
K="${2:-3}"
export E2E_LIVE_LLM=1
EVAL_ROOT="${HIP_EVAL_ROOT:-$HOME/.hip/eval-runs}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="${HIP_EVAL_K_OUT:-$EVAL_ROOT/k-repeat-$STAMP}"
mkdir -p "${OUT_DIR}"

pass=0
fail=0
for i in $(seq 1 "${K}"); do
  echo "[k-repeat] run ${i}/${K} ${SPEC}"
  log="${OUT_DIR}/run-${i}.log"
  if yarn test:e2e --spec "${SPEC}" >"${log}" 2>&1; then
    pass=$((pass + 1))
    echo "[k-repeat] ${i}: PASS"
  else
    fail=$((fail + 1))
    echo "[k-repeat] ${i}: FAIL (see ${log})"
  fi
done

node -e "
const fs = require('fs');
const o = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  spec: process.argv[1],
  k: Number(process.argv[2]),
  pass: Number(process.argv[3]),
  fail: Number(process.argv[4]),
  passRate: Number(process.argv[2]) ? Number(process.argv[3]) / Number(process.argv[2]) : 0,
  outDir: process.argv[5],
};
fs.writeFileSync(process.argv[5] + '/summary.json', JSON.stringify(o, null, 2));
console.log('[k-repeat] wrote', process.argv[5] + '/summary.json');
console.log('[k-repeat] passRate', o.pass + '/' + o.k, '(' + (100 * o.passRate).toFixed(0) + '%)');
" "${SPEC}" "${K}" "${pass}" "${fail}" "${OUT_DIR}"

bash scripts/hip-eval-cluster.sh || true

if [ "${fail}" -gt 0 ]; then
  exit 1
fi
