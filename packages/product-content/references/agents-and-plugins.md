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
