/**
 * Built-in product skill content for progressive disclosure.
 *
 * Level 1 — name + description listed in the system-prompt "## Skills" block
 * Level 2 — this SKILL.md body via use_skill({ name: "hip" })
 * Level 3 — references/* paths returned by use_skill; read with read_file
 *
 * Bump PRODUCT_SKILL_VERSION whenever any string below changes so the on-disk
 * materialization under ~/.hip/builtin-skills/hip is rewritten.
 */
export const PRODUCT_SKILL_VERSION = '1'

export const HIP_SKILL_ID = 'hip'
export const HIP_SKILL_NAME = 'hip'

export const HIP_SKILL_DESCRIPTION =
  'Product help for the hip desktop agent: Chat/Code surfaces, permission modes, ' +
  'Settings, skills, plugins, MCP, memory, agents, CLI, and local data layout. ' +
  'Load when the user asks how hip works or how to configure it.'

/** Level-2 body (frontmatter + markdown). */
export const HIP_SKILL_MD = `---
name: hip
description: "${HIP_SKILL_DESCRIPTION.replace(/"/g, '\\"')}"
---

# hip

hip is a **desktop AI workbench** (Tauri shell + React UI + Node sidecar). Each UI tab is an independent session. The default product loop is a **Supervisor ReAct** agent that uses tools and may delegate with \`task\` / \`dispatch_agent\` / \`task_batch\` — there is no forced Planner → Coder → Reviewer pipeline on ordinary turns.

This skill is the authoritative product guide for *hip itself*. For ordinary coding work in the user's project, do **not** load this skill.

## Progressive disclosure

- **Level 1** (always): skill name + description in the system prompt Skills list
- **Level 2** (this file): overview below, loaded via \`use_skill({ name: "hip" })\`
- **Level 3**: deeper topics in \`references/\` — read those absolute paths with \`read_file\` when needed

If a product detail is not documented here, say so rather than inventing UI labels or config keys.

## Surfaces

| Surface | Intent |
|---------|--------|
| **Code** | Project workbench: file tools, git guidance, MCP catalog, full agent tools |
| **Chat** | Lighter conversation surface: shorter prompt, no git-commit guidance, prefer writing previewable deliverables (\`page.html\`, \`notes.md\`, SVG, etc.) into the workspace for the artifacts panel |

Surface is chosen in the UI; the system prompt already reflects the active surface.

## Permission modes

| Mode | Effect |
|------|--------|
| **edit** (default) | Filesystem tools sandboxed to the project root |
| **chat** | Read-only: no write/edit/script/git mutations |
| **full** | Un-sandboxed filesystem (user-granted); prefer absolute paths |

Path convention in edit/chat: project-root form starting with \`/\` (e.g. \`/src/index.ts\` maps to \`<cwd>/src/index.ts\`). Never invent shell tool names — use \`run_script\` when available.

## Settings (desktop UI)

Typical destinations (wording may vary slightly in the UI):

- **Providers / API keys** — stored as plaintext under \`~/.hip/config/auth.json\` (mode 0600 by design)
- **Memory** — cross-session memory is **off by default**; enable under Settings → Memory (see \`references/memory.md\`)
- **Skills** — enable/disable installed skills (\`hip.toml\` + skill folders)
- **Plugins** — install/enable plugins (skills, agents, MCP, hooks)
- **Agents** — fixed profiles (supervisor / plan / explore / coder) and custom internal or external agents
- **Network policy** — optional allow/deny for outbound tools

## Skills, plugins, MCP

- **Skills**: Claude-format folders with \`SKILL.md\`. Global: \`~/.hip/skills/<id>/\`. Project: \`.hip/skills/<id>/\`. Progressive disclosure: L1 metadata → \`use_skill\` body → \`references/\` + \`assets/\`.
- **Plugins**: under \`~/.hip/plugins/\`; can contribute skills, agents, MCP servers, and hooks.
- **MCP**: configured servers expose tools. In Code surface the system prompt may list a catalog; use \`mcp_search\` then call namespaced tools \`mcp__<server>__<tool>\`.

## Agents & delegation

- Default session agent decides when to use tools or delegate.
- Prefer specialized roster agents when available: **explore** (read-only search), **plan** (design-only), **coder** (implementation).
- Parallel independent sub-tasks → one \`task_batch\` (not sequential \`dispatch_agent\`).
- Explicit workflows / multi-agent handoff exist but are **not** the ordinary product path.

## CLI (\`@hip/cli\`)

Attach-only companion to a **running** hip app (shared sidecar + \`~/.hip\` data). Does not start the product sidecar.

\`\`\`bash
yarn cli:dev doctor
yarn cli:dev config auth-status
yarn cli:dev session list
yarn cli:dev run --stream none --json "Reply with exactly: pong"
yarn cli:dev repl --cwd .
\`\`\`

If the app is not running, CLI fails with \`APP_NOT_RUNNING\`.

## Project guidance files

When present under the project, hip may inject guidance such as \`AGENTS.md\` / \`Claude.md\` / \`.hip\` config. Prefer following those for **project** conventions; this skill is for **product** behavior.

## Level 3 references

After loading this skill, \`use_skill\` returns absolute paths. When the user needs depth:

- Memory enablement, inject, extract, privacy → \`references/memory.md\`
- Local data layout, config files, env overrides → \`references/config-and-data.md\`
`

