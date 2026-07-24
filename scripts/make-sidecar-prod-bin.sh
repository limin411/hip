#!/usr/bin/env bash
#
# Build a *distributable* production sidecar for `yarn tauri build` / release.
#
# Replaces the dev shell wrapper (which hardcodes this machine's repo path +
# system node) with:
#   1. esbuild-bundled packages/sidecar → index.js
#   2. a copy of the Node runtime (node on Unix, node.exe on Windows)
#   3. a tiny Rust launcher at src-tauri/binaries/sidecar-<triple>
#      that execs hip-sidecar/node[…] index.js next to the app
#
# Usage (from repo root):
#   scripts/make-sidecar-prod-bin.sh
#   # or: yarn sidecar:prod-bin
#
# Windows: prefer `yarn sidecar:prod-bin` (dispatches to .ps1). This bash path
# still works under Git Bash if needed.
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

# node:sqlite (hip persistence) needs Node >= 22.5
NODE_VER="$(node -p 'process.versions.node' 2>/dev/null || true)"
NODE_MAJOR="${NODE_VER%%.*}"
NODE_REST="${NODE_VER#*.}"
NODE_MINOR="${NODE_REST%%.*}"
if [ -z "${NODE_MAJOR}" ] || [ "${NODE_MAJOR}" -lt 22 ] || { [ "${NODE_MAJOR}" -eq 22 ] && [ "${NODE_MINOR:-0}" -lt 5 ]; }; then
  echo "error: Node ${NODE_VER} is too old (need >= 22.5 for node:sqlite). Install a newer Node and re-run." >&2
  exit 1
fi

IS_WINDOWS=0
case "$(uname -s 2>/dev/null || echo unknown)" in
  MINGW*|MSYS*|CYGWIN*) IS_WINDOWS=1 ;;
esac
if [[ "${TARGET_TRIPLE}" == *windows* ]]; then
  IS_WINDOWS=1
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
# Keep README.txt (tracked); wipe everything else so we never ship a stale foreign node.
mkdir -p "${RUNTIME_DIR}"
find "${RUNTIME_DIR}" -mindepth 1 -maxdepth 1 ! -name 'README.txt' -exec rm -rf {} +
# Ship as index.js (CJS content; Node loads by extension-less detection via explicit path).
cp "${BUNDLE_JS}" "${RUNTIME_DIR}/index.js"
# Ensure package type does not force ESM parse of our CJS bundle.
printf '%s\n' '{}' > "${RUNTIME_DIR}/package.json"
if [ "${IS_WINDOWS}" -eq 1 ]; then
  # Windows installer layout expects node.exe (launcher prefers this name).
  cp "${NODE_BIN}" "${RUNTIME_DIR}/node.exe"
  chmod +x "${RUNTIME_DIR}/node.exe" 2>/dev/null || true
  NODE_STAGED="${RUNTIME_DIR}/node.exe"
else
  cp "${NODE_BIN}" "${RUNTIME_DIR}/node"
  chmod +x "${RUNTIME_DIR}/node"
  NODE_STAGED="${RUNTIME_DIR}/node"
fi

echo "[sidecar:prod] compiling launcher for ${TARGET_TRIPLE}…"
mkdir -p "${BIN_DIR}"
if [ "${IS_WINDOWS}" -eq 1 ]; then
  OUT="${BIN_DIR}/sidecar-${TARGET_TRIPLE}.exe"
else
  OUT="${BIN_DIR}/sidecar-${TARGET_TRIPLE}"
fi

# Free-standing rustc on Unix; cargo on Windows (Job Object needs stable link).
if [ "${IS_WINDOWS}" -eq 1 ]; then
  TMP="${BIN_DIR}/.launcher-prod-build"
  rm -rf "${TMP}"
  mkdir -p "${TMP}/src"
  cp "${LAUNCHER_SRC}" "${TMP}/src/main.rs"
  cat > "${TMP}/Cargo.toml" <<'EOF'
[package]
name = "sidecar-launcher"
version = "0.1.0"
edition = "2021"

[[bin]]
name = "sidecar-launcher"
path = "src/main.rs"
EOF
  cargo build --manifest-path "${TMP}/Cargo.toml" --release
  cp "${TMP}/target/release/sidecar-launcher.exe" "${OUT}"
  rm -rf "${TMP}"
else
  rustc --edition 2021 -O -o "${OUT}" "${LAUNCHER_SRC}"
fi
chmod +x "${OUT}" 2>/dev/null || true

# Refuse to ship a shell-script "binary" (the classic accidental-dev-wrapper bug).
if file "${OUT}" 2>/dev/null | grep -qi 'shell script\|ASCII text\|UTF-8 text'; then
  echo "error: launcher at ${OUT} is not a native binary" >&2
  exit 1
fi

# Guard: refuse empty runtime (ships as empty NSIS hip-sidecar/ with only README).
if [ ! -f "${NODE_STAGED}" ]; then
  echo "error: staged node missing at ${NODE_STAGED}" >&2
  exit 1
fi
if [ ! -f "${RUNTIME_DIR}/index.js" ]; then
  echo "error: staged index.js missing" >&2
  exit 1
fi
INDEX_SIZE="$(wc -c < "${RUNTIME_DIR}/index.js" | tr -d ' ')"
if [ "${INDEX_SIZE}" -lt 10000 ]; then
  echo "error: index.js too small (${INDEX_SIZE} bytes) — bundle likely failed" >&2
  exit 1
fi
NODE_SIZE="$(wc -c < "${NODE_STAGED}" | tr -d ' ')"
if [ "${NODE_SIZE}" -lt 1000000 ]; then
  echo "error: node binary too small (${NODE_SIZE} bytes) — not a real Node runtime" >&2
  exit 1
fi

echo "[sidecar:prod] wrote launcher: ${OUT}"
echo "[sidecar:prod] runtime:        ${RUNTIME_DIR}/ ($(basename "${NODE_STAGED}") + index.js)"
echo "[sidecar:prod] next:           yarn package:macos   # or yarn package:windows"
