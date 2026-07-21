# hip agents, plugins & MCP (Level 3)

## Built-in agent profiles

Typical fixed profiles (enable/disable in Agents UI):

| Profile | Role |
|---------|------|
| **supervisor** | Default orchestrator: tools, commit, scripts, delegation |
| **plan** | Design / planning oriented (narrower write posture depending on config) |
| **explore** | Read-only codebase search |
| **coder** | Implementation-focused with scripts |

Custom **internal** agents: persona prompt + bound model + tool grants.  
**External / ACP** agents: separate process; product memory defaults off unless configured.

Supported ACP presets (Settings → Agents → Add ACP agent): **OpenCode**, **Grok Build** (`grok agent stdio`), **Pi**, **Claude Code**, **Codex**. Grok Build uses native ACP (install via `https://x.ai/cli`); auth via `grok login` or optional `XAI_API_KEY`.

ACP agents are **self-managed** for auth and models: hip does not inject its provider API keys into the ACP child process. Use the agent’s own login / ambient env / optional preset `authEnvVar` on the agent config.

## Capability matrix (Built-in vs ACP)

hip can run a **built-in** LangGraph agent, an **ACP agent as the session primary**, or **dispatch an ACP agent as a subagent**. Capabilities differ (current product; planned host work noted where relevant):

| Capability | Built-in primary | ACP primary | ACP subagent (dispatch) |
|------------|------------------|-------------|-------------------------|
| hip tools (read / write / run_script / …) | yes | no (agent’s own tools) | no (agent’s own tools) |
| hip Skills / plugin hooks | yes | no | no |
| hip MCP (merged into session) | yes | no (planned: opt-in forward) | no (planned: opt-in forward) |
| Client FS bridge | n/a | no (stub only; real bridge planned) | no (stub only; real bridge planned) |
| dispatch / task / task_batch | yes | no | no |
| Memory inject (cross-session) | yes | no (config flag reserved; prefix planned) | no |
| Memory extract | yes | no | no |
| hip model picker | yes | no (agent configOptions / agent model UI) | no |
| HITL permission | hip tools | ACP `requestPermission` | same as ACP primary |
| permissionMode | hip tool gates | auto-resolve safe kinds (read/fetch/other) in chat/edit; else HITL (`full` also HITL on ACP path) | parent session mode |

**Takeaway:** choosing ACP as primary is a peer coding agent with its own stack—not hip’s built-in tools/skills/MCP. Subagent dispatch uses the same agent stack; neither primary nor subagent currently gets hip memory inject or hip MCP.

## Delegation tools (main agent)

| Tool | Use |
|------|-----|
| `task` | One sub-task (foreground or background) |
| `dispatch_agent` | Named roster agent; blocking unless parallel tool-calls |
| `task_batch` | **Preferred** for 2+ independent sub-tasks (true parallel) |

Do not claim work ran "in parallel" if only sequential dispatch was used.

## Plugins

- Installed under `~/.hip/plugins/`; registry in `~/.hip/config/hip-plugins.json`.
- A plugin may ship skills, agents, MCP server configs, and hooks.
- Disable a plugin to drop its contributions from the session.

### Plugin Market (Settings)

hip’s Plugin Market page integrates **only** the official catalogs:

| Source id | Catalog |
|-----------|---------|
| `grok-official` | [xai-org/plugin-marketplace](https://github.com/xai-org/plugin-marketplace) |
| `claude-official` | [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) |

UI tabs: **Grok market** · **Claude market** · **Custom plugins** (local installs without official provenance).

- Catalog cache: `~/.hip/cache/marketplaces/<sourceId>/`
- Source toggles: `~/.hip/config/marketplace-sources.json`
- Marketplace **download** registers the plugin with `enabled: false` by default (downloaded but not on).
- On download, sidecar **reviews** agent `boundModel` fields; unavailable models are rewritten to the product default (`activeModel` in hip.toml).
- Enable the plugin switch to inject skills/MCP/agents into sessions (`plugin:reload`).

### Plugin directory structure

Every plugin **must** contain a `.plugin/plugin.json` manifest file. Without it, hip will not discover the plugin:

```
~/.hip/plugins/<plugin-id>/
  .plugin/
    plugin.json          ← REQUIRED manifest (name, version, skills, etc.)
  skills/                ← optional, referenced by manifest "skills" field
    <skill-id>/
      SKILL.md
```

### `.plugin/plugin.json` manifest

**Required fields:**

```json
{
  "name": "my-plugin",
  "version": "1.0.0"
}
```

**Full example** (all optional fields):

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "id": "my-plugin",
  "description": "A sample hip plugin",
  "author": { "name": "Author Name" },
  "license": "MIT",
  "keywords": ["ai", "tools"],
  "skills": ["./skills/tdd", "./skills/debug"],
  "mcpServers": "./mcp-config.json",
  "agents": "./agents.json",
  "hooks": "./hooks.json"
}
```

- `skills` — a path (or array of paths) to directories containing `SKILL.md` files. Paths are relative to the plugin root and must not use `..`.
- `mcpServers`, `agents`, `hooks` — can be specified inline as JSON arrays/objects, or as a path to an external JSON file under the plugin root.

### `hip-plugins.json` registry format

The registry maps plugin IDs to absolute paths. Two formats are supported:

**String array format** (recommended for new plugins):
```json
{
  "plugins": ["/absolute/path/to/plugin"],
  "entries": [],
  "enabled": { "my-plugin": true }
}
```

**Legacy object format** (uses `"dir"` key):
```json
{
  "plugins": [
    { "dir": "/absolute/path/to/plugin", "enabled": true }
  ]
}
```

To install a plugin:

1. Clone/download the plugin under `~/.hip/plugins/<plugin-id>/`.
2. Ensure `.plugin/plugin.json` exists with at least `name` and `version`.
3. Add the absolute path to `hip-plugins.json` → `plugins` array (string format).
4. The plugin will be discovered on next session start or after `plugin:reload`.

## MCP

- Server configs come from hip.toml / plugin synthesis.
- Code surface may inject a short catalog; discover with `mcp_search`.
- Call tools as `mcp__<server>__<tool>`.
- Network policy (if configured) may block outbound MCP/web tools.

## Skills scopes

| Scope | Location |
|-------|----------|
| global | `~/.hip/skills/<id>/` |
| project | `.hip/skills/<id>/` (wins over global same id) |
| plugin | plugin-owned skill dirs |
| builtin product | `~/.hip/builtin-skills/hip/` (lowest priority; overridable by same id) |
