# src/ipc/ — AGENTS.md

Inter-process communication layer. Three communication channels: WebSocket to sidecar (agent protocol), Tauri `invoke()` to Rust shell (config CRUD), and browser APIs (clipboard).

## STRUCTURE

```
ipc/
├── ws-client.ts        # WebSocket client singleton: connect/reconnect, msg buffering, backoff
├── secrets.ts          # Provider API key CRUD + sidecar restart (4 Tauri commands)
├── providersConfig.ts  # Provider config JSON I/O via Tauri (get/set)
├── catalog.ts          # Models catalog fetch + isCompatible() filter
├── agentsConfig.ts     # Agent config JSON I/O (get/set)
├── mcpServersConfig.ts # MCP server config JSON I/O (get/set)
├── skills.ts           # Skill list/install/delete/config (6 Tauri commands)
├── detect.ts           # which_binaries: detect ACP agents on PATH
├── dialog.ts           # Native folder/ZIP picker via tauri-plugin-dialog
└── clipboard.ts        # navigator.clipboard.writeText with execCommand fallback
```

## THREE-CHANNEL ARCHITECTURE

| Channel | Transport | Destination | Purpose |
|---------|-----------|------------|---------|
| **A: WS to Sidecar** | WebSocket (`ws-client.ts`) | Sidecar WS server | Agent chat, FS ops, git ops, permissions |
| **B: Tauri invoke** | Rust IPC (`invoke()`) | Rust shell commands | Config CRUD, secret storage, binary detection |
| **C: Browser APIs** | `navigator.clipboard` | OS clipboard | Copy to clipboard |

## WHERE TO LOOK

| Task | File | Notes |
|------|------|-------|
| Understand WS reconnect | `ws-client.ts` | Exponential backoff (500ms→10s), epoch tracking, 100-msg queue |
| Add Tauri IPC wrapper | (any file) | Follow pattern: `invoke('command', {...})` |
| Sidecar connection | `ws-client.ts` → `get_sidecar_info` | Frontend polls Rust for sidecar port + token |
| API key management | `secrets.ts` | `has_secret`, `set_secret`, `delete_secret` → `restart_sidecar` |

## NOTES

- **All IPC wrappers are thin**: Each file wraps 1-6 Tauri `invoke()` calls with typed return
- **detect.ts pattern**: `DON'T swallow silently` — logs detection errors
- **DEEPSEEK_BASE**: Duplicated in `providersConfig.ts` (frontend) and `packages/sidecar/src/config/providers.ts` (sidecar) — update both
- **isCompatible()**: Uses `COMPATIBLE_IDS` allowlist. Sidecar uses `NATIVE_ONLY_PROVIDERS` blocklist for same purpose
