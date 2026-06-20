# src/components/account/ — AGENTS.md

Settings UI. 21 component files covering provider configuration, model management, agent CRUD, MCP server setup, skill management, and general app settings. All settings components are IPC-backed — they read/write configuration through Tauri commands, not direct file access.

## STRUCTURE

```
account/
├── SettingsPage.tsx          # Entry point — renders SettingsPanel
├── SettingsPanel.tsx         # Tab router: General / Providers / Models / Agents / MCP / Skills
├── GeneralSettings.tsx       # Language selector, workspace root, theme
├── ProviderList.tsx          # List configured providers (DeepSeek, OpenAI, Anthropic, etc.)
├── ProviderDetail.tsx        # Single provider: API key input, base URL, models
├── AddProviderDialog.tsx     # Add new provider modal
├── CurrentModelHero.tsx      # Current default model display card
├── ModelConfig.tsx           # Model list + enable/disable per model
├── AgentManagement.tsx       # Agent CRUD container
├── AgentListPane.tsx         # Agent list with search/filter
├── AgentCard.tsx             # Single agent card in list
├── AgentEditor.tsx           # Agent create/edit form (tools, skills, MCP, model)
├── AgentFilterList.tsx       # Agent type/status filter bar
├── DeleteAgentDialog.tsx     # Confirm delete modal
├── AcpProviderPicker.tsx     # ACP agent provider selector
├── McpConfig.tsx             # MCP server list + add/edit/delete (517 lines)
├── SkillConfig.tsx           # Skill list + enable/disable/install/remove
├── ConfigEditor.tsx          # Hip-wide TOML config editor (632 lines)
├── ConfigEditor.logic.test.ts
├── McpConfig.logic.test.ts
└── SkillConfig.logic.test.ts
```

## PATTERNS

- **No barrel**: Direct file-to-file imports, no `index.ts`
- **Named exports only**: `export function SettingsPage()` — zero defaults
- **IPC-backed state**: All config mutations go through Tauri invoke → sidecar restart on key config changes
- **i18n**: Every user-visible string via `useTranslation()`
- **Chinese inline docs**: Strategy/design comments in Chinese
- **Logic tests**: `.logic.test.ts` files extract pure logic functions for fast testing (no render)

## WHERE TO LOOK

| Task | File | Notes |
|------|------|-------|
| Settings entry | `SettingsPage.tsx` | Simple wrapper → SettingsPanel |
| Tab routing | `SettingsPanel.tsx` | Renders active tab based on UI state |
| Provider config | `ProviderDetail.tsx` | API key, base URL, model list |
| Model management | `ModelConfig.tsx` | Enable/disable models per provider |
| Agent CRUD | `AgentManagement.tsx` → `AgentEditor.tsx` | Create/edit internal + ACP agents |
| MCP servers | `McpConfig.tsx` | List, add (command/args/env), edit, delete |
| Skills | `SkillConfig.tsx` | List, enable/disable, install/remove |
| TOML config | `ConfigEditor.tsx` | Raw hip-config.toml editor |
| Agent filtering | `AgentFilterList.tsx` | Type/status/ownership filter bar |

## NOTES

- `ConfigEditor.tsx` is the largest component (632 lines) — raw TOML editor for hip-config.toml with validation
- `McpConfig.tsx` (517 lines) — complex IPC flow: config → Tauri → sidecar MCP manager reconnect
- `authStore.ts` (in `src/store/`) is demo-only — real auth not yet implemented, so no account-level auth UI
- Logic test files extract pure functions from components for fast Vitest runs (no jsdom needed)
