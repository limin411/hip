# hip Self-Architecture Research Summary

**Date:** 2026-07-05  
**Scope:** Architecture, features, agent orchestration, UI, extensibility, and limitations of the `hip` project as found in its own codebase at `/Users/lijiamin/data/my-github/hip`.  
**Sources:** File paths cited inline; no external web research was needed because the assigned focus is the project itself.

---

## 1. Core Value Proposition

`hip` is a Tauri-based desktop AI workbench that runs a local Node.js sidecar to drive LangGraph agents. It targets a Claude-Code-Desktop / Codex-Desktop-like experience: multi-tab chat/code sessions, file editing, tool use, sub-agent delegation, plan/approve workflows, and MCP-based extensibility — all while keeping API keys and config on the local machine.

Key pitch from the README: *“A desktop AI agent app … A single Node.js sidecar process manages multiple LangGraph agent instances; each UI tab is an independent session, and within a session a Supervisor agent delegates sequentially to sub-agents (Planner → Coder → Reviewer) via the deepagents `task` tool.”* [`README.md:1-8`]

---

## 2. Runtime Architecture

Three processes cooperate at runtime:

| Process | Technology | Role |
|---|---|---|
| Desktop shell | Rust + Tauri v2 (`src-tauri/`) | Window management, sidecar lifecycle, native file/config commands, secure secret store |
| Frontend | React 18 + Vite + TypeScript + Tailwind (`src/`) | Tabs, chat, artifact/diff panels, settings |
| Sidecar | Node.js + TypeScript + LangGraph (`packages/sidecar/`) | Agent runtime, WebSocket server, tools, MCP client |

[`README.md:11-18`], [`CLAUDE.md:10-18`]

Communication flow:
1. Tauri spawns the sidecar binary via `tauri-plugin-shell` on startup. [`src-tauri/src/sidecar.rs:21-73`]
2. The sidecar prints `{"port":NNNN,"token":"..."}` to stdout; Rust captures it and exposes `get_sidecar_info`. [`src-tauri/src/sidecar.rs:11-19`], [`src-tauri/src/lib.rs:598-604`]
3. The React frontend opens a WebSocket to `ws://localhost:NNNN` using the token. [`src/routes/AppLayout.tsx:36`]
4. Tauri commands bridge filesystem/config operations (config read/write, secret storage, skill/plugin install). [`src-tauri/src/lib.rs`]

---

## 3. Feature Set

### Session surfaces
- **Chat** — sandboxed, read-only conversation (no file writes). [`packages/protocol/src/index.ts:6-9`]
- **Code** — conversation bound to a working directory with file tools, git integration, diff/artifact panels. [`packages/protocol/src/index.ts:37-40`]
- Each tab is an independent session with its own message history, config, and working directory.

### Chat / agent UX
- Streaming tokens and reasoning bursts. [`packages/sidecar/src/session/session.ts:1204-1212`]
- Tool-call timeline with per-step status, input/output clipping, and truncation flags. [`packages/protocol/src/index.ts:298-310`], [`packages/protocol/src/index.ts:345-348`]
- Plan approval UI (`plan:published`, `agent:interrupt` with plan context). [`packages/sidecar/src/session/session.ts:1403-1417`]
- Session history, title generation, regenerate, resume from interrupt. [`packages/sidecar/src/session/session.ts:349-359`], [`packages/sidecar/src/session/session.ts:877-946`], [`packages/sidecar/src/session/session.ts:1582-1634`]
- Multimodal attachments: images/PDFs are staged; if the main model is text-only, an internal multimodal agent preprocesses them. [`packages/sidecar/src/session/session.ts:679-776`]

### Git / checkpointing
- Workspace diff, per-file diff, commit log, branch switch, snapshot capture, checkpoint revert. [`packages/sidecar/src/session/session.ts:459-472`]
- Checkpoints are persisted under the project `.hip/` tree.

