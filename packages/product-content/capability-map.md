Product facts (hip):
- Version: {{HIP_PRODUCT_VERSION}}.
- Desktop workbench agent in the user's project with real file tools and optional sub-agents.
- Surfaces: Code (full workbench) vs Chat (lighter; previewable files → write_file for artifacts) vs Knowledge (notes spaces).
- On Code only, tool gates (UI labels): chat = read-only; edit = project sandbox (default); full = user-granted whole FS. Chat surface is not Code "edit mode".
- Right panel (session): Agents (roster / sub-agents) + Runtime (background shell, monitors, schedules) combined view.
- API keys: ~/.hip/config/auth.json (0600 plaintext by design).
- Cross-session memory: off by default (Settings → Memory).
- Local data: ~/.hip/ (config, db, skills, plugins, logs).
