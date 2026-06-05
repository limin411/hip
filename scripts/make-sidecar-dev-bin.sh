#!/usr/bin/env bash
#
# Regenerates the dev-mode sidecar "binary" that Tauri's externalBin mechanism
# expects at src-tauri/binaries/sidecar-<target-triple>.
#
# It is NOT a compiled binary — it's a thin shell wrapper that launches the
# Node.js sidecar via `yarn workspace @hip/sidecar dev`. In production this path
# is replaced by a real bundled native binary.
#
# src-tauri/binaries/ is gitignored, so run this once after cloning (and again
# after switching Rust toolchains/targets) before `yarn tauri dev`:
#
#     yarn sidecar:dev-bin
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BIN_DIR="$ROOT_DIR/src-tauri/binaries"

# Tauri suffixes sidecar binaries with the Rust host target triple.
TARGET_TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
if [ -z "$TARGET_TRIPLE" ]; then
  echo "error: could not determine host target triple (is rustc installed?)" >&2
  exit 1
fi

mkdir -p "$BIN_DIR"
WRAPPER="$BIN_DIR/sidecar-$TARGET_TRIPLE"

# Note: the generated wrapper is executed from src-tauri/target/<profile>/, where
# Tauri copies externalBin at build time, so `../../..` resolves to the repo root.
cat > "$WRAPPER" <<EOF
#!/bin/bash
# Sidecar wrapper for dev mode on $TARGET_TRIPLE (generated — do not edit).
# In production this is replaced by a bundled native binary.
cd "\$(dirname "\$0")/../../.."
exec yarn workspace @hip/sidecar dev
EOF

chmod +x "$WRAPPER"
echo "wrote dev sidecar wrapper: $WRAPPER"