### Security / permissions
- Claude-Desktop-style permission modes: `chat` (read-only), `edit` (write in cwd, HITL for run_script), `full` (un-jailed, auto-approve). [`packages/protocol/src/index.ts:1-12`]
- HITL approval modal with sticky allow/always-reject options. [`packages/protocol/src/index.ts:31-32`]
- API keys stored as plaintext in `~/.hip/config/auth.json` with `0600` permissions by design. [`README.md:38-42`], [`src-tauri/src/auth.rs:14-52`]

---

## 4. Agent Orchestration

### The main loop
The sidecar builds a LangGraph `StateGraph` per session:

```
START → compact → agent → (conditional) → tools → (conditional) → compact/END
```

[`packages/sidecar/src/session/graph.ts:478-492`]

Nodes:
- `compact` — micro-compaction + token-budget compaction (summarize middle messages). [`packages/sidecar/src/session/graph.ts:161-195`]
- `agent` — model call; streams tokens/reasoning/usage; handles plan-mode reminders. [`packages/sidecar/src/session/graph.ts:197-281`]
- `tools` — executes tool calls; read tools parallelized, write/execute sequential; supports deferred results. [`packages/sidecar/src/session/graph.ts:303-435`]
- `nudge` / `pause` — doom-loop detection and user interrupt. [`packages/sidecar/src/session/graph.ts:438-445`]
- `planPause` — waits for user approval after plan generation. [`packages/sidecar/src/session/graph.ts:447-449`]

### Sub-agents
Two delegation mechanisms exist:

1. **`task` tool** — spawns a fresh depth-1 sub-agent (`worker` role) using the same model/tools; can run in foreground or background (max 10 concurrent). Background tasks are persisted and reconciled after sidecar restart. [`packages/sidecar/src/session/tools/subagent.ts:24-38`], [`packages/sidecar/src/session/session.ts:1215-1232`], [`packages/sidecar/src/session/background-manager.ts`]
2. **`dispatch_agent` tool** — delegates to a configured specialized agent (`subagent` role): internal (hip loop), ACP, OpenCode, or custom CLI. [`packages/sidecar/src/session/tools/subagent.ts:97-112`], [`packages/sidecar/src/session/agents/invoker.ts:102-154`]

The README’s advertised “Supervisor → Planner → Coder → Reviewer” pipeline is implemented as sub-agent delegation: the supervisor turn can call `task`/`dispatch_agent` to run planning, coding, and review agents sequentially. [`README.md:6-7`]

### Planning modes
- `fast` — no explicit plan.
- `plan` — forces plan generation, user approval, and execution against a todo list (`write_todos`). [`packages/sidecar/src/session/graph.ts:207-226`]
- Per-session `forcePlan` / `disablePlan` flags and an agent profile system (`plan` profile) control this. [`packages/protocol/src/index.ts:34-36`]
- A multi-mode planner module supports adaptive planning and reactive re-planning after tool errors. [`packages/sidecar/src/session/planner.ts`]

### Agent profiles
`AgentProfileManager` lets users select profiles that narrow allowed/blocked tools, e.g. a read-only or planning profile. [`packages/sidecar/src/session/session.ts:490-492`], [`packages/sidecar/src/session/agent-profile.ts`]

---

## 5. Tooling

Tool assembly is centralized in `buildAllTools`:

| Category | Tools | Source |
|---|---|---|
| File | `read_file`, `write_file`, `edit_file`, `ls`, `glob`, `grep` | `packages/sidecar/src/session/tools/file.ts` |
| Planning | `write_todos` | `packages/sidecar/src/session/tools/planning.ts` |
| Git | `git_commit`, `workspace_diff`, `revert_checkpoint`, etc. | `packages/sidecar/src/session/tools/git.ts` |
| Sub-agent | `task`, `task_batch`, `task_retry`, `task_stop`, `task_output`, `dispatch_agent` | `packages/sidecar/src/session/tools/subagent.ts` |
| Skill | `use_skill` | `packages/sidecar/src/session/tools/skill.ts` |
| Web | `web_search`, `web_fetch` | `packages/sidecar/src/session/tools/web.ts` |
| Script | `run_script`, `generate_agent` | `packages/sidecar/src/session/tools/script.ts` |
| Media | `read_media` | `packages/sidecar/src/session/tools/media.ts` |
| Plan mode | `EnterPlanMode`, `ExitPlanMode` | `packages/sidecar/src/session/tools/enter-plan-mode.ts`, `exit-plan-mode.ts` |
| Plugin | `plugin_install` | `packages/sidecar/src/session/tools/plugin.ts` |

