#!/usr/bin/env bash
#
# Build a macOS DMG that other Macs can open (Developer ID signed + notarized).
#
# Why plain `yarn tauri build` fails on other machines:
#   - No Developer ID signature → Gatekeeper shows「文件已损坏」when quarantine is set
#   - (e.g. download / WeChat / browser). Apps from other sites work because they are
#     signed with "Developer ID Application" and notarized by Apple.
#
# One-time Apple setup (required — cannot be automated without your account):
#   1. Enroll in Apple Developer Program (paid): https://developer.apple.com/programs/
#   2. Create a CSR in Keychain Access → Certificate Assistant
#   3. Create certificate type **Developer ID Application** at:
#        https://developer.apple.com/account/resources/certificates/list
#   4. Download .cer and double-click to install into login keychain
#   5. Verify:
#        security find-identity -v -p codesigning
#      Expect a line like: "Developer ID Application: Your Name (TEAMID)"
#   6. Notarization credentials (pick one):
#        A) App Store Connect API key (recommended for CI / scripting):
#             export APPLE_API_ISSUER=...
#             export APPLE_API_KEY=...          # Key ID
#             export APPLE_API_KEY_PATH=/path/to/AuthKey_XXX.p8
#        B) Apple ID + app-specific password:
#             export APPLE_ID=you@example.com
#             export APPLE_PASSWORD=xxxx-xxxx-xxxx-xxxx   # appleid.apple.com → App-Specific
#             export APPLE_TEAM_ID=XXXXXXXXXX
#
# Optional overrides:
#   export APPLE_SIGNING_IDENTITY='Developer ID Application: Your Name (TEAMID)'
#   (otherwise the first Developer ID Application identity is used)
#
# Usage:
#   scripts/release-macos.sh
#   # or: yarn release:macos
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

echo "==> hip macOS release (signed + notarized)"

# ── 1. Signing identity ─────────────────────────────────────────────────────
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

Other websites' apps open fine because they ship with Apple Developer ID
signing + notarization. An ad-hoc `yarn tauri build` DMG will always show
「文件已损坏」on other Macs once Gatekeeper quarantine is applied.

One-time setup:
  1. Apple Developer Program: https://developer.apple.com/programs/
  2. Create CSR (Keychain Access → Certificate Assistant → Request…)
  3. Create "Developer ID Application" cert:
     https://developer.apple.com/account/resources/certificates/list
  4. Install the .cer, then re-run:
     security find-identity -v -p codesigning
  5. Export notarization credentials (see scripts/release-macos.sh header)

Then re-run: yarn release:macos
EOF
  exit 1
fi

export APPLE_SIGNING_IDENTITY
echo "    signing identity: ${APPLE_SIGNING_IDENTITY}"

# ── 2. Notarization credentials ─────────────────────────────────────────────
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

Signing alone is not enough — Apple requires notarization for Developer ID
apps. Set either:

  # App Store Connect API key (recommended)
  export APPLE_API_ISSUER=...
  export APPLE_API_KEY=...
  export APPLE_API_KEY_PATH=/path/to/AuthKey_XXX.p8

  # or Apple ID + app-specific password
  export APPLE_ID=you@example.com
  export APPLE_PASSWORD=xxxx-xxxx-xxxx-xxxx
  export APPLE_TEAM_ID=XXXXXXXXXX

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

# ── 3. Production sidecar (never ship the dev shell wrapper) ────────────────
echo "==> production sidecar"
bash "${SCRIPT_DIR}/make-sidecar-prod-bin.sh"

# Guard: refuse shell-script sidecars
TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
SIDECAR_BIN="${ROOT_DIR}/src-tauri/binaries/sidecar-${TRIPLE}"
if file "${SIDECAR_BIN}" | grep -qi 'shell script\|ASCII text\|UTF-8 text'; then
  echo "error: ${SIDECAR_BIN} is still a script — prod packaging failed" >&2
  exit 1
fi

# ── 4. Build (Tauri codesigns + notarizes when env is set) ──────────────────
echo "==> yarn tauri build"
# Prefer dmg for distribution; "all" also fine.
yarn tauri build --bundles app,dmg

APP="${ROOT_DIR}/src-tauri/target/release/bundle/macos/hip.app"
DMG="$(ls -1 "${ROOT_DIR}"/src-tauri/target/release/bundle/dmg/hip_*_*.dmg 2>/dev/null | tail -1 || true)"

if [ ! -d "${APP}" ]; then
  echo "error: expected app bundle missing: ${APP}" >&2
  exit 1
fi

# ── 5. Verify ───────────────────────────────────────────────────────────────
echo "==> verify signature"
codesign --verify --deep --strict --verbose=2 "${APP}"
echo "==> Gatekeeper assessment"
spctl -a -vv -t install "${APP}" || {
  echo "warning: spctl rejected the app — notarization may have failed or is still propagating" >&2
  echo "         check: xcrun notarytool history (with your credentials)" >&2
  exit 1
}

echo
echo "OK — distributable build ready:"
echo "  app: ${APP}"
if [ -n "${DMG}" ]; then
  echo "  dmg: ${DMG}"
fi
echo
echo "Ship the DMG. Recipients should open it like any other Mac app."
echo "Do NOT transfer via tools that strip signatures; prefer HTTPS download."
