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
| `~/.hip/trash/` | Product recycle bin (knowledge FS quarantine; sessions soft-delete via SQLite) |

### Recycle bin & soft-delete

| Behavior | Notes |
|----------|--------|
| UI delete (Chat / Code / Knowledge) | Soft-delete → sidebar **Recycle bin** (above History) |
| Retention | Default **7** days; **Settings → General** or `hip.toml` `[trash] retentionDays` (1–365) |
| CLI `hip session delete --yes` | **Permanent** hard-delete (not the recycle bin) |
| Memory trash | Still **Settings → Memory** (separate retention, default 30 days) |

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

## Auth model (BYOK)

Keys are entered in the app **Settings → Providers** panel and stored in `auth.json`. Desktop app, standalone sidecar, and tests all resolve from that store. This is intentional plaintext-on-disk with tight file modes — not a keychain migration target.

Design detail: `docs/design/byok-spec.md`.

### Resolution order

When resolving an API key for a provider:

1. **auth.json** entry for `HIP_MODEL_<PROVIDER>_API_KEY` (if the key name is present in the file)
   - Non-empty → use it
   - Empty string → **cleared** (tombstone); do **not** fall back to env
2. **Standard environment variables** (e.g. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `MINIMAX_API_KEY`)
3. **`HIP_MODEL_<PROVIDER>_API_KEY`** env (legacy / Tauri inject / tests)

Saving or clearing a key does **not** require restarting the sidecar; the next request re-reads auth.json.

### Do not put LLM keys in hip.toml

`[[providers]] api_key` / `apiKey` is **not** used for chat. Use `auth.json` or env only. (LangSmith’s `[langsmith] api_key` is separate observability config.)

### Custom providers (`apiKind`)

```toml
[[providers]]
id = "my-minimax"
name = "My MiniMax"
baseUrl = "https://api.minimaxi.com/anthropic/v1"
apiKind = "anthropic"   # or "openai" (default)
enabled = true
```

- `openai` — OpenAI Chat Completions compatible  
- `anthropic` — Anthropic Messages API (also used by MiniMax / Kimi gateways)

Set in **Settings → Add custom provider**, or edit the provider detail pane. Keys still go in `auth.json`.

### Key expressions in auth.json

```json
{
  "HIP_MODEL_ANTHROPIC_API_KEY": "$ANTHROPIC_API_KEY",
  "HIP_MODEL_OPENAI_API_KEY": "!op read 'op://vault/openai/credential'"
}
```

| Form | Meaning |
|------|---------|
| literal | Used as-is |
| `$VAR` / `${VAR}` | Process environment |
| `!command` | Shell stdout (cached for process life). Disable with `HIP_AUTH_ALLOW_CMD=0` |
| `$!…` | Literal string starting with `!` (no shell) |

### Typed credentials (optional)

```json
{
  "credentials": {
    "anthropic": {
      "type": "oauth",
      "access": "…",
      "refresh": "…",
      "expires": 1893456000000
    },
    "cloudflare-ai-gateway": {
      "type": "api_key",
      "key": "cf-token",
      "env": { "CLOUDFLARE_ACCOUNT_ID": "…", "CLOUDFLARE_GATEWAY_ID": "…" }
    }
  }
}
```

Flat `HIP_MODEL_*` keys remain fully supported. When both exist, `credentials[provider]` wins. Expired OAuth does **not** fall back to env.

### ACP: optional hip key forward

```toml
[acp]
forward_hip_keys = true   # default false — inject hip keys as ANTHROPIC_API_KEY / OPENAI_API_KEY / …
```

Default remains self-managed ACP (no hip key injection).
