# hip

A desktop AI agent app (à la Claude Code Desktop / Codex Desktop). A single
Node.js **sidecar** process manages multiple [LangGraph](https://langchain-ai.github.io/langgraphjs/)
agent instances; each UI tab is an independent session, and within a session a
Supervisor agent delegates sequentially to sub-agents (Planner → Coder → Reviewer)
via the deepagents `task` tool.

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
> the OS keychain — the desktop app reads it from there only. A `.env` file (see
> `.env.example`) is read solely by the test suite and the standalone sidecar
> (`scripts/dev.sh start sidecar`), never by the desktop app.

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
