# Extension Registry — Plugin / Skill / MCP conflict governance

Status: **implemented (Phase 0–1 core)**  
Related plan: extension-layer conflict resolution for hip.

## Layering

| Layer | Question it answers | hip storage |
|-------|---------------------|-------------|
| **Plugin** | How is a capability pack installed / enabled? | `~/.hip/plugins/`, `hip-plugins.json` |
| **Skill** | How should the agent reason / run a workflow? | `SKILL.md` + `use_skill` |
| **MCP** | How does the agent access live systems? | `hip.toml` `[[mcpServers]]` + plugin `.mcp.json` |

They are complementary: **Skill orchestrates, MCP executes, Plugin packages.**

## Single source of truth

`packages/protocol/src/extension-registry.ts` defines pure resolution.

`packages/sidecar/src/session/extensions/load.ts` loads candidates from disk and calls resolve.

**Consumers:**

- `ConfigManager.loadPluginComponents` — session skills + MCP tools
- `listEnabledHipMcpServers` (ACP forward) — same MCP resolution

## Precedence

### Skills (same `id`, one active)

1. Disabled in `[[skills]]` → inactive  
2. **Project** `.hip/skills/<id>`  
3. **User** `~/.hip/skills/<id>` (`HIP_SKILLS_DIR` / `HIP_DATA_DIR/skills`)  
4. **Plugin** (enabled plugins; registry order, first wins within tier)  
5. **Builtin** product skills  

### MCP (same `id`, one connection)

1. **hip.toml** entry wins (including `enabled = false` → **name veto**: plugins cannot fill the id)  
2. **Plugin** MCP only if id is free  
3. **Capability fingerprint** (npm package / HTTP origin+path): if two *different* ids share a fingerprint, only the higher-precedence server stays active unless `allowDuplicate = true`

## Provenance

- Plugin skills: `scope: 'plugin'`, `pluginId` set  
- Plugin MCP: `config.pluginId` stamped at synthesize + load  

## Environment

Tauri injects `HIP_SKILLS_DIR` (same as `paths::skills_dir`).  
Sidecar also falls back: `HIP_SKILLS_DIR` → `HIP_DATA_DIR/skills` → `~/.hip/skills`.

## Conflicts

Resolution emits `ExtensionConflict[]` (`skill_id_shadow`, `mcp_id_shadow`, `mcp_capability_duplicate`, `mcp_name_veto`, …).  
`ConfigManager.extensionConflicts` exposes the last load for future Settings / inspect UI.

## Phase 2+ (not yet)

- Install / enable **preflight** UX  
- Settings conflict banner + one-click remediations  
- `extension:inspect` WS / CLI  
- FE `derivePlugin*` driven purely by registry snapshot  

## Do not double-install

If you already have e.g. `chrome-devtools-mcp` in `hip.toml`, installing a plugin that ships the same package will **not** start a second process by default (capability demotion). Prefer:

- keep user MCP + enable plugin **skills**, or  
- remove user MCP and use the plugin’s MCP entry  

See also chrome-devtools-mcp upstream: remove prior MCP config before plugin install when the plugin owns the server.
