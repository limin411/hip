# @hip/sidecar — AGENTS.md

LangGraph agent runtime + WebSocket server. Spawned by Tauri Rust shell, communicates with frontend via JSON WebSocket.

## OVERVIEW

Node.js sidecar process using LangGraph to run AI agent loops. Creates a WsServer that the React frontend connects to. Manages multiple `Session` instances, each with its own LangGraph compiled graph + workspace state.

## STRUCTURE

```
src/
├── main.ts              # Entry: open DB → start WS server → print {port,token} to stdout
├── parent-watch.ts      # Watch stdin EOF → self-terminate when Tauri dies
├── server/
│   └── ws-server.ts     # WebSocket server: token auth, origin check, → SessionManager
├── session/             # Core agent runtime → AGENTS.md
│   ├── session.ts       # Session class (904 lines — the heart)
│   ├── session-manager.ts # Message router: exhaustive switch on ClientMessage.type
│   ├── graph.ts         # LangGraph StateGraph: compact → agent → tools → nudge/pause
│   ├── tools.ts         # Tool definitions: file ops, bash, git, task, dispatch_agent
│   ├── model-factory.ts # buildChatModel(), ReasoningChatOpenAI for DeepSeek reasoning
│   ├── model-runner.ts  # RealModelRunner: streams deltas, retries transient failures
│   ├── subagent.ts      # Depth-1 worker agent (same tools minus task/dispatch)
│   ├── internal-runner.ts # Managed dispatched agent runner
│   ├── workspace-fs.ts  # File system: lsDir, readForPreview, jail + symlink guard
│   ├── workspace-git.ts # Git: diff parsing, checkpoints, branches, revert (516 lines)
│   ├── system-prompt.ts # System prompt builder (supervisor, child, managed agent)
│   ├── compaction.ts    # Context summarization when token budget exceeded
│   ├── doom-loop.ts     # Detect repeating tool-call batches, nudge then pause
│   ├── verify.ts        # Phantom-write detection (claimed vs actual writes)
│   ├── agents/          # External agent providers → AGENTS.md
│   ├── mcp/             # MCP client pool manager
│   └── skills/          # Skill registry (reads SKILL.md from filesystem)
├── orchestrator/        # DAG workflow engine → AGENTS.md
├── persistence/         # SQLite + FTS5 + schema migrations → AGENTS.md
└── config/              # Auth, providers, MCP config → AGENTS.md
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Entry / bootstrap | `src/main.ts` | DB open → WS start → stdout handshake |
| WS protocol routing | `src/server/ws-server.ts` → `session/session-manager.ts` | Token auth, exhaustive switch |
| Agent turn lifecycle | `session/session.ts` → `runTurn()` | Model build → graph invoke → finalize |
| Add tool | `session/tools.ts` → `buildTools()` | Permission-mode gated |
| Add external agent | `session/agents/index.ts` | Factory: custom→LoopProvider, acp→AcpProvider |
| DB schema change | `persistence/schema.ts` | Incremental ALTER TABLE migrations |
| Config loading | `config/providers.ts` + `config/auth-file.ts` | Env var first, then auth.json |

## CONVENTIONS

- **Module resolution**: `NodeNext` — relative imports MUST use `.js` extension
- **Never throws**: Many public APIs return `{ ok: false, error }` instead of throwing
- **Permission modes**: `chat` (read-only), `edit` (default, HITL on scripts), `full` (unrestricted)
- **Git checkpoints**: Auto-created per-turn on private `refs/hip/checkpoints/` refs, NEVER touches HEAD

## NOTES

- The sidecar reads provider API keys from `HIP_MODEL_<ID>_API_KEY` env vars (injected by Rust shell)
- `HIP_PARENT_WATCH=1` enables stdin EOF detection → sidecar exits cleanly when Tauri dies
- Uses `createRequire(import.meta.url)('node:sqlite')` to work around Vite's `node:` prefix stripping
