<p align="center">
  <img src="./public/logo-animated.svg" alt="hip mascot"/>
</p>

# hip

**English** | [简体中文](./README.zh-CN.md) | [繁體中文](./README.zh-TW.md) | [日本語](./README.ja.md) | [한국어](./README.ko.md)

**hip** is a desktop AI workbench (in the spirit of Claude Code Desktop / Codex Desktop): a Tauri shell, React UI, and Node.js sidecar that runs [LangGraph](https://langchain-ai.github.io/langgraphjs/) agents in your project.

Each UI tab is an independent session. The product default is a **Supervisor ReAct** loop — the agent uses tools and decides when to delegate via `task` / `dispatch_agent` / `task_batch`. Ordinary turns do **not** force a Planner → Coder → Reviewer pipeline.

> **Note:** hip is an independent project and is **not** affiliated with Anthropic, OpenAI, xAI, or other third-party agent products named for interoperability.

## Download

Prebuilt installers (when published) appear on **[GitHub Releases](https://github.com/limin411/hip/releases)**.  
Until a release is attached, build from source (see [Development setup](#development-setup)).

## Screenshots

<p align="center">
  <img src="./docs/images/chat-surface.webp" alt="hip Chat — new conversation with mascot and composer" width="920" />
</p>

<p align="center"><sub>Chat — start a conversation. Each tab is its own session.</sub></p>

<table>
  <tr>
    <td align="center" valign="top" width="50%">
      <img src="./docs/images/code-surface.webp" alt="hip Code surface — pick a project folder" />
      <br />
      <sub>Code — bind a project folder, then send a task</sub>
    </td>
    <td align="center" valign="top" width="50%">
      <img src="./docs/images/code-session.webp" alt="hip Code session — supervisor tools and files rail" />
      <br />
      <sub>Code session — supervisor tools plus the files rail</sub>
    </td>
  </tr>
  <tr>
    <td align="center" valign="top">
      <img src="./docs/images/settings-models.webp" alt="hip Settings — Model Configuration" />
      <br />
      <sub>Settings → Model Configuration — providers and API keys</sub>
    </td>
    <td align="center" valign="top">
      <img src="./docs/images/knowledge-home.webp" alt="hip Documents — local notes and tables" />
      <br />
      <sub>Documents — local-first notes, pages, and tables</sub>
    </td>
  </tr>
</table>

## Quick tour

1. **Add a provider key** — **Settings → Model Configuration**. Keys are stored in `~/.hip/config/auth.json` (mode `0600`).
2. **Start Chat or Code** — Chat is a lighter conversation. Code asks you to **Choose project folder** (default permission: **edit**, project sandbox).
3. **Send a task** — the supervisor uses tools and can delegate with `task` / `dispatch_agent` / `task_batch`. Watch the files rail and the **Changes** tab.
4. **Keep notes nearby** — **Documents** is a local knowledge base (pages and tables) next to the same workspace.

## Highlights

| Area | What you get |
|------|----------------|
| **Surfaces** | **Code** — full project workbench (files, git guidance, MCP, tools). **Chat** — lighter conversation; write previewable deliverables into the workspace for the artifacts panel. |
| **Permissions** | **edit** (default, project sandbox), **chat** (read-only), **full** (user-granted whole filesystem). |
| **Agents** | Supervisor plus roster agents (**explore** / **plan** / **coder**); agent-driven isolation and true parallel work via `task_batch`. |
| **Extensibility** | Skills (`SKILL.md`), plugins, MCP servers, hooks — global under `~/.hip/` and project under `.hip/`. Conflict resolution via the extension registry (skill precedence: project > user > plugin > builtin; hip.toml MCP id wins). |
| **Memory** | Cross-session memory **off by default**; enable under **Settings → Memory**. |
| **CLI** | Attach-only `@hip/cli` for the **running** desktop app (`doctor`, `session`, `run`, `repl`). |
| **Local-first** | Config, SQLite DB, skills, plugins, and logs live under `~/.hip/`. |

## Architecture

Three processes communicate at runtime:

| Process | Runtime | Role |
|---------|---------|------|
| **Tauri Shell** | Rust (`src-tauri/`) | Window management, sidecar lifecycle, `get_sidecar_port` command |
| **Frontend** | React + Vite (`src/`) | Tabs, chat, agent execution tree |
| **Sidecar** | Node.js (`packages/sidecar/`) | LangGraph agent runtime, WebSocket server |

The Tauri shell spawns the sidecar on startup (via `tauri-plugin-shell`'s sidecar mechanism). The sidecar binds a WebSocket server on a free port and prints `{"port":NNNN}` to stdout; Rust captures it and exposes it through the `get_sidecar_port` command. The frontend then connects to `ws://localhost:NNNN`.

### Delegation entries (agent runtime)

Product turns enter one of three paths. Only an **explicit** workflow def switches off the default ReAct loop; session `orchMode` is ignored for routing (UI toggle removed; API remains deprecated).

| Entry | When | Behavior |
|-------|------|----------|
| **Default ReAct + task/dispatch** | Ordinary `message:send` (no pending workflow) | Supervisor ReAct graph (`buildGraph`). Agent-driven isolation via `task` / `dispatch_agent`; **true parallel** multi-part research via one `task_batch` (optional per-task `agent`, default concurrency 4). Prefer `task_batch` over sequential `dispatch_agent`. |
| **Explicit DAG** | `pendingWorkflowDef` set, or `workflow:run` | Orchestrator / workflow-runner DAG. Not forced by mode flags. Builtin cluster templates (e.g. planner→coder) are internal/test helpers only. |
| **Multi-agent handoff** | Optional / non-default callers | `multi-agent-graph` handoff (`handoff_to_*`) composition. Experimental surface; not the product default session path. |

This is a **yarn workspaces** monorepo:

```
packages/protocol/   @hip/protocol — shared WebSocket message types
packages/sidecar/    @hip/sidecar  — LangGraph WS server
packages/cli/        @hip/cli      — attach-only product CLI
packages/product-content/  agent embeds + Settings Help locales
src/                 React frontend
src-tauri/           Rust shell
```

## Development setup

> API keys (e.g. DeepSeek) are entered in the app's **Settings** panel and stored in
> `~/.hip/config/auth.json` (file mode `0600`) — primary store for LLM API keys.
> The desktop app, standalone sidecar, and tests resolve keys from there (then
> standard env vars such as `ANTHROPIC_API_KEY`, then `HIP_MODEL_*`).
> **`~/.hip/config/` holds plaintext secrets; do not
> sync it to cloud drives or public dotfile repos.**

### Prerequisites

- Node.js ≥ 22.5 + [Yarn](https://yarnpkg.com/) classic (workspaces; see `.nvmrc`)
- Rust toolchain (for Tauri)
- Platform deps for [Tauri v2](https://v2.tauri.app/start/prerequisites/)

### Quick start

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

Then open **Settings**, add a provider API key, and start a session on the **Code** or **Chat** surface.

Optional non-secret config samples: [`docs/examples/hip.toml.example`](./docs/examples/hip.toml.example).  
Contributor workflow: [CONTRIBUTING.md](./CONTRIBUTING.md).


### ACP host policy (optional)

When a session uses an external ACP agent (OpenCode, Claude Code, Grok Build, …),
hip acts as the ACP **client**. Host-side policy lives in `hip.toml` under `[acp]`:

```toml
[acp]
fsBridge = true          # advertise + serve fs/read_text_file & fs/write_text_file (default true)
forwardMcp = false       # forward enabled hip/plugin MCP servers into session/new (default false)
fsReadMaxBytes = 2000000 # max bytes per fs/read_text_file (default 2_000_000)
```

Snake_case aliases (`fs_bridge`, `forward_mcp`, `fs_read_max_bytes`) are accepted.
Project `.hip/hip.toml` **wholesale-replaces** the global `[acp]` section (same
rule as `[agentLoop]`).

**MCP forward security note:** `forwardMcp` defaults to **false** so hip does not
silently hand MCP commands, env vars, or HTTP headers (including API keys) to an
external agent process. When set to `true`, enabled servers from hip.toml
`mcpServers` **and** enabled plugins are mapped into ACP `session/new` /
`session/load` (`stdio` always; `http`/`sse` only if the agent advertised those
MCP capabilities). Hip tool allow/deny lists (`enabledTools` / `disabledTools`)
are **not** forwarded — the agent sees the full MCP surface.

### Local data layout (`~/.hip/`)

| Path | Purpose |
|------|---------|
| `~/.hip/config/` | `auth.json`, `hip.toml`, network policy (mode `0600` where applicable) |
| `~/.hip/config/terminal-hosts.json` | SSH / terminal host library (mode `0600`) |
| `~/.hip/db/hip.db` | SQLite sessions, messages, agent runs, tools, events |
| `~/.hip/data/tool-output/` | Large tool outputs (kept out of the DB) |
| `~/.hip/logs/` | Sidecar / Tauri logs |
| `~/.hip/skills/`, `plugins/`, `scratch/` | Skills, plugins, install scratch |
| `~/.hip/memories/` | Markdown export mirrors when memory is enabled |
| `~/.hip/work-items/` | Work item catalog (`catalog.json`) + UI prefs |
| `~/.hip/automations/` | Automations catalog + runs log (`catalog.json`, `runs.json`; mode `0600`) |
| `~/.hip/knowledge/` | Local-first knowledge base spaces/docs (FS content) |
| `~/.hip/trash/` | Product recycle bin quarantine (knowledge FS payloads; sessions use SQLite `deleted_at`) |

### Recycle bin (soft-delete)

In the **desktop UI**, deleting Chat/Code sessions or Knowledge spaces/docs moves them to **Recycle bin** (sidebar, above History). Items can be restored or permanently deleted; they auto-purge after a retention period.

| Setting | Location |
|---------|----------|
| Retention days (default **7**, range 1–365) | **Settings → General**, or `~/.hip/config/hip.toml` → `[trash] retentionDays = 7` |

- **UI delete** → soft-delete (recoverable).
- **CLI** `hip session delete <id> --yes` → **permanent** hard-delete (does not use the recycle bin).
- **Memory** trash remains under **Settings → Memory** (separate 30-day default).

### Window close & system tray

By default, closing the main window **quits** hip (sidecar, agents, and CLI attach stop). Under **Settings → General → Window & background** you can:

| Option | Effect |
|--------|--------|
| **Hide to system tray** | Close hides the window; agents / terminals / sidecar keep running. Tray left-click or **Show hip** restores; **Quit** exits cleanly. |
| **Quit hip** | Close exits (historical default). |
| **Ask every time** | Prompt on each window close (optional). |
| **System tray icon** | Show a tray icon (auto-enabled when choosing hide). |

First close (until you save a preference) shows a one-time chooser. Quitting while agents/tasks are running asks for confirmation; you can hide to tray instead.

```toml
# ~/.hip/config/hip.toml
[window]
closeAction = "hide"   # hide | quit | ask (ask UI is Phase 2)
trayEnabled = true
```

- **Cmd+Q** / application Quit always exits (never hide-only).
- Hide mode: product CLI (`hip doctor` / `session` / `run`) still attaches to the running desktop app.
- Escape hatch: `HIP_TRAY=0` forces quit-on-close and disables tray.
- Release builds are single-instance (second launch focuses the existing window). Dev allows multiple instances; set `HIP_ALLOW_MULTI_INSTANCE=1` in release to override.
- **Launch at login** and **notify when agents finish** (while hidden) are optional under the same settings section. Login-item launches pass `--autostart` and default to starting hidden in the tray.

```bash
# Optional: reclaim free pages after large permanent deletes (app must be closed)
sqlite3 ~/.hip/db/hip.db 'VACUUM;'
```

### Useful scripts

| Command | Description |
|---------|-------------|
| `yarn tauri dev` | Run the full desktop app in dev mode |
| `yarn sidecar:dev` | Run the sidecar WS server standalone (prints its port) |
| `yarn sidecar:dev-bin` | (Re)generate the dev sidecar wrapper in `src-tauri/binaries/` |
| `yarn cli:dev` | Product CLI (`hip doctor` / `session` / `run` / `repl`) — **requires running hip app** |
| `yarn cli:test` | CLI unit tests (no paid LLM) |
| `yarn type-check` | Type-check the frontend |
| `yarn workspace @hip/sidecar type-check` | Type-check the sidecar |
| `yarn test` | Frontend + unit tests (Vitest) |
| `yarn product:content` | Regenerate agent/UI product content embeds |

### Product CLI (`@hip/cli`)

Attach-only companion for the **running** hip desktop app (shared sidecar +
`~/.hip` data).

There is **no** separate SDK package — scripts should call `hip … --json`.
CLI does **not** start the product sidecar; start the app first or commands fail
with `APP_NOT_RUNNING` (exit 3).

```bash
# Start the desktop app, then:

# Health: discovery file + attach + hasApiKey
yarn cli:dev doctor

# Auth keys present? (never prints secrets)
yarn cli:dev config auth-status

# One-shot run against the live app (HipRunResult JSON)
yarn cli:dev run --stream none \
  --json --output /tmp/hip-out/result.json \
  "Reply with exactly: pong"

# Human stream modes: text | tools | all | none
yarn cli:dev run --stream all "summarize README.md"

# Sessions (shared with GUI)
yarn cli:dev session list
yarn cli:dev session show <id-prefix> --limit 20
# Permanent hard-delete (not the UI recycle bin)
yarn cli:dev session delete <id> --yes

# Interactive multi-turn REPL (TTY; HITL prefers GUI when present)
yarn cli:dev repl --cwd .
```

| Flag / command | Meaning |
|----------------|---------|
| `doctor` | Attach health (requires running app) |
| `--json` / `--output` | `HipRunResult` schemaVersion 1 |
| `--out-dir` | `result.json`, `trace.jsonl`, `patch.diff`, `usage.json` |
| `--stream` | Human transcript (text \| tools \| all \| none) |
| `--hitl auto` | Auto-approve tool permissions (**bypasses GUI**) |
| `--hitl prompt` | Wait for GUI or TTY when no GUI client |
| `session *` | List/show/send; `session delete` is **permanent** (UI soft-deletes to recycle bin) |
| `repl` | Multi-turn interactive chat |
| `HIP_CLI_DEV_SPAWN=1` | Dev only: isolated spawn (never product DB) |

## Memory

Cross-session memory is **off by default**. Enable under **Settings → Memory**.
SQLite is the source of truth; `~/.hip/memories/` holds markdown export mirrors.
Product copy for the agent (and optional maintainer reading): [packages/product-content/references/memory.md](./packages/product-content/references/memory.md).

## Recommended IDE setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Product content (agent embeds)

Builtin product / coding skills are embedded for the agent (not a user-facing Help page in the repo sense — Settings Help uses localized bodies).

Source of truth (not under `docs/`):

- Product: [packages/product-content/](./packages/product-content/)
- Coding / delegation ops skill: [packages/product-content/ops/](./packages/product-content/ops/)
- UI locales: `packages/product-content/locales/zh-CN/`, `zh-TW/`, `ja/`, `ko/`

Regenerate embeds after editing those trees: `yarn product:content`.

Repo root `docs/` (if present) is optional developer notes only and is never read by the app.

## Documentation languages

| Language | File |
|----------|------|
| English | [README.md](./README.md) |
| 简体中文 | [README.zh-CN.md](./README.zh-CN.md) |
| 繁體中文 | [README.zh-TW.md](./README.zh-TW.md) |
| 日本語 | [README.ja.md](./README.ja.md) |
| 한국어 | [README.ko.md](./README.ko.md) |

English is the default for GitHub and agent-facing product embeds. Keep technical identifiers (paths, CLI flags, tool names) identical across locales.

App UI languages (Settings → Interface Language): **English**, **简体中文**, **繁體中文**, **日本語**, **한국어**.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, tests, and PR expectations.  
Please read the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Security

Report vulnerabilities privately — see [SECURITY.md](./SECURITY.md).  
Do not open public issues for security reports.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md). Maintainer release steps: [docs/release.md](./docs/release.md).

## License

Copyright 2026 ljm

Licensed under the [MIT License](./LICENSE).
