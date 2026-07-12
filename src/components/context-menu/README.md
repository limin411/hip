# Context menu system

Registry-driven right-click menus for hip surfaces. Builtins live in
`providers/*` and are wired inside `buildContextMenuItems`. Surfaces wrap
hosts with `DeclarativeContextMenu`.

## `registerContextProvider` (in-app extras only)

Use this when an **in-app module** needs to inject additional items into an
existing context kind (or a custom kind you also catalog). Third-party /
untrusted plugins must **not** register UI menu providers in v1.

```ts
import {
  registerContextProvider,
  registerCatalogMeta,
  type ContextProvider,
} from '@/components/context-menu'

const myProvider: ContextProvider = (req, ctx) => {
  // Always early-return for kinds you do not own.
  if (req.kind !== 'plugin') return []
  return [
    {
      id: 'plugin.copyId',
      label: ctx.t('contextMenu.plugin.copyId'), // or reuse settings.*
      group: 'clipboard',
      run: () => {
        void ctx.copyText(req.payload.pluginId)
      },
    },
  ]
}

// Optional: register static meta so Settings hide/reorder can list the item.
const unregMeta = registerCatalogMeta([
  {
    id: 'plugin.copyId',
    labelKey: 'contextMenu.plugin.copyId',
    kind: 'plugin',
    group: 'clipboard',
  },
])

const unregister = registerContextProvider(myProvider)

// Later (e.g. module teardown / test cleanup):
unregister()
unregMeta()
```

### Rules

| Rule | Detail |
|------|--------|
| **Extras only** | Builtins are imported into `BUILTIN_PROVIDERS` in `registry.ts`. Do not side-effect-register builtins. |
| **Early return** | Return `[]` when `req.kind` is not yours. |
| **Stable ids** | Every item needs a stable `id`. Prefs `disabledIds` and Settings reorder use these. |
| **Catalog meta** | Prefs UI reads `listCatalogItems` / `registerCatalogMeta`. Runtime-only extras without meta will not appear in Settings. |
| **Side effects** | Call domain/IPC inside `run()`, not while building the menu. |
| **Tests** | Call `clearContextProviders()` / `clearCatalogMeta()` in `beforeEach` — they clear **extras only**. |
| **Empty menus** | `DeclarativeContextMenu` prevents open when no items remain after prefs. |
| **`modal={false}`** | Always. Avoids stuck `body { pointer-events: none }` when an item opens a Modal. |

### Settings list kinds

| Kind | Surface | Builtin actions |
|------|---------|-----------------|
| `agentConfig` | `AgentCard` | edit, delete |
| `skillConfig` | `SkillCard` | view; delete if `canDelete` |
| `mcpServer` | standalone MCP card | edit, delete |
| `plugin` | plugin card | uninstall |

Hosts pass action callbacks in the payload so menus share the same dialogs as kebabs/buttons. Kebabs stay for discoverability.