[`packages/sidecar/src/session/tools/index.ts:27-124`]

Permission modes filter the toolset at assembly time (`chat` drops write/edit tools). Profile-level `allowedTools`/`blockedTools` further narrow. MCP tools bypass `allowedTools` but can still be blocked. [`packages/sidecar/src/session/tools/index.ts:57-122`]

---

## 6. Extensibility: Skills, Plugins, and MCP

### Skills
- Skills are Markdown folders (`SKILL.md` + optional `scripts/`, `references/`, `assets/`). [`src-tauri/src/skills.rs:57-107`]
- Scopes: global (`~/.hip/skills/`), project (`.hip/skills/`), plugin. Project overrides global. [`src-tauri/src/skills.rs:322-348`]
- Frontmatter declares name, description, allowed/disallowed tools, context (`inline`/`fork`), model override, arguments, shell, auto-invoke, etc. [`src-tauri/src/skills.rs:111-144`]
- `use_skill` injects the skill body into the system prompt. [`packages/sidecar/src/session/tools/skill.ts`]

### Plugins
- Plugin bundles contain `.plugin/plugin.json` and can ship skills, MCP servers, agents, and hooks. [`packages/protocol/src/index.ts:128-149`]
- Rust scans installed plugins and registers them in `hip-plugins.json`. [`src-tauri/src/plugins.rs:44-86`], [`src-tauri/src/plugins.rs:389-438`]
- The sidecar loads plugin components via `ConfigManager.loadPluginComponents()`. [`packages/sidecar/src/session/session.ts:411`]

### MCP
- Resident `McpManager` singleton maintains connections to stdio/SSE/HTTP MCP servers. [`packages/sidecar/src/session/mcp/manager.ts:99-102`]
- Reconciles server list per turn, exponential backoff on failure, exposes connection status to UI. [`packages/sidecar/src/session/mcp/manager.ts:210-252`]
- Tools namespaced as `mcp__<server>__<tool>`; lazy-loading switches to `mcp_search` + `mcp_invoke` proxies when tool count exceeds threshold. [`packages/sidecar/src/session/mcp/manager.ts:608-650`]
- Supports MCP resources and prompts. [`packages/sidecar/src/session/mcp/manager.ts:653-735`]
- stdio commands are allow-listed to `/usr/bin`, `/usr/local/bin`, `/opt`, and `~/.hip/bin`. [`packages/sidecar/src/session/mcp/manager.ts:169-186`]

### External agents
Agents can be:
- `internal` — runs hip’s own LangGraph loop with a bound model and prompt.
- `acp` / `opencode` / `custom` — external CLI processes invoked via `AgentProvider`. [`packages/protocol/src/index.ts:73-97`]
- The invoker narrows `allowedSkills` and `allowedMcpServers` per agent config. [`packages/sidecar/src/session/agents/invoker.ts:113-126`]

---

## 7. UI Capabilities

- **Router:** hash-based React Router (`/login`, `/app`). [`src/App.tsx:11-15`]
- **Layout:** resizable panels (chat/main left, artifact/preview right), title bar with tab bar, floating avatar for history/settings. [`src/routes/AppLayout.tsx`]
- **Chat pane:** streaming messages, reasoning bubbles, tool-call rows, plan approval cards, slash-command palette, composer with attachment support, model picker, permission mode picker. [`src/components/chat/`]
- **Artifact panel:** file tree, file preview, diff display, branch switcher, git-init banner. [`src/components/artifact/`]
- **Settings:** providers, model config, MCP servers, skills, plugins, agent management, general settings. [`src/components/account/`]
- **i18n:** English, Simplified Chinese, Traditional Chinese. [`src/i18n/`]

---

## 8. Configuration & State

