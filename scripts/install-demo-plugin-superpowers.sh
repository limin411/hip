#!/usr/bin/env bash
# Install obra/superpowers into ~/.hip/plugins as a hip plugin demo.
# - Clones upstream skills
# - Writes .plugin/plugin.json (hip manifest) + PLUGIN.md
# - Registers the absolute path in ~/.hip/config/hip-plugins.json
#
# Usage: bash scripts/install-demo-plugin-superpowers.sh
# After install: restart hip or open a new session so sidecar reloads plugins.
set -euo pipefail

REPO_URL="${SUPERPOWERS_REPO_URL:-https://github.com/obra/superpowers.git}"
HIP_HOME="${HIP_HOME:-${HOME}/.hip}"
PLUGINS_DIR="${HIP_PLUGINS_DIR:-${HIP_HOME}/plugins}"
CONFIG_DIR="${HIP_HOME}/config"
TARGET="${PLUGINS_DIR}/superpowers"
CONFIG="${CONFIG_DIR}/hip-plugins.json"

mkdir -p "${PLUGINS_DIR}" "${CONFIG_DIR}"
rm -rf "${TARGET}"

echo "Cloning ${REPO_URL} → ${TARGET}"
git clone --depth 1 "${REPO_URL}" "${TARGET}"
rm -rf "${TARGET}/.git"

# Collect skill dirs that have SKILL.md
skills=()
for d in "${TARGET}"/skills/*/; do
  [[ -f "${d}SKILL.md" ]] || continue
  skills+=("./skills/$(basename "${d}")")
done

if [[ ${#skills[@]} -eq 0 ]]; then
  echo "error: no skills/*/SKILL.md found under ${TARGET}" >&2
  exit 1
fi

mkdir -p "${TARGET}/.plugin"

# Pretty-print skills JSON array
skills_json=""
for i in "${!skills[@]}"; do
  if [[ ${i} -gt 0 ]]; then skills_json+=","; fi
  skills_json+=$'\n    '"\"${skills[$i]}\""
done
skills_json+=$'\n  '

cat > "${TARGET}/.plugin/plugin.json" <<EOF
{
  "id": "superpowers",
  "name": "superpowers",
  "version": "6.1.1",
  "description": "Core skills library for coding agents: TDD, debugging, collaboration patterns, and proven workflows (obra/superpowers).",
  "author": {
    "name": "Jesse Vincent",
    "email": "jesse@fsck.com",
    "url": "https://github.com/obra/superpowers"
  },
  "license": "MIT",
  "keywords": ["skills", "tdd", "debugging", "collaboration", "best-practices", "workflows"],
  "skills": [${skills_json}]
}
EOF

cat > "${TARGET}/PLUGIN.md" <<'EOF'
---
id: superpowers
name: superpowers
version: 6.1.1
description: >
  Core skills library for coding agents — TDD, debugging, brainstorming,
  subagent-driven development, and verification workflows.
license: MIT
keywords: [skills, tdd, debugging, collaboration, workflows]
author:
  name: Jesse Vincent
source:
  type: github
  url: https://github.com/obra/superpowers
---

# superpowers

Upstream: [obra/superpowers](https://github.com/obra/superpowers).

hip adaptation:

- Capability source: `.plugin/plugin.json` (**skills only**).
- Upstream Claude `hooks/hooks.json` is not hip CJS hooks — not wired.
- After install, restart hip or open a **new session** so the sidecar reloads `hip-plugins.json`.

Reinstall / upgrade:

```bash
bash scripts/install-demo-plugin-superpowers.sh
```
EOF

python3 - "${TARGET}" "${CONFIG}" <<'PY'
import json, sys
from pathlib import Path

plugin_dir = Path(sys.argv[1]).resolve()
cfg_path = Path(sys.argv[2])
cfg = {"plugins": [], "entries": []}
if cfg_path.exists():
    try:
        raw = json.loads(cfg_path.read_text(encoding="utf-8"))
        if isinstance(raw, dict):
            cfg = raw
    except Exception:
        pass
plugins = [p for p in cfg.get("plugins", []) if isinstance(p, str)]
s = str(plugin_dir)
if s not in plugins:
    plugins.append(s)
cfg["plugins"] = plugins
if not isinstance(cfg.get("entries"), list):
    cfg["entries"] = []
cfg_path.write_text(json.dumps(cfg, indent=2) + "\n", encoding="utf-8")
print(f"Registered: {s}")
print(f"Config:     {cfg_path}")
print(f"plugins[]:  {cfg['plugins']}")
PY

echo ""
echo "Installed superpowers demo plugin (${#skills[@]} skills)."
echo "  dir:    ${TARGET}"
echo "  config: ${CONFIG}"
echo "Next: restart hip (or open a new session), then open Settings → Plugin Market / Skills."
