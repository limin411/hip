# Global command palette

Keyboard-first launcher (`⌘K` / `Ctrl+K`) for hip desktop.

## Architecture

| Module | Role |
|--------|------|
| `GlobalCommandPalette.tsx` | Dialog shell, nested pages, selection |
| `buildGlobalCommands.ts` | Core command groups (nav, workspace, context, sessions…) |
| `registry.ts` | `buildAllGroups` + `registerCommandProvider` |
| `rankGlobalCommands.ts` | Scoring (substring + fuzzy + usage boost) |
| `queryPrefix.ts` | `>` / `#` / `@` mode filters |
| `favoritesStore.ts` | Pinned command ids (`localStorage`) |
| `composerBridge.ts` | Insert text into the active composer (skills handoff) |
| `domain/commands/*` | Shared run handlers with slash |

## Query prefixes

| Prefix | Mode |
|--------|------|
| _(none)_ | All groups |
| `>` | Commands only (no sessions/skills) |
| `#` | Sessions only |
| `@` | Skills only |

## Extending: `registerCommandProvider`

Plugins or app modules can inject extra groups:

```ts
import { registerCommandProvider } from '@/components/command-palette'

const unregister = registerCommandProvider((ctx) => {
  // Optional: only when searching
  if (!(ctx.search ?? '').trim()) return []

  return [
    {
      id: 'my-plugin',
      heading: 'My plugin',
      items: [
        {
          id: 'my-plugin-action',
          label: 'Do something',
          keywords: ['plugin', 'demo'],
          group: 'commands-extra',
          icon: 'sparkles',
          run: () => {
            // side effect
          },
        },
      ],
    },
  ]
})

// Later (e.g. on unmount):
unregister()
```

### Provider contract

- **Input:** `GlobalCommandContext` (view, theme, `search`, `skills`, session, labels, action callbacks).
- **Output:** `PaletteGroup[]` (may be empty).
- **Search:** Prefer long-tail items only when `ctx.search` is non-empty (or when the user typed `@` / `#`).
- **Ids:** Stable unique `id` per item (used for favorites, usage, tests).
- **Run:** Prefer calling `domain/commands` or existing services; do not duplicate business logic.

### Skills handoff

Selecting a skill tries `insertComposerText('/{name} ')`. Register an inserter from the composer (`InputBar` already does).

1. If inserter is live → insert and done.  
2. Else if a palette session id is known → `selectSession` then retry insert briefly (`insertComposerTextWhenReady`).  
3. Else toast `commandPalette.skills.needComposer` — **never** silently open Skills settings.

Disabled skills (`skillsEnabled[id] === false`) are omitted.

### ⌘1–⌘9

Hotkey numbers use `flattenHotkeyItems` (skips nested `to` rows). Display badges and keydown share the same list so indices never desync.

### No-session context

When no session is bound, Suggested includes **Open a conversation…** (`ctx-need-session`) so users know why compact/diff/memory are hidden.

### Favorites

Users pin items with the star control (or programmatically via `toggleFavorite(id)`). Favorites appear in a top group when the palette opens empty. `⌘1`–`⌘9` run the first nine **visible** rows while the palette is open.

## Tests

```bash
yarn vitest run src/components/command-palette/
```
