# hip

A desktop AI agent app (à la Claude Code Desktop / Codex Desktop). A single
Node.js **sidecar** process manages multiple [LangGraph](https://langchain-ai.github.io/langgraphjs/)
agent instances; each UI tab is an independent session. The product default is a
**Supervisor ReAct** loop: the agent decides when to delegate via tools
(`task` / `dispatch_agent` / `task_batch`). There is no forced Planner → Coder →
Reviewer pipeline on ordinary turns.

## Architecture

Three processes communicate at runtime:

| Process | Runtime | Role |
|---------|---------|------|
| **Tauri Shell** | Rust (`src-tauri/`) | Window management, sidecar lifecycle, `get_sidecar_port` command |
| **Frontend** | React + Vite (`src/`) | Tabs, chat, agent execution tree |
| **Sidecar** | Node.js (`packages/sidecar/`) | LangGraph agent runtime, WebSocket server |

The Tauri shell spawns the sidecar on startup (via `tauri-plugin-shell`'s
sidecar mechanism). The sidecar binds a WebSocket server on a free port and
prints `{"port":NNNN}` to stdout; Rust captures it and exposes it through the
`get_sidecar_port` command. The frontend then connects to `ws://localhost:NNNN`.

### Delegation entries (agent runtime)

Product turns enter one of three paths. Only an **explicit** workflow def
switches off the default ReAct loop; session `orchMode` is ignored for routing
(UI toggle removed; API remains deprecated).

| Entry | When | Behavior |
|-------|------|----------|
| **Default ReAct + task/dispatch** | Ordinary `message:send` (no pending workflow) | Supervisor ReAct graph (`buildGraph`). Agent-driven isolation via `task` / `dispatch_agent`; parallel sub-tasks via `task_batch`. |
| **Explicit DAG** | `pendingWorkflowDef` set, or `workflow:run` | Orchestrator / workflow-runner DAG. Not forced by mode flags. Builtin cluster templates (e.g. planner→coder) are internal/test helpers only. |
| **Multi-agent handoff** | Optional / non-default callers | `multi-agent-graph` handoff (`handoff_to_*`) composition. Experimental surface; not the product default session path. |

This is a **yarn workspaces** monorepo:

```
packages/protocol/   @hip/protocol — shared WebSocket message types
packages/sidecar/    @hip/sidecar  — LangGraph WS server
src/                 React frontend
src-tauri/           Rust shell
```

See [`docs/superpowers/specs/`](docs/superpowers/specs/) for the full design and
[`docs/superpowers/plans/`](docs/superpowers/plans/) for the implementation plan.

## Development setup

> The DeepSeek API key is entered in the app's **Settings** panel and stored in
> `~/.hip/config/auth.json` (file mode `0600`) — the single source of truth. The
> desktop app, the standalone sidecar (`scripts/dev.sh start sidecar`), and the
> test suite all read the key from there. **`~/.hip/config/` holds plaintext API
> keys; do not sync it to cloud drives or dotfile repos.**

### Local data layout (`~/.hip/`)

| Path | Purpose |
|------|---------|
| `~/.hip/config/` | `auth.json`, `hip.toml`, network policy (mode `0600` where applicable) |
| `~/.hip/db/hip.db` | SQLite sessions, messages, agent runs, tools, events |
| `~/.hip/data/tool-output/` | Large tool outputs (kept out of the DB) |
| `~/.hip/logs/` | Sidecar / Tauri logs |
| `~/.hip/skills/`, `plugins/`, `scratch/` | Skills, plugins, install scratch |

Session delete removes DB rows for that session (including event log). See
[`docs/superpowers/specs/2026-07-10-persistence-data-model.md`](docs/superpowers/specs/2026-07-10-persistence-data-model.md).

```bash
# Optional: reclaim free pages after large deletes (app must be closed)
sqlite3 ~/.hip/db/hip.db 'VACUUM;'
```

```bash
# 1. Install workspace dependencies
yarn install

# 2. Generate the dev-mode sidecar wrapper (one-time, and after toolchain changes).
#    src-tauri/binaries/ is a gitignored build-artifact dir, so this step is
#    required before the Rust build can resolve the sidecar.
yarn sidecar:dev-bin

# 3. Run the app (launches Vite, the sidecar, and the Tauri window)
yarn tauri dev
```

### Useful scripts

| Command | Description |
|---------|-------------|
| `yarn tauri dev` | Run the full desktop app in dev mode |
| `yarn sidecar:dev` | Run the sidecar WS server standalone (prints its port) |
| `yarn sidecar:dev-bin` | (Re)generate the dev sidecar wrapper in `src-tauri/binaries/` |
| `yarn type-check` | Type-check the frontend |
| `yarn workspace @hip/sidecar type-check` | Type-check the sidecar |

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
