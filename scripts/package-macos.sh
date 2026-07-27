#!/usr/bin/env bash
#
# hip — macOS 分发包（.app + .dmg）
#
# 必须在 macOS 上运行。会：
#   1. yarn sidecar:prod-bin  （node + index.js + 原生 launcher，禁止用 dev wrapper）
#   2. 校验 runtime / launcher
#   3. yarn tauri build --bundles app,dmg
#   4. codesign + notarization 校验（需 Developer ID）
#
# 前置：
#   - Node.js >= 22.5、Yarn、Rust
#   - Apple Developer ID Application 证书在钥匙串（签发发行包时）
#   - 公证凭据（二选一，签发发行包时）：
#       export APPLE_API_ISSUER=... APPLE_API_KEY=... APPLE_API_KEY_PATH=/path/to/AuthKey_XXX.p8
#       或 export APPLE_ID=... APPLE_PASSWORD=... APPLE_TEAM_ID=...
#   - 可选：export APPLE_SIGNING_IDENTITY='Developer ID Application: Name (TEAMID)'
#
# 用法（仓库根目录）：
#   yarn package:macos
#   # 或：bash scripts/package-macos.sh
#   # CI / 无证书狗粮（不公证，不可对外分发）：
#   HIP_SKIP_SIGN=1 yarn package:macos
#
# 语音引擎（whisper-cli）— 自包含树，不依赖用户机 Homebrew：
#   正式发行包默认捆绑（HIP_BUNDLE_WHISPER 默认 1；模型仍按需下载）。
#   跳过：HIP_BUNDLE_WHISPER=0 yarn package:macos
#   强制重编：HIP_WHISPER_REBUILD=1 yarn package:macos
#   见 src-tauri/resources/whisper/README.md（macOS 生产 / Windows 生产 / 开发）
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

echo "==> hip package:macos"

case "$(uname -s)" in
  Darwin) ;;
  *)
    echo "error: package-macos.sh must run on macOS (got $(uname -s))" >&2
    exit 1
    ;;
esac

# Release default: bundle whisper-cli. Models stay opt-in (Settings download).
# Slim / CI-without-cmake: HIP_BUNDLE_WHISPER=0
if [ "${HIP_BUNDLE_WHISPER:-1}" = "1" ]; then
  echo "==> bundling whisper-cli (release default; HIP_BUNDLE_WHISPER=0 to skip)"
  bash "${SCRIPT_DIR}/make-whisper-bin.sh"
  WHISPER_TRIPLE="${HIP_WHISPER_TRIPLE:-$(rustc -vV | sed -n 's/^host: //p')}"
  WHISPER_BIN="${ROOT_DIR}/src-tauri/resources/whisper/${WHISPER_TRIPLE}/whisper-cli"
  if [ ! -x "${WHISPER_BIN}" ]; then
    echo "error: expected whisper-cli at ${WHISPER_BIN} after make-whisper-bin.sh" >&2
    exit 1
  fi
  echo "    staged: ${WHISPER_BIN} ($(wc -c < "${WHISPER_BIN}" | tr -d ' ') bytes)"
else
  echo "==> HIP_BUNDLE_WHISPER=0 — skipping whisper-cli (voice needs brew/HIP_WHISPER_BIN at runtime)"
fi

# ── 1. Signing / notarization ───────────────────────────────────────────────
# CI / dogfood: HIP_SKIP_SIGN=1 → ad-hoc (or unsigned) bundle, no notarization.
# Ship builds MUST leave HIP_SKIP_SIGN unset and provide Developer ID + notary creds.
SKIP_SIGN=0
if [ "${HIP_SKIP_SIGN:-0}" = "1" ] || [ "${HIP_SKIP_SIGN:-}" = "true" ]; then
  SKIP_SIGN=1
fi

if [ "${SKIP_SIGN}" -eq 1 ]; then
  echo "==> HIP_SKIP_SIGN=1 — skipping Developer ID + notarization (CI / local dogfood only)"
  echo "    Gatekeeper will reject this DMG on other Macs; do not ship it."
  # Ensure Tauri does not pick up a half-configured identity from the environment.
  unset APPLE_SIGNING_IDENTITY APPLE_CERTIFICATE APPLE_CERTIFICATE_PASSWORD \
        APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID \
        APPLE_API_ISSUER APPLE_API_KEY APPLE_API_KEY_PATH 2>/dev/null || true
else
  if [ -z "${APPLE_SIGNING_IDENTITY:-}" ]; then
    APPLE_SIGNING_IDENTITY="$(
      security find-identity -v -p codesigning 2>/dev/null \
        | sed -n 's/.*"\(Developer ID Application: .*\)"/\1/p' \
        | head -1
    )"
  fi

  if [ -z "${APPLE_SIGNING_IDENTITY}" ]; then
    cat >&2 <<'EOF'
error: no "Developer ID Application" certificate in the keychain.

Ad-hoc `yarn tauri build` DMGs show "damaged" on other Macs under Gatekeeper.
One-time setup:
  1. Apple Developer Program
  2. Create "Developer ID Application" cert and install .cer
  3. security find-identity -v -p codesigning
  4. Set notarization env (see header of scripts/package-macos.sh)
Then: yarn package:macos

