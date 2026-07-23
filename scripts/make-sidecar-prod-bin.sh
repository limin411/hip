#!/usr/bin/env bash
#
# Build a *distributable* production sidecar for `yarn tauri build` / release.
#
# Replaces the dev shell wrapper (which hardcodes this machine's repo path +
# system node) with:
#   1. ncc-bundled packages/sidecar → index.js
#   2. a copy of the Node runtime
#   3. a tiny Rust launcher at src-tauri/binaries/sidecar-<triple>
#      that execs Resources/hip-sidecar/node index.js inside the .app
#
# Usage (from repo root):
#   scripts/make-sidecar-prod-bin.sh
#   # or: yarn sidecar:prod-bin
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
BIN_DIR="${ROOT_DIR}/src-tauri/binaries"
RUNTIME_DIR="${ROOT_DIR}/src-tauri/resources/hip-sidecar"
LAUNCHER_SRC="${SCRIPT_DIR}/sidecar-launcher/main.rs"

TARGET_TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
if [ -z "${TARGET_TRIPLE}" ]; then
  echo "error: could not determine host target triple (is rustc installed?)" >&2
  exit 1
fi

NODE_BIN="$(node -e 'process.stdout.write(process.execPath)' 2>/dev/null || true)"
if [ -z "${NODE_BIN}" ] || [ ! -x "${NODE_BIN}" ]; then
  echo "error: could not resolve node executable" >&2
  exit 1
fi

# Bundle with esbuild (CJS). Prefer this over `yarn sidecar:build` (ncc): ncc typechecks
# the whole src tree including tests and currently fails on unrelated TS errors.
# CJS + import.meta.url shim so node:sqlite / createRequire paths keep working.
echo "[sidecar:prod] bundling sidecar with esbuild…"
ESBUILD="${ROOT_DIR}/node_modules/.bin/esbuild"
if [ ! -x "${ESBUILD}" ]; then
  echo "error: esbuild not found at ${ESBUILD} (run yarn install)" >&2
  exit 1
fi
mkdir -p "${ROOT_DIR}/packages/sidecar/dist"
BUNDLE_JS="${ROOT_DIR}/packages/sidecar/dist/index.cjs"
(
  cd "${ROOT_DIR}/packages/sidecar"
  "${ESBUILD}" src/main.ts \
    --bundle \
    --platform=node \
    --format=cjs \
    --target=node20 \
    --outfile="${BUNDLE_JS}" \
    --external:sqlite-vec \
    --banner:js="const __import_meta_url = require('url').pathToFileURL(__filename).href;" \
    --define:import.meta.url=__import_meta_url
)

if [ ! -f "${BUNDLE_JS}" ]; then
  echo "error: ${BUNDLE_JS} missing after esbuild" >&2
  exit 1
fi

echo "[sidecar:prod] staging runtime → ${RUNTIME_DIR}"
rm -rf "${RUNTIME_DIR}"
mkdir -p "${RUNTIME_DIR}"
# Ship as index.js (CJS content; Node loads by extension-less detection via explicit path).
cp "${BUNDLE_JS}" "${RUNTIME_DIR}/index.js"
# Ensure package type does not force ESM parse of our CJS bundle.
printf '%s\n' '{}' > "${RUNTIME_DIR}/package.json"
cp "${NODE_BIN}" "${RUNTIME_DIR}/node"
chmod +x "${RUNTIME_DIR}/node"

echo "[sidecar:prod] compiling launcher for ${TARGET_TRIPLE}…"
mkdir -p "${BIN_DIR}"
OUT="${BIN_DIR}/sidecar-${TARGET_TRIPLE}"
# rustc free-standing compile — no Cargo.toml needed for this tiny binary.
rustc --edition 2021 -O -o "${OUT}" "${LAUNCHER_SRC}"
chmod +x "${OUT}"

# Refuse to ship a shell-script "binary" (the classic accidental-dev-wrapper bug).
if file "${OUT}" | grep -qi 'shell script\|ASCII text\|UTF-8 text'; then
  echo "error: launcher at ${OUT} is not a native binary" >&2
  exit 1
fi
if [ ! -x "${RUNTIME_DIR}/node" ] || [ ! -f "${RUNTIME_DIR}/index.js" ]; then
  echo "error: runtime staging incomplete under ${RUNTIME_DIR}" >&2
  exit 1
fi

echo "[sidecar:prod] wrote launcher: ${OUT}"
echo "[sidecar:prod] runtime:        ${RUNTIME_DIR}/ (node + index.js)"
echo "[sidecar:prod] next:           yarn release:macos"
