# hip — PROJECT KNOWLEDGE BASE

**Generated:** 2026-06-21 | **Commit:** `e063429` | **Branch:** `main`

## OVERVIEW

Desktop AI agent app (Tauri + React + Node.js sidecar). Three processes: Rust shell manages window + sidecar lifecycle; React frontend renders tabs/chat/artifacts; Node.js sidecar runs LangGraph agent loop with WebSocket protocol.

## STRUCTURE

```
hip/
├── src/                    # React frontend (Vite + Zustand + Tailwind)
│   ├── domain/             # Core: sessionService, sessionStore, transport
│   ├── store/              # Zustand stores (ui, draft, providers, diff, …)
│   ├── ipc/                # Tauri IPC + WebSocket client wrappers
│   ├── components/         # 8 feature groups (chat, artifact, account, …)
│   ├── lib/                # Pure utilities (25 modules, all with tests)
│   ├── routes/             # Hash router: /login → /app
│   └── i18n/               # zh-CN, zh-TW, en (i18next)
├── packages/
│   ├── protocol/           # @hip/protocol — shared WS message types (single file, no build)
│   └── sidecar/            # @hip/sidecar — LangGraph agent runtime + WS server
│       └── src/
│           ├── session/    # Core agent loop (1236-line Session class) → AGENTS.md
│           │   └── agents/ # External agent providers (ACP) → AGENTS.md
│           ├── orchestrator/ # DAG workflow engine → AGENTS.md
│           ├── persistence/  # SQLite + FTS5 + schema migrations → AGENTS.md
│           └── config/       # Auth, providers, MCP config → AGENTS.md
├── src-tauri/              # Rust Tauri shell (8 source files, ~30 commands)
├── scripts/                # dev.sh, make-sidecar-dev-bin.sh, hip-acp-template.mjs
├── e2e/                    # WebdriverIO specs (3 suites)
└── docs/                   # Design specs + implementation plans
```

## CODE MAP

Key symbols by blast radius. Ref counts are callers found in this repo.

| Symbol | Type | Location | Refs | Role |
|--------|------|----------|------|------|
| `Session` | class | `packages/sidecar/src/session/session.ts:99` | 20+ | Sidecar session lifecycle hub |
| `applyServerMessage` | function | `src/domain/sessionStore.ts:143` | 2 | Frontend server-message reducer |
| `SessionService` | class | `src/domain/sessionService.ts:23` | 1 | Frontend WebSocket orchestrator singleton |
| `WsClient` | class | `src/ipc/ws-client.ts:11` | 1 | Frontend WebSocket client with backoff |
| `WsServer` | class | `packages/sidecar/src/server/ws-server.ts:18` | 0 | Sidecar WebSocket server entry |
| `buildTools` | function | `packages/sidecar/src/session/tools.ts:305` | 15 | Permission-gated tool factory |
| `buildGraph` | function | `packages/sidecar/src/session/graph.ts:89` | — | LangGraph StateGraph compiler |
| `projectEvent` | function | `packages/sidecar/src/persistence/message-projector.ts:44` | 10 | Event-sourced message projection |

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add WS message type | `packages/protocol/src/index.ts` | Single truth for ClientMessage/ServerMessage unions |
| Route new client message | `packages/sidecar/src/session/session-manager.ts` | Exhaustive switch on msg.type |
| Handle WS message in frontend | `src/domain/sessionStore.ts` → `applyServerMessage()` | Pure reducer, 150 lines |
| Add Tauri command | `src-tauri/src/lib.rs` | All ~30 commands here |
| Add provider/model config | `src-tauri/src/lib.rs` + `src/ipc/providersConfig.ts` + `packages/sidecar/src/config/providers.ts` | Three places must agree |
| Add agent tool | `packages/sidecar/src/session/tools.ts` | buildTools() — permission-gated |
| Add external agent provider | `packages/sidecar/src/session/agents/index.ts` | Factory pattern |
| Add Zustand store | `src/store/` | Follow existing pattern: create + selectors + optional persist |
| Understand session lifecycle | `packages/sidecar/src/session/session.ts` | 1236-line god file, read top-down |
| Debug WebSocket connection | `src/ipc/ws-client.ts` (frontend) + `packages/sidecar/src/server/ws-server.ts` (sidecar) | Exponential backoff reconnect |
| API key management | `src-tauri/src/auth.rs` (atomic write, 0600) + `src/ipc/secrets.ts` + `packages/sidecar/src/config/auth-file.ts` | ~/.hip/config/auth.json |

## CONVENTIONS

