#!/usr/bin/env bash
# UI-first Bytebase pilot eval (desktop e2e).
# Usage:
#   export HIP_EVAL_BYTEBASE_PATH=/path/to/bytebase-3.16.1
#   scripts/hip-eval-ui-pilot.sh
# Optional: E2E_EVAL_KEEP_WORKSPACE=1 to keep worktrees on failure.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -z "${HIP_EVAL_BYTEBASE_PATH:-}" ]]; then
  echo "[eval] ERROR: set HIP_EVAL_BYTEBASE_PATH to a re-cloneable Bytebase checkout" >&2
  exit 2
fi

if [[ ! -d "${HIP_EVAL_BYTEBASE_PATH}/.git" ]]; then
  echo "[eval] ERROR: HIP_EVAL_BYTEBASE_PATH is not a git repo: ${HIP_EVAL_BYTEBASE_PATH}" >&2
  exit 2
fi

PIN="ac0061377bfdd05813e4747df971b0e3737fbe61"
if ! git -C "${HIP_EVAL_BYTEBASE_PATH}" cat-file -e "${PIN}^{commit}" 2>/dev/null; then
  echo "[eval] ERROR: pin ${PIN} not found in ${HIP_EVAL_BYTEBASE_PATH}" >&2
  exit 2
fi

PATCH="${ROOT}/e2e/eval/tasks/bytebase-pilot/fixtures/break-has-prefixes.patch"
TMP="$(mktemp -d)"
cleanup() {
  git -C "${HIP_EVAL_BYTEBASE_PATH}" worktree remove --force "${TMP}" 2>/dev/null || true
  rm -rf "${TMP}" 2>/dev/null || true
}
trap cleanup EXIT

git -C "${HIP_EVAL_BYTEBASE_PATH}" worktree add --detach "${TMP}" "${PIN}"
git -C "${TMP}" apply --check "${PATCH}"
echo "[eval] fixture apply --check OK on ${PIN}"

if [[ ! -x "./src-tauri/target/debug/hip" && ! -f "./src-tauri/target/debug/hip" ]]; then
  echo "[eval] WARN: debug binary missing; build with: yarn tauri build --debug" >&2
fi

echo "[eval] HIP_EVAL_BYTEBASE_PATH=${HIP_EVAL_BYTEBASE_PATH}"
echo "[eval] running @live @eval e2e…"

export E2E_LIVE_LLM=1
export HIP_EVAL_BYTEBASE_PATH
export HIP_EVAL_ROOT="${HIP_EVAL_ROOT:-${HOME}/.hip/eval-runs}"

yarn test:e2e --spec \
  e2e/specs/eval-bytebase-fix-has-prefixes.spec.ts \
  e2e/specs/eval-bytebase-nav-truncate.spec.ts \
  e2e/specs/eval-bytebase-stress-timeout.spec.ts
