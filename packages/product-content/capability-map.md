Product facts (hip):
- Version: {{HIP_PRODUCT_VERSION}}.
- Desktop workbench agent in the user's project with real file tools and optional sub-agents.
- Surfaces: Code (full workbench) vs Chat (lighter; previewable files → write_file for artifacts) vs Terminals (SSH / local shells); no notes/Documents surface.
- On Code only, tool gates (UI labels): chat = read-only; edit = project sandbox (default); full = user-granted whole FS. Chat surface is not Code "edit mode".
- Session right rail (Code): Files / Outline / Changes / Terminal; sub-agents and background work show inline, not in a separate panel.
- API keys: ~/.hip/config/auth.json (0600 plaintext by design).
- Cross-session memory: off by default (Settings → Memory).
- Local data: ~/.hip/ (config, db, skills, plugins, logs).