CI / unsigned dogfood: HIP_SKIP_SIGN=1 yarn package:macos
EOF
    exit 1
  fi

  export APPLE_SIGNING_IDENTITY
  echo "    signing identity: ${APPLE_SIGNING_IDENTITY}"

  # ── 2. Notarization credentials ───────────────────────────────────────────
  has_api=0
  has_apple_id=0
  if [ -n "${APPLE_API_ISSUER:-}" ] && [ -n "${APPLE_API_KEY:-}" ] && [ -n "${APPLE_API_KEY_PATH:-}" ]; then
    has_api=1
  fi
  if [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_PASSWORD:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ]; then
    has_apple_id=1
  fi

  if [ "${has_api}" -eq 0 ] && [ "${has_apple_id}" -eq 0 ]; then
    cat >&2 <<'EOF'
error: notarization credentials missing.

Set either:

  export APPLE_API_ISSUER=...
  export APPLE_API_KEY=...
  export APPLE_API_KEY_PATH=/path/to/AuthKey_XXX.p8

  # or
  export APPLE_ID=you@example.com
  export APPLE_PASSWORD=xxxx-xxxx-xxxx-xxxx
  export APPLE_TEAM_ID=XXXXXXXXXX

CI / unsigned dogfood: HIP_SKIP_SIGN=1 yarn package:macos

See: https://v2.tauri.app/distribute/sign/macos/
EOF
    exit 1
  fi

  if [ "${has_api}" -eq 1 ]; then
    echo "    notarization: App Store Connect API key (${APPLE_API_KEY})"
    if [ ! -f "${APPLE_API_KEY_PATH}" ]; then
      echo "error: APPLE_API_KEY_PATH not a file: ${APPLE_API_KEY_PATH}" >&2
      exit 1
    fi
  else
    echo "    notarization: Apple ID (${APPLE_ID})"
  fi
fi

# ── 3. Production sidecar (never ship the dev shell wrapper) ────────────────
echo "==> production sidecar (yarn sidecar:prod-bin)"
bash "${SCRIPT_DIR}/make-sidecar-prod-bin.sh"

RUNTIME_DIR="${ROOT_DIR}/src-tauri/resources/hip-sidecar"
if [ ! -f "${RUNTIME_DIR}/node" ] || [ ! -f "${RUNTIME_DIR}/index.js" ]; then
  echo "error: hip-sidecar incomplete (need node + index.js under ${RUNTIME_DIR})" >&2
  exit 1
fi
NODE_SIZE="$(wc -c < "${RUNTIME_DIR}/node" | tr -d ' ')"
INDEX_SIZE="$(wc -c < "${RUNTIME_DIR}/index.js" | tr -d ' ')"
if [ "${NODE_SIZE}" -lt 1000000 ] || [ "${INDEX_SIZE}" -lt 10000 ]; then
  echo "error: hip-sidecar looks truncated (node=${NODE_SIZE}B index=${INDEX_SIZE}B)" >&2
  exit 1
fi
echo "    hip-sidecar: node (${NODE_SIZE} bytes), index.js (${INDEX_SIZE} bytes)"

TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
SIDECAR_BIN="${ROOT_DIR}/src-tauri/binaries/sidecar-${TRIPLE}"
if [ ! -f "${SIDECAR_BIN}" ]; then
  echo "error: missing launcher ${SIDECAR_BIN}" >&2
  exit 1
fi
if file "${SIDECAR_BIN}" | grep -qi 'shell script\|ASCII text\|UTF-8 text'; then
  echo "error: ${SIDECAR_BIN} is still a script — ran sidecar:dev-bin by mistake?" >&2
  exit 1
fi
echo "    launcher: ${SIDECAR_BIN}"

# ── 4. Build ────────────────────────────────────────────────────────────────
echo "==> yarn tauri build --bundles app,dmg"
yarn tauri build --bundles app,dmg

APP="${ROOT_DIR}/src-tauri/target/release/bundle/macos/hip.app"
DMG="$(ls -1 "${ROOT_DIR}"/src-tauri/target/release/bundle/dmg/hip_*_*.dmg 2>/dev/null | tail -1 || true)"

if [ ! -d "${APP}" ]; then
  echo "error: expected app bundle missing: ${APP}" >&2
  exit 1
fi

# Bundled runtime must exist inside the .app
APP_RUNTIME="${APP}/Contents/Resources/hip-sidecar"
if [ ! -f "${APP_RUNTIME}/node" ] || [ ! -f "${APP_RUNTIME}/index.js" ]; then
  echo "error: app bundle missing hip-sidecar runtime at ${APP_RUNTIME}" >&2
  ls -la "${APP}/Contents/Resources/" 2>/dev/null || true
  exit 1
fi

# ── 5. Verify ───────────────────────────────────────────────────────────────
if [ "${SKIP_SIGN}" -eq 1 ]; then
  echo "==> HIP_SKIP_SIGN=1 — skipping codesign/spctl verify"
else
  echo "==> verify signature"
  codesign --verify --deep --strict --verbose=2 "${APP}"
  echo "==> Gatekeeper assessment"
  spctl -a -vv -t install "${APP}" || {
    echo "warning: spctl rejected the app — notarization may have failed or is still propagating" >&2
    echo "         check: xcrun notarytool history (with your credentials)" >&2
    exit 1
  }
fi

echo
if [ "${SKIP_SIGN}" -eq 1 ]; then
  echo "OK — macOS package ready (UNSIGNED — not for distribution):"
else
  echo "OK — macOS package ready:"
fi
echo "  app: ${APP}"
if [ -n "${DMG}" ]; then
  echo "  dmg: ${DMG}"
fi
if [ "${SKIP_SIGN}" -eq 0 ]; then
  echo
  echo "Ship the DMG over HTTPS. Do not transfer via tools that strip signatures."
fi
