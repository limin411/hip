# packages/sidecar/src/config/ — AGENTS.md

Configuration loading for the sidecar. Reads provider settings, API keys, MCP server definitions, and skill configurations from filesystem paths set via environment variables (injected by Rust shell).

## STRUCTURE

```
config/
├── providers.ts     # ActiveModel management: get/set active, isOpenAICompatible(), cheapModelFor()
├── auth-file.ts     # Reads ~/.hip/config/auth.json → resolves API keys (env var first, then file)
└── mcp-servers.ts   # Reads MCP server config from HIP_MCP_SERVERS_PATH
```

## ENVIRONMENT VARIABLES

| Variable | Set by | Purpose |
|----------|--------|---------|
| `HIP_MODEL_<ID>_API_KEY` | Rust `sidecar.rs` | Per-provider API key |
| `HIP_PROVIDERS_PATH` | Rust `sidecar.rs` | Path to providers JSON config |
| `HIP_MCP_SERVERS_PATH` | Rust `sidecar.rs` | Path to MCP servers JSON config |
| `HIP_AGENTS_PATH` | Rust `sidecar.rs` | Path to agents JSON config |

## WHERE TO LOOK

| Task | File | Notes |
|------|------|-------|
| Active model resolution | `providers.ts` | `loadActiveModelFromEnv()` at startup, `setActiveModel()` at runtime |
| API key resolution | `auth-file.ts` | `resolveEnvFile()` — env var wins over file |
| Provider compatibility | `providers.ts` | `isOpenAICompatible()` uses `NATIVE_ONLY_PROVIDERS` blocklist |

## NOTES

- **DEEPSEEK_DEFAULT**: Hardcoded fallback (`deepseek-reasoner`). Duplicated in `src/ipc/providersConfig.ts` — update both
- **NATIVE_ONLY_PROVIDERS**: Blocklist of providers that are NOT OpenAI-compatible (anthropic, google, bedrock, vertex, azure)
- All config reads use `try/catch` → fallback to defaults (no crash on missing files)
