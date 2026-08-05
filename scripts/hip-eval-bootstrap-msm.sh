#!/usr/bin/env bash
# Export env for make-stock-money eval / dogfood pack.
# Usage: eval "$(scripts/hip-eval-bootstrap-msm.sh)"
set -euo pipefail

DEFAULT_PATH="/Users/lijiamin/data/code-repository/project-rust/make-stock-money"
MSM_PATH="${HIP_EVAL_MSM_PATH:-$DEFAULT_PATH}"

if [[ ! -d "$MSM_PATH" ]]; then
  echo "make-stock-money path not found: $MSM_PATH" >&2
  echo "Set HIP_EVAL_MSM_PATH to your checkout." >&2
  exit 1
fi

if ! git -C "$MSM_PATH" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "not a git repo: $MSM_PATH" >&2
  exit 1
fi

BASE_SHA="${HIP_EVAL_MSM_BASE_SHA:-$(git -C "$MSM_PATH" rev-parse HEAD)}"

# Quick sanity: backend tests exist
if [[ ! -f "$MSM_PATH/src-tauri/Cargo.toml" ]]; then
  echo "missing src-tauri/Cargo.toml under $MSM_PATH" >&2
  exit 1
fi

# Only export lines on stdout (safe for: eval "$(script)")
echo "export HIP_EVAL_MSM_PATH=${MSM_PATH}"
echo "export HIP_EVAL_MSM_BASE_SHA=${BASE_SHA}"
echo "msm repo=${MSM_PATH} head=${BASE_SHA}" >&2
