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
| **Default ReAct + task/dispatch** | Ordinary `message:send` (no pending workflow) | Supervisor ReAct graph (`buildGraph`). Agent-driven isolation via `task` / `dispatch_agent`; **true parallel** multi-part research via one `task_batch` (optional per-task `agent`, default concurrency 4). Prefer `task_batch` over sequential `dispatch_agent`. |
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

### LangSmith tracing (optional)

LangGraph / LangChain runs in the sidecar can export traces to
[LangSmith](https://smith.langchain.com/). Tracing is **off by default**.

**Preferred:** put settings in `~/.hip/config/hip.toml` (loaded at sidecar start
via `HIP_CONFIG_PATH`):

```toml
[langsmith]
enabled = true
api_key = "lsv2_…"                                    # from LangSmith settings
project = "hip"
endpoint = "https://eu.api.smith.langchain.com"       # EU only; omit for US cloud
```

Project-level `.hip/hip.toml` can override the global section wholesale (same
merge rule as `[agentLoop]`).

**Override:** process env still wins when already set (`LANGSMITH_TRACING`,
`LANGSMITH_API_KEY`, `LANGSMITH_PROJECT`, `LANGSMITH_ENDPOINT`, plus legacy
`LANGCHAIN_*` aliases). Tauri also forwards those into the sidecar.

Each user turn is one root trace; multi-turn runs for the same hip session are
grouped into one LangSmith **Thread** via `metadata.thread_id` /
`metadata.session_id` (= session id). Root run **name** is also the session id.
LLM spans are named `hip.model`. Keep `api_key` out of git; hip.toml lives under
`~/.hip/config/` (do not sync that directory to public cloud/dotfile repos).

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
| `yarn cli:dev` | Run the headless CLI (`hip version` / `hip doctor` / `hip run`) |
| `yarn cli:test` | CLI unit tests (settle / isolation / HITL, no paid LLM) |
| `yarn type-check` | Type-check the frontend |
| `yarn workspace @hip/sidecar type-check` | Type-check the sidecar |

### Headless CLI (`@hip/cli`)

Thin client over the same Node sidecar (no Tauri). Design: [`docs/superpowers/specs/2026-07-14-hip-cli-design.md`](docs/superpowers/specs/2026-07-14-hip-cli-design.md).

```bash
# Health: spawn sidecar, handshake, report hasApiKey
yarn cli:dev doctor

# Auth keys present? (never prints secrets)
yarn cli:dev config auth-status

# One-shot harness run (isolates HIP_*; writes HipRunResult JSON + optional artifacts)
yarn cli:dev run --preset harness --stream none \
  --json --output /tmp/hip-out/result.json \
  --out-dir /tmp/hip-out \
  "Reply with exactly: pong"

# Human stream modes: text | tools | all | none
yarn cli:dev run --stream all "summarize README.md"

# Acceptance demo (exit 0 on ok, or no-key preflight)
scripts/hip-run-harness-demo.sh

# Sessions (default: user ~/.hip/db — close the desktop app if DB is locked)
yarn cli:dev session list
yarn cli:dev session show <id-prefix> --limit 20
yarn cli:dev session delete <id> --yes

# Interactive multi-turn REPL (TTY)
yarn cli:dev repl --cwd .
```

| Flag / command | Meaning |
|----------------|---------|
| `--preset harness` | full isolation + `permissionMode=full` + `disablePlan` + auto HITL |
| `--json` / `--output` | Harness ABI result JSON |
| `--out-dir` | `result.json`, `trace.jsonl`, `patch.diff`, `usage.json` |
| `--stream` | Human transcript FD rules (JSON still isolated) |
| `--trace-raw` | Disable secret redaction in `trace.jsonl` |
| `session *` | List/show/delete persisted sessions |
| `repl` | Multi-turn interactive chat |

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
