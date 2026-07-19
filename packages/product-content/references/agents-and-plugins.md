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

hip can run a **built-in** LangGraph agent, an **ACP agent as the session primary**, or **dispatch an ACP agent as a subagent**. Capabilities differ:

| Capability | Built-in primary | ACP primary | ACP subagent (dispatch) |
|------------|------------------|-------------|-------------------------|
| hip tools (read / write / run_script / …) | yes | no (agent’s own tools) | no (agent’s own tools) |
| hip Skills / plugin hooks | yes | no | no |
| hip MCP (merged into session) | yes | no (unless MCP forward is on) | no (unless MCP forward is on) |
| Client FS bridge | n/a | yes | yes |
| dispatch / task / task_batch | yes | no | no |
| Memory inject (cross-session) | yes | opt-in prefix only | no (v1) |
| Memory extract | yes | no (v1) | no |
| hip model picker | yes | no (agent configOptions / agent model UI) | no |
| HITL permission | hip tools | ACP `requestPermission` | same as ACP primary |
| permissionMode | hip tool gates | FS bridge + auto-resolve for safe kinds | parent session mode |

**Takeaway:** choosing ACP as primary is a peer coding agent with its own stack—not hip’s built-in tools/skills/MCP. Dispatching ACP as a subagent is the same agent stack without primary-only memory prefix.

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
