# Competitive Research: OpenAI Codex Desktop

**Date:** 2026-07-05  
**Scope:** Real-world product research (Codex Desktop is *not* `hip` self-architecture).  
**Sources:** Official OpenAI Codex docs, engineering blog posts, and the open-source Codex CLI repo.

---

## Core value proposition

Codex Desktop is positioned as a **command center for coding agents**. Instead of a single chat-based assistant, the app lets developers run, supervise, and coordinate multiple AI agents across projects and threads, using built-in Git worktrees to keep parallel work isolated [[OpenAI – introducing the Codex app](https://openai.com/index/introducing-the-codex-app/)]. The same Codex identity (ChatGPT account or API key) spans the desktop app, CLI, IDE extension, and cloud, so work can move between surfaces [[OpenAI – Codex overview](https://openai.com/codex/)].

## Key features

| Feature | Summary |
|--------|---------|
| **Parallel threads / projects** | Run project threads side-by-side and switch between them quickly [[Codex app docs](https://developers.openai.com/codex/app)] |
| **Git worktrees** | Each parallel task can work in its own worktree to avoid merge conflicts [[Codex app features](https://developers.openai.com/codex/app/features)] |
| **Integrated terminal & Git tools** | Per-thread terminal, diff pane, inline review comments, stage/revert, commit/push/PR creation [[Codex app features](https://developers.openai.com/codex/app/features)] |
| **In-app browser** | Preview local dev servers and public pages; add visual comments for Codex to address [[Codex app features](https://developers.openai.com/codex/app/features)] |
| **Computer use** | Operate macOS/Windows GUI apps by seeing, clicking, and typing; useful for native-app testing and GUI-only bugs [[Codex app features](https://developers.openai.com/codex/app/features)] |
| **Automations** | Schedule recurring tasks that run in background worktrees and put results in a review queue [[Codex app features](https://developers.openai.com/codex/app/features)] |
| **Skills & plugins** | Reusable `SKILL.md` workflows; plugins bundle skills, app integrations, and MCP servers [[Agent skills docs](https://developers.openai.com/codex/skills)] [[Plugins docs](https://developers.openai.com/codex/plugins)] |
| **Remote connections** | Start/steer/approve Codex work from the ChatGPT mobile app, or connect to SSH hosts and hand threads between devices [[Remote connections docs](https://developers.openai.com/codex/remote-connections)] |
| **Memory** | Optional local memory carries stable preferences, conventions, and pitfalls across threads [[Memories docs](https://developers.openai.com/codex/memories)] |
| **Cross-surface sync** | Threads, settings, and auto-context sync between the Codex app and the IDE extension [[Codex app features](https://developers.openai.com/codex/app/features)] |

## Agent architecture

Codex is fundamentally a **thread-per-agent** system:

- Each thread hosts one or more agent turns; the app lets users run multiple threads across projects in parallel [[OpenAI – introducing the Codex app](https://openai.com/index/introducing-the-codex-app/)].
- **Subagent workflows** spawn specialized agents in parallel and consolidate their results. Codex only spawns subagents when the user explicitly asks for them, because each subagent consumes additional tokens [[Subagents docs](https://developers.openai.com/codex/subagents)].
- Built-in agent roles include `default`, `worker`, and `explorer` [[Subagents docs](https://developers.openai.com/codex/subagents)].
- Custom agents are defined as standalone TOML files under `~/.codex/agents/` (personal) or `.codex/agents/` (project-scoped), with fields for `name`, `description`, `developer_instructions`, model, reasoning effort, sandbox mode, MCP servers, and skills [[Subagents docs](https://developers.openai.com/codex/subagents)].
- Concurrency guards are configurable: `agents.max_threads` defaults to 6 and `agents.max_depth` defaults to 1 to prevent runaway recursive delegation [[Subagents docs](https://developers.openai.com/codex/subagents)].

## Desktop integration

Codex Desktop is a **native macOS and Windows application** (Linux is not officially supported):

- It runs agents in **Local** (project directory), **Worktree** (isolated Git worktree), or **Cloud** (hosted container) modes [[Codex app features](https://developers.openai.com/codex/app/features)].
- On Windows it runs natively in PowerShell with a native sandbox rather than requiring WSL or a VM [[Codex app features](https://developers.openai.com/codex/app/features)].
- The app has a floating pop-out window, voice dictation, notifications, sleep-prevention, and IDE-extension auto-context [[Codex app features](https://developers.openai.com/codex/app/features)].
- **Appshots** let users send the frontmost Mac app window (screenshot + text) to Codex for context [[Codex app docs](https://developers.openai.com/codex/app)].
- A **Chrome extension** allows Codex to use the user’s signed-in browser state for tasks that require authentication [[Codex app features](https://developers.openai.com/codex/app/features)].

## Context / retrieval

Codex layers several context mechanisms:

- **`AGENTS.md`** — durable project guidance that loads automatically, can live at repo root or in nested directories, and travels with the repository [[Customization docs](https://developers.openai.com/codex/concepts/customization)].
- **Memories** — optional local memory files generated from idle prior threads; off by default in EEA/UK/CH and can be enabled via settings or `config.toml` [[Memories docs](https://developers.openai.com/codex/memories)].
- **Web search** — built-in first-party web search, cached by default for local tasks and live when full-access sandbox is enabled [[Codex app features](https://developers.openai.com/codex/app/features)].
- **Skills references** — skills can include `references/` (docs) and `assets/` (templates/resources) that Codex reads only when the skill is selected [[Agent skills docs](https://developers.openai.com/codex/skills)].
- **MCP resources** — external systems can expose readable data and reusable prompt templates through MCP [[Customization docs](https://developers.openai.com/codex/concepts/customization)].
- **Computer-use screenshots / Appshots** — visual context from the desktop or a specific app window [[Codex app features](https://developers.openai.com/codex/app/features)].

## Extensibility (MCP / tools / skills / plugins)

Codex has a rich, layered extension model:

- **Skills** are the authoring format: a directory with a `SKILL.md` plus optional `scripts/`, `references/`, `assets/`, and `agents/openai.yaml` for UI metadata and MCP dependencies [[Agent skills docs](https://developers.openai.com/codex/skills)].
- **Plugins** are the distribution format: they bundle one or more skills with app mappings, MCP server configuration, and presentation assets, and can be shared via a marketplace source [[Plugins docs](https://developers.openai.com/codex/plugins)].
- **MCP** is the standard tool-integration protocol; Codex supports STDIO and Streamable HTTP servers with OAuth, and MCP servers expose tools, resources, and prompts [[Customization docs](https://developers.openai.com/codex/concepts/customization)].
- **Hooks** allow deterministic scripts to run at lifecycle events (e.g., `PreToolUse`) from `hooks.json` or `config.toml` [[Advanced config docs](https://developers.openai.com/codex/config-advanced)].
- **Custom model providers** can be defined in `config.toml`, including local OSS providers such as Ollama/LM Studio, Azure, Amazon Bedrock, and proxies [[Advanced config docs](https://developers.openai.com/codex/config-advanced)].
- The **Codex App Server** exposes a protocol for embedding Codex into other products [[App server docs](https://developers.openai.com/codex/app-server)].
- The **Codex CLI** is open-source (Apache 2.0) and available on GitHub [[openai/codex repo](https://github.com/openai/codex)].

## Security / permissions model

Security is a first-class design concern:

- **OS-level sandboxing** is the default across app, CLI, and IDE:
  - macOS uses Seatbelt.
  - Linux uses seccomp/bubblewrap.
  - Windows uses a custom sandbox with synthetic SIDs, write-restricted tokens, and dedicated `CodexSandboxOffline`/`CodexSandboxOnline` Windows users plus firewall rules to enforce network restrictions [[OpenAI – building the Codex Windows sandbox](https://openai.com/index/building-codex-windows-sandbox/)].
- **Approval policies** determine when Codex pauses for permission (`untrusted`, `on-request`, `never`, or granular). Sandbox modes govern file/network access (`workspace-write`, `read-only`, or `danger-full-access`) [[Advanced config docs](https://developers.openai.com/codex/config-advanced)].
- Network access is **disabled by default** in the sandbox; outbound access must be explicitly approved or configured [[OpenAI – building the Codex Windows sandbox](https://openai.com/index/building-codex-windows-sandbox/)].
- Project-local config (`.codex/config.toml`, hooks, rules) loads only when the project is **trusted** [[Advanced config docs](https://developers.openai.com/codex/config-advanced)].
- Enterprise workspaces can deploy **managed `requirements.toml` policies**, RBAC controls, access tokens, audit logging, and zero-data-retention options [[Enterprise admin setup docs](https://developers.openai.com/codex/enterprise/admin-setup)].

## Collaboration / sharing

- **Team skills** can be checked into a repository under `.agents/skills` so they travel with the codebase and onboard new teammates [[Best practices docs](https://developers.openai.com/codex/learn/best-practices)].
- **Plugins** can be published through marketplace sources and shared within a ChatGPT workspace [[Plugins docs](https://developers.openai.com/codex/plugins)].
- **GitHub PR reviews** can be automated or triggered with `@codex review`; OpenAI reportedly uses Codex to review 100% of its own PRs [[Best practices docs](https://developers.openai.com/codex/learn/best-practices)].
- **Linear and Slack integrations** let users start Codex tasks from issues or channels [[Codex docs index](https://developers.openai.com/codex/llms.txt)].
- **Thread handoff** between local and remote hosts lets work move across machines while preserving Git state [[Remote connections docs](https://developers.openai.com/codex/remote-connections)].

## Notable public best practices / design decisions

- **Plan first for hard tasks.** Codex offers a `/plan` mode and recommends `PLANS.md` templates so the agent gathers context before coding [[Best practices docs](https://developers.openai.com/codex/learn/best-practices)].
- **AGENTS.md as an open-format README for agents.** Keep it short, put it closest to the relevant directory, and update it when the agent repeats a mistake [[Best practices docs](https://developers.openai.com/codex/learn/best-practices)].
- **Skills for method, automations for schedule.** Codex recommends turning repeatable workflows into skills first, then automating them once they are reliable [[Best practices docs](https://developers.openai.com/codex/learn/best-practices)].
- **Progressive disclosure for skills.** Codex loads only skill metadata for discovery; the full `SKILL.md`, references, and scripts are read only when the skill is selected [[Agent skills docs](https://developers.openai.com/codex/skills)].
- **Default-deny security.** Start with tight approvals and sandboxing, then loosen only for trusted repos or specific workflows [[Best practices docs](https://developers.openai.com/codex/learn/best-practices)].
- **One thread per coherent task.** Running one thread per project leads to bloated context; Codex recommends forking/compact when work branches [[Best practices docs](https://developers.openai.com/codex/learn/best-practices)].

---

## Top 5 findings relevant to a feature-gap comparison against `hip`

1. **Built-in multi-agent orchestration & worktree isolation**
   Codex Desktop treats parallel agent threads and Git worktrees as core primitives, with subagent spawning, custom TOML agents, and `max_threads`/`max_depth` guards built in [[Subagents docs](https://developers.openai.com/codex/subagents)] [[Codex app features](https://developers.openai.com/codex/app/features)]. `hip` currently uses a fixed LangGraph `Supervisor → Planner → Coder → Reviewer` pipeline; a gap/opportunity is more flexible, user-driven subagent spawning and native worktree isolation for parallel tasks.

2. **Hardened, cross-platform OS-level sandbox**
   Codex invests heavily in native sandboxing (Seatbelt, bubblewrap, and a custom Windows sandbox with restricted tokens/firewall users) and makes it the default for all surfaces [[OpenAI – building the Codex Windows sandbox](https://openai.com/index/building-codex-windows-sandbox/)] [[Advanced config docs](https://developers.openai.com/codex/config-advanced)]. `hip` runs a Node.js sidecar with user permissions; matching Codex’s sandbox maturity would be a significant security engineering effort.

3. **Cross-surface and remote control**
   Codex threads, settings, and context sync across the desktop app, CLI, IDE extension, and cloud, and users can start/approve work from a phone via the ChatGPT mobile app or hand threads between hosts over SSH [[Remote connections docs](https://developers.openai.com/codex/remote-connections)] [[Codex app features](https://developers.openai.com/codex/app/features)]. `hip` is a Tauri desktop-only workbench; cross-device supervision and IDE/cloud continuity are potential gaps.

4. **Curated plugin/skill marketplace and distribution**
   Codex has a plugin directory (curated by OpenAI, shared by workspace, or self-published), a marketplace packaging format, and team skills checked into repos [[Plugins docs](https://developers.openai.com/codex/plugins)] [[Agent skills docs](https://developers.openai.com/codex/skills)]. `hip` has skill/plugin registries in the sidecar, but a polished discoverability and distribution marketplace is likely a gap.

5. **`AGENTS.md` + `config.toml` as a mature project-guidance layer**
   Codex documents a clear hierarchy of `AGENTS.md` for durable repo guidance, `config.toml` for user/project config, skills for reusable workflows, MCP for external systems, and hooks for lifecycle policy [[Customization docs](https://developers.openai.com/codex/concepts/customization)] [[Best practices docs](https://developers.openai.com/codex/learn/best-practices)]. `hip` can adopt or strengthen a similar in-repo guidance/configuration convention to reduce repeated prompting and improve multi-agent consistency.
