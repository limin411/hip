# hip config & local data (Level 3)

## Layout (`~/.hip/`)

| Path | Purpose |
|------|---------|
| `~/.hip/config/auth.json` | Provider API keys (0600 plaintext by design) |
| `~/.hip/config/hip.toml` | Global product config (skills, agent loop, langsmith, …) |
| `~/.hip/config/memory.json` | Memory feature flags / pipeline knobs |
| `~/.hip/config/network.json` | Optional network policy |
| `~/.hip/config/hip-plugins.json` | Installed plugins registry |
| `~/.hip/db/hip.db` | SQLite sessions, messages, memory items, events |
| `~/.hip/data/tool-output/` | Large tool outputs (kept out of the DB) |
| `~/.hip/logs/` | Sidecar / shell logs |
| `~/.hip/skills/` | Global skills |
| `~/.hip/plugins/` | Installed plugins |
| `~/.hip/memories/` | Memory markdown mirrors |
| `~/.hip/builtin-skills/` | Built-in progressive product skills (e.g. this `hip` skill) |
| `~/.hip/scratch/`, worktrees | Scratch / parallel worktree helpers |

Project overrides often live under `<project>/.hip/` (e.g. `.hip/skills/`, `.hip/hip.toml`).

## Env / isolation (advanced)

| Variable | Role |
|----------|------|
| `HIP_DATA_DIR` | Redirect data/config roots (tests / isolation) |
| `HIP_SKILLS_DIR` | Override global skills root |
| `HIP_PLUGINS_DIR` | Override plugins root |
| `HIP_AUTH_PATH` | Override auth.json path |
| `HIP_CONFIG_PATH` | Override hip.toml path |
| `HIP_MEMORY_CONFIG_PATH` | Override memory.json path |
| `LANGSMITH_*` | Optional LangSmith tracing (also `[langsmith]` in hip.toml) |

**Do not** sync `~/.hip/config/` to public cloud or public dotfile repos — it may contain API keys.

## Auth model

Keys are entered in the app Settings panel and stored in `auth.json`. Desktop app, standalone sidecar, and tests all read from that store. This is intentional plaintext-on-disk with tight file modes — not a keychain migration target.
