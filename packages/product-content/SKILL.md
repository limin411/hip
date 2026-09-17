# hip

hip is a **desktop AI workbench** (Tauri shell + React UI + Node sidecar), product version **{{HIP_PRODUCT_VERSION}}**. Each UI tab is an independent session. The default product loop is a **Supervisor ReAct** agent that uses tools and may delegate with `task` / `dispatch_agent` / `task_batch` — there is no forced Planner → Coder → Reviewer pipeline on ordinary turns.

This skill is the authoritative product guide for *hip itself*. For ordinary coding work in the user's project, do **not** load this skill.

Answer product questions in the **user's language** (e.g. Chinese if they wrote in Chinese), but keep config paths and identifiers exact.

## Progressive disclosure

- **Level 1** (system prompt Skills list): name + description only
- **Level 2** (this file): overview below, loaded via `use_skill({ name: "hip" })`
- **Level 3**: deeper topics in `references/` — read those absolute paths with `read_file` when needed

If a product detail is not documented here, say so rather than inventing UI labels or config keys.

## Surfaces

| Surface | Intent |
|---------|--------|
| **Code** | Project workbench (sidebar **Projects**): file tools, git guidance, MCP catalog, full agent tools, async TaskRuntime |
| **Chat** | Lighter conversation surface (sidebar **Chats**): shorter prompt, no git-commit guidance, prefer writing previewable deliverables (`page.html`, `notes.md`, SVG, etc.) into the workspace for the artifacts panel |
| **Terminals** | Managed terminal / SSH host surface (sidebar **Terminals**): interactive shells on local or remote hosts; the terminal rail has **Files** and **Agent** tabs |

There is no notes / Documents surface. Surface is chosen in the UI; the system prompt already reflects the active surface.

## Permission modes

| Mode | Effect |
|------|--------|
| **edit** (default) | Filesystem tools sandboxed to the project root |
| **chat** | Read-only: no write/edit/script/git mutations |
| **full** | Un-sandboxed filesystem (user-granted); prefer absolute paths |

Path convention in edit/chat: project-root form starting with `/` (e.g. `/src/index.ts` maps to `<cwd>/src/index.ts`). Never invent shell tool names — use `run_script` when available.

## Settings (desktop UI)

Typical destinations (wording may vary slightly in the UI):

- **Model Configuration** / **Key Management** — provider list, model picker, and API keys; keys are stored as plaintext under `~/.hip/config/auth.json` (mode 0600 by design)
- **Memory** — cross-session memory is **off by default**; enable under Settings → Memory (see `references/memory.md`)
- **Skills** — enable/disable installed skills (`hip.toml` + skill folders)
- **Plugin Market** — install/enable plugins (skills, agents, MCP, hooks) and browse the official markets
- **Agent Management** — fixed profiles (supervisor / plan / explore / coder) and custom internal or external agents
- **MCPs**, **Hooks**, **General**, **Window** — remaining pages
- **Network policy** — file-only (`~/.hip/config/network.json`); there is **no** Settings page for it

## Session right rail

On **Code**, the right rail tabs are **Files / Outline / Changes / Terminal** (Changes requires a git repo; Terminal requires an active session). Sub-agents and running background work are **not** in a separate panel:

- Sub-agent and tool process render inline in the message trail.
- Background shell jobs, monitors and schedules surface in the runtime strip above the composer; open it to inspect output or stop a task.

Long shell, log watches, and recurring checks should use TaskRuntime tools (see `references/agents-and-plugins.md` and the `hip-coding` skill for policy). Do not sleep-poll in the main turn.

## Scheduled tasks

Recurring prompts are **per conversation**: create them from the clock button in the composer (Chat and Code). The run happens **inside the conversation that owns the task** — hip does not open a new conversation for each fire, and deleting that conversation deletes its scheduled tasks. Agent-side tools are `scheduler_create` / `scheduler_list` / `scheduler_delete` (minimum interval 60s).

## Skills, plugins, MCP

- **Skills**: Claude-format folders with `SKILL.md`. Global: `~/.hip/skills/<id>/`. Project: `.hip/skills/<id>/`. Progressive disclosure: L1 metadata → `use_skill` body → `references/` + `assets/`.
- **Plugins**: under `~/.hip/plugins/`; can contribute skills, agents, MCP servers, and hooks. See `references/agents-and-plugins.md`.
- **MCP**: configured servers expose tools. In Code surface the system prompt may list a catalog; use `mcp_search` then call namespaced tools `mcp__<server>__<tool>`.

## Agents & delegation

- Default session agent decides when to use tools or delegate.
- Prefer specialized roster agents when available: **explore** (read-only search), **plan** (design-only), **coder** (implementation).
- Parallel independent sub-tasks → one `task_batch` (not sequential `dispatch_agent`).
- Long-running shell / CI / periodic work → TaskRuntime (`run_script` background, `monitor`, `scheduler_*`) rather than blocking the main turn.
- Explicit workflows / multi-agent handoff exist but are **not** the ordinary product path.
- Depth: `references/agents-and-plugins.md`.

## CLI (`@hip/cli`)

Attach-only companion to a **running** hip app (shared sidecar + `~/.hip` data). Does not start the product sidecar.

```bash
yarn cli:dev doctor
yarn cli:dev config auth-status
yarn cli:dev session list
yarn cli:dev run --stream none --json "Reply with exactly: pong"
yarn cli:dev repl --cwd .
```

If the app is not running, CLI fails with `APP_NOT_RUNNING`.

## Project guidance files

When present under the project, hip may inject guidance such as `AGENTS.md` / `Claude.md` / `.hip` config. Prefer following those for **project** conventions; this skill is for **product** behavior.

## Level 3 references

After loading this skill, `use_skill` returns absolute paths. When the user needs depth:

- Memory enablement, inject, extract, privacy → `references/memory.md`
- Local data layout, config files, env overrides → `references/config-and-data.md`
- Common failures (no key, CLI not running, empty memory) → `references/troubleshooting.md`
- Agents, plugins, MCP, TaskRuntime tools → `references/agents-and-plugins.md`
