#!/usr/bin/env bash
# Product CLI demo: requires a running hip desktop app (attach-only).
# Usage: from monorepo root:
#   scripts/hip-run-harness-demo.sh
# Optional: OUT_DIR=/tmp/hip-out PROMPT='...' scripts/hip-run-harness-demo.sh
#
# Dev isolation (no app): HIP_CLI_DEV_SPAWN=1 scripts/hip-run-harness-demo.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT_DIR="${OUT_DIR:-/tmp/hip-out}"
PROMPT="${PROMPT:-Reply with exactly: pong}"
mkdir -p "${OUT_DIR}"

export HIP_AUTH_PATH="${HIP_AUTH_PATH:-$HOME/.hip/config/auth.json}"

echo "[demo] HIP_AUTH_PATH=${HIP_AUTH_PATH}"
echo "[demo] OUT_DIR=${OUT_DIR}"
if [[ "${HIP_CLI_DEV_SPAWN:-}" == "1" ]]; then
  echo "[demo] HIP_CLI_DEV_SPAWN=1 — isolated spawn (not product attach)"
else
  echo "[demo] product attach (start hip app first)"
fi
echo "[demo] running hip run …"

set +e
yarn cli:dev run \
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
fi

if [[ "${code}" -eq 3 ]]; then
  echo "[demo] exit 3 often means APP_NOT_RUNNING — open the hip desktop app and retry."
fi

exit "${code}"
