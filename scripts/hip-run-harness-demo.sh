#!/usr/bin/env bash
# P0 harness acceptance demo (design §G).
# Usage: from monorepo root:
#   scripts/hip-run-harness-demo.sh
# Optional: OUT_DIR=/tmp/hip-demo PROMPT='...' scripts/hip-run-harness-demo.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT_DIR="${OUT_DIR:-/tmp/hip-out}"
PROMPT="${PROMPT:-Reply with exactly: pong}"
mkdir -p "${OUT_DIR}"

export HIP_AUTH_PATH="${HIP_AUTH_PATH:-$HOME/.hip/config/auth.json}"

echo "[demo] HIP_AUTH_PATH=${HIP_AUTH_PATH}"
echo "[demo] OUT_DIR=${OUT_DIR}"
echo "[demo] running hip run --preset harness …"

set +e
yarn cli:dev run \
  --preset harness \
  --stream none \
  --json \
  --output "${OUT_DIR}/result.json" \
  --out-dir "${OUT_DIR}" \
  --timeout 90 \
  "${PROMPT}"
code=$?
set -e

echo "[demo] exit=${code}"
if [[ -f "${OUT_DIR}/result.json" ]]; then
  echo "[demo] result.json:"
  if command -v jq >/dev/null 2>&1; then
    jq '{status, exitCode, text, errors, git, artifacts, hasApiKeyAtReady}' "${OUT_DIR}/result.json"
  else
    head -c 500 "${OUT_DIR}/result.json"
    echo
  fi
else
  echo "[demo] WARN: no result.json written"
fi

# Acceptance:
# - with key: exit 0 and status ok (for the pong prompt)
# - without key: exit 1 and NO_API_KEY_AT_READY
if [[ ! -f "${OUT_DIR}/result.json" ]]; then
  exit 3
fi

status="$(python3 -c "import json; print(json.load(open('${OUT_DIR}/result.json'))['status'])" 2>/dev/null || echo unknown)"
if [[ "${code}" -eq 0 && "${status}" == "ok" ]]; then
  echo "[demo] PASS (ok)"
  exit 0
fi
if [[ "${code}" -eq 1 && "${status}" == "error" ]]; then
  err="$(python3 -c "import json; e=json.load(open('${OUT_DIR}/result.json')).get('errors') or []; print(e[0]['code'] if e else '')" 2>/dev/null || true)"
  if [[ "${err}" == "NO_API_KEY_AT_READY" ]]; then
    echo "[demo] PASS (no key preflight as designed)"
    exit 0
  fi
fi

echo "[demo] FAIL status=${status} exit=${code}"
exit "${code}"