- Unified TOML config: `~/.hip/config/hip.toml`; project-level override at `.hip/hip.toml`. [`packages/sidecar/src/config/hip-config.ts:208-216`]
- Config includes providers, active model, MCP servers, skills, agents, and permissions. [`src-tauri/src/lib.rs:206-222`]
- Rust is the single source of truth for secrets; sidecar receives provider keys via env vars and the config path via `HIP_CONFIG_PATH`. [`src-tauri/src/sidecar.rs:23-63`]
- Session persistence uses SQLite with event-sourced `session_message` projection plus snapshots. [`packages/sidecar/src/persistence/`], [`packages/sidecar/src/session/session.ts:1516-1544`]

---

## 9. Obvious Limitations

1. **No built-in vector / RAG retrieval.** There is no embedding store, semantic search, or long-term memory beyond the SQLite message history and skill reference files.
2. **No native collaboration / sharing.** Sessions, checkpoints, and config are local-only; no multi-user sync, export/import of sessions, or shared team skills catalog.
3. **API key security is plaintext-by-design.** Keys live in `~/.hip/config/auth.json` (file mode `0600`) rather than the OS keychain. This is documented and intentional but a gap versus keychain-backed competitors. [`README.md:38-42`]
4. **MCP stdio allowlist is narrow.** Only `/usr/bin`, `/usr/local/bin`, `/opt`, and `~/.hip/bin` are permitted; users cannot easily point stdio servers elsewhere without copying binaries. [`packages/sidecar/src/session/mcp/manager.ts:174`]
5. **Agent orchestration is flat, not a true DAG.** The graph is a single supervisor loop with depth-1 `task`/`dispatch_agent`; there is no native multi-step workflow DAG, parallel branch merging, or reviewer gate that blocks coder automatically. The Planner→Coder→Reviewer pipeline is delegated sequentially, not enforced structurally. [`packages/sidecar/src/session/graph.ts:478-492`], [`packages/sidecar/src/session/tools/subagent.ts:24-38`]
6. **Limited context management.** Compaction is token-budget driven with summarization; there is no explicit token-window truncation strategy or prompt caching integration.
7. **Model compatibility gate.** The built-in loop requires an OpenAI-compatible provider; non-compatible providers are rejected. [`packages/sidecar/src/session/session.ts:621-631`]
8. **Skills lack sandboxed execution.** `use_skill` injects markdown into the prompt; `scripts/` are run via `run_script` under the session permission mode, not in an isolated sandbox.

---

## 10. Top 5 Findings for Feature-Gap Comparison

1. **No Retrieval / Long-Term Memory Layer**  
   hip has no embeddings, vector DB, or semantic retrieval. A competitor with RAG over local files, previous sessions, or a knowledge base would be a clear gap. [`grep for “embedding”, “vector”, “retrieval” returned no hits in packages/sidecar/src/session/`]

2. **Flat, Prompt-Driven Multi-Agent Flow Rather Than Structured DAG Orchestration**  
   The Supervisor→Planner→Coder→Reviewer pipeline relies on the LLM choosing `task`/`dispatch_agent` tools in sequence. There is no enforced DAG state machine, reviewer block, or automatic rework loop. [`packages/sidecar/src/session/tools/subagent.ts:24-38`], [`packages/sidecar/src/session/graph.ts:478-492`]

3. **Local-Only, No Collaboration or Sync**  
   Sessions and skills are stored locally under `~/.hip` and the project `.hip/` folder. There is no cloud sync, team workspace, or session sharing. [`src-tauri/src/paths.rs` inferred from lib.rs usage; no sync modules found.]

4. **Plainsight API Key Storage**  
   API keys are deliberately kept in a plaintext JSON file. Competing products that use OS keychain / secure enclave would differentiate on security posture. [`README.md:38-42`], [`src-tauri/src/auth.rs`]

5. **Extensibility Is Strong but Admin-Heavy**  
   MCP, skills, plugins, and external agents provide broad extensibility, but stdio MCP servers are restricted to a short allowlist and plugin install is manual (zip + manifest). A competitor with one-click marketplace / auto-discovery would have lower friction. [`packages/sidecar/src/session/mcp/manager.ts:169-186`], [`src-tauri/src/plugins.rs:44-86`]

---

*End of report.*