- **TypeScript strict** everywhere: `strict`, `noUnusedLocals`, `noUnusedParameters`
- **No linter/formatter**: No ESLint, Prettier, or Biome. `tsc --noEmit` only
- **Module resolution split**: Frontend `bundler`, sidecar `NodeNext` (requires `.js` extensions in relative imports)
- **Path aliases**: `@/` → `src/`, `@hip/protocol` → `packages/protocol/src/index.ts`
- **Test co-location**: `foo.ts` → `foo.test.ts` in same directory. No `__tests__/`
- **Test types**: `*.test.ts` (unit), `*.integration.test.ts` (sidecar subprocess), `*.contract.test.ts` (protocol), `*.logic.test.ts` (component pure-logic extracts)
- **Real-LLM test gating**: `describe.skipIf(!hasKey)` — requires `~/.hip/config/auth.json`
- **Paid-test safety**: NEVER run bare `yarn test`. Use exact file paths
- **CSS variables only**: All colors via `var(--surface)`, `var(--accent)`, etc. No hardcoded hex in components
- **Flat design**: Shadows disabled except `menu` and `overlay`
- **Tailwind typography scale**: 7 named sizes (`caption` → `stat`) with built-in line-heights. No `text-[Npx]`
- **i18n**: All user-visible strings via `t('domain.key')`. 3 locales: zh-CN (default), zh-TW, en
- **Named exports only**: Zero `export default` in entire codebase
- **Rust**: Edition 2021, no unsafe, no .rustfmt.toml — standard defaults. `#[cfg(test)]` inline tests in lib.rs
- **Vitest environment**: `node` (not jsdom/happy-dom)
- **No dark mode**: Only light design tokens currently defined
- **Rust reqwest**: Pinned to 0.12 — 0.13's rustls requires unavailable `aws-lc-rs`
- **Default export exception**: Only `src/i18n/index.ts` uses `export default` (i18next bootstrap pattern)

## ANTI-PATTERNS (THIS PROJECT)

- **ANTI_PHANTOM**: Agent MUST NOT claim a file was created/written without actually calling the write tool (enforced in system prompt + verification)
- **IDENTITY**: Agent identifies as "hip" only. Never Claude/ChatGPT/Gemini
- **path_env.rs macOS PATH fix**: Must run `ensure_user_path()` at startup before spawning sidecar — GUI-launched apps have sanitized PATH
- **Protocol deprecation**: `toolPermissions` field in `@hip/protocol` marked `@deprecated` — kept for back-compat, ignored at runtime. Use `allowedSkills`/`allowedMcpServers` instead
- **Git safety**: `workspace-git.ts` NEVER touches HEAD/index. Never `reset --hard`. Checkpoint restore writes to temp index first
- **Config plaintext**: `~/.hip/config/auth.json` holds API keys. Do NOT sync to cloud drives or dotfile repos
- **Sidecar dev wrapper**: `make-sidecar-dev-bin.sh` bakes absolute node path. Must re-run after Node.js version changes
- **Mock auth**: `authStore.ts` is demo-only (localStorage boolean). No real OAuth implemented yet
- **Deprecated stores**: Individual per-domain Zustand stores (`mcpServersStore`, `skillsStore`, `providersStore`) are `@deprecated` — prefer `hipConfigStore` selectors
- **Windows console guard**: `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` in `src-tauri/src/main.rs` must not be removed

## COMMANDS

```bash
# One-time setup
yarn install && yarn sidecar:dev-bin

# Development
yarn tauri dev              # Full desktop app
yarn dev                    # Frontend only (Vite, port 1420)
yarn sidecar:dev            # Sidecar only (standalone WS)

# Testing
yarn type-check             # tsc --noEmit (frontend)
yarn test                   # Vitest (use exact file paths!)
yarn test:e2e               # WebdriverIO (needs .app binary)

# Build
yarn build                  # tsc && vite build (frontend)
yarn sidecar:build          # ncc bundle sidecar
yarn tauri build            # Native installer (.dmg/.msi/.deb)
```

## NOTES

- **3-process handshake**: Rust spawns sidecar → sidecar prints `{"port":N,"token":"..."}` to stdout → Rust captures → frontend polls `get_sidecar_info` → connects WebSocket
- **Sidecar parent death detection**: `HIP_PARENT_WATCH=1` → sidecar watches stdin EOF, exits when Tauri dies (handles SIGKILL)
- **Sidecar state guard**: `AtomicU64` generation counter prevents dying sidecar stdout reader from clobbering restarted sidecar's port
- **Vite workaround for node:sqlite**: `createRequire(import.meta.url)('node:sqlite')` — needed because Vite strips `node:` prefix
- **No CI**: No `.github/workflows/`. All tests run manually
- **Frontend is NOT a workspace**: Only `packages/*` are workspaces. Frontend deps in root `package.json`
- **Protocol consumed as source**: `@hip/protocol` has no build step — `"main": "src/index.ts"`. Vite and tsx import `.ts` directly
