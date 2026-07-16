#!/usr/bin/env bash
# Build a disposable mini Go git repo for the non-Bytebase eval pack.
# Prints: export HIP_EVAL_MINI_GO_PATH=... and BASE_SHA=...
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/e2e/eval/tasks/mini-go/fixture"
DEST="${HIP_EVAL_MINI_GO_PATH:-$HOME/.hip/eval-fixtures/mini-go}"
FIXDIR="$ROOT/e2e/eval/tasks/mini-go/fixtures"

rm -rf "${DEST}"
mkdir -p "${DEST}"
cp -R "${SRC}/." "${DEST}/"
cd "${DEST}"
git init -q -b main
git config user.email "hip-eval@local"
git config user.name "hip-eval"
git add -A
git commit -q -m "mini-go baseline"
BASE_SHA="$(git rev-parse HEAD)"

# Refresh break patch against this tree for apply --check fidelity
mkdir -p "${FIXDIR}"
# create broken tree in a worktree copy then diff
python3 - <<'PY'
from pathlib import Path
p = Path("hello.go")
p.write_text(
    """package minigo

// Greet returns a greeting for name.
func Greet(name string) string {
	// hip-eval mini-go fixture: intentional bug
	return "bye"
}
"""
)
PY
git add hello.go
git diff --cached > "${FIXDIR}/break-greet.patch"
git reset -q --hard HEAD

echo "${BASE_SHA}" > "${FIXDIR}/.base_sha"
# Only export lines on stdout (safe for: eval "$(script)")
echo "export HIP_EVAL_MINI_GO_PATH=${DEST}"
echo "export HIP_EVAL_MINI_GO_BASE_SHA=${BASE_SHA}"
echo "mini-go repo=${DEST} base_sha=${BASE_SHA}" >&2