export const MEMORY_REFERENCE_MD = `# hip memory (Level 3)

Cross-session memory is **disabled by default** (privacy / cost).

## Enable

1. Open **Settings → Memory**.
2. Enable **use** and/or **generate**.
3. Enabling both from a cold install may apply a dogfood preset (shorter idle / extract interval) when gates are still defaults.
4. Ensure a provider API key is configured (Settings → Providers). Extraction needs an API key.

## What is stored

Structured items in SQLite (\`memory_items\`): preferences, conventions, lessons, workflows, profiles — scoped **global**, **project**, or **session**.

**Source of truth is SQLite.** Markdown under \`~/.hip/memories/\` is an export mirror. Project \`MEMORY.md\` / \`.hip/MEMORY.md\` is separate project-notes injection, not auto-imported into SQLite.

## Runtime behavior

| Path | Behavior |
|------|----------|
| **Use** | Core snapshot + per-turn prefetch + \`memory_*\` tools |
| **Generate** | After idle → Phase1 extract → Phase2 consolidate |
| **Incognito** | Session flag: no inject and no extract |
| **Learn now** | Settings control to force extract/consolidate when dogfooding |

Managed sub-agents may get read-only core injection; external ACP agents default off.

## Privacy notes

- Cold defaults: use/generate off
- Hybrid search (optional) may send snippets to embedding providers
- Threat-scan + secret redact on write
- Soft-delete trash + retention

For architecture detail see the repo docs \`docs/memory.md\` and \`docs/memory-longterm-design.md\` when developing hip itself.
`

export const CONFIG_REFERENCE_MD = `# hip config & local data (Level 3)

## Layout (\`~/.hip/\`)

| Path | Purpose |
|------|---------|
| \`~/.hip/config/auth.json\` | Provider API keys (0600 plaintext by design) |
| \`~/.hip/config/hip.toml\` | Global product config (skills, agent loop, langsmith, …) |
| \`~/.hip/config/memory.json\` | Memory feature flags / pipeline knobs |
| \`~/.hip/config/network.json\` | Optional network policy |
| \`~/.hip/config/hip-plugins.json\` | Installed plugins registry |
| \`~/.hip/db/hip.db\` | SQLite sessions, messages, memory items, events |
| \`~/.hip/data/tool-output/\` | Large tool outputs (kept out of the DB) |
| \`~/.hip/logs/\` | Sidecar / shell logs |
| \`~/.hip/skills/\` | Global skills |
| \`~/.hip/plugins/\` | Installed plugins |
| \`~/.hip/memories/\` | Memory markdown mirrors |
| \`~/.hip/builtin-skills/\` | Built-in progressive product skills (e.g. this \`hip\` skill) |
| \`~/.hip/scratch/\`, worktrees | Scratch / parallel worktree helpers |

Project overrides often live under \`<project>/.hip/\` (e.g. \`.hip/skills/\`, \`.hip/hip.toml\`).

## Env / isolation (advanced)

| Variable | Role |
|----------|------|
| \`HIP_DATA_DIR\` | Redirect data/config roots (tests / isolation) |
| \`HIP_SKILLS_DIR\` | Override global skills root |
| \`HIP_PLUGINS_DIR\` | Override plugins root |
| \`HIP_AUTH_PATH\` | Override auth.json path |
| \`HIP_CONFIG_PATH\` | Override hip.toml path |
| \`HIP_MEMORY_CONFIG_PATH\` | Override memory.json path |
| \`LANGSMITH_*\` | Optional LangSmith tracing (also \`[langsmith]\` in hip.toml) |

**Do not** sync \`~/.hip/config/\` to public cloud or public dotfile repos — it may contain API keys.

## Auth model

Keys are entered in the app Settings panel and stored in \`auth.json\`. Desktop app, standalone sidecar, and tests all read from that store. This is intentional plaintext-on-disk with tight file modes — not a keychain migration target.
`
