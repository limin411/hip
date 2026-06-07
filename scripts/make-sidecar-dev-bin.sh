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

# Note: this wrapper is copied by Tauri to different locations depending on the
# build (src-tauri/target/<profile>/ for `tauri dev`, or inside the .app bundle
# for `tauri build`). To work from ANY location — so e.g. WebdriverIO E2E can run
# the bundled app with a live sidecar — we bake in the absolute repo root at
# generation time. (This file is gitignored and regenerated per machine.) `node`
# stays PATH-resolved: the process inherits the launching shell's PATH.
cat > "$WRAPPER" <<EOF
#!/bin/bash
# Sidecar wrapper for dev mode on $TARGET_TRIPLE (generated — do not edit).
# In production this is replaced by a bundled native binary.
#
# IMPORTANT: this MUST launch the sidecar as a SINGLE process. Tauri's
# child.kill() (used by restart_sidecar and on app exit) only kills the direct
# child PID. A wrapper layer like 'yarn … dev' spawns yarn → tsx → node, so
# killing the wrapper orphans the real Node WS server: it keeps the old port and
# WS connection alive, the client never sees a disconnect, never reconnects to
# the freshly-spawned sidecar, and a key change silently fails to take effect.
# 'node --import tsx' runs the TypeScript entry in-process (no child), so this
# PID *is* the WS server and child.kill() tears it down cleanly.
cd "$ROOT_DIR"
exec node --import tsx packages/sidecar/src/main.ts
EOF

chmod +x "$WRAPPER"
echo "wrote dev sidecar wrapper: $WRAPPER"
