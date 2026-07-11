# Command Palette Improvements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the global ⌘K palette into a useful universal launcher: dense rows (icon/shortcut), wired nested pages, full settings deep-links, context/memory/code actions shared with slash, curated empty-query IA, then fuzzy/usage/registry/skills in a second wave.

**Architecture:** Keep `cmdk` + Radix Dialog + custom `rankGroups` (`shouldFilter={false}`). Expand `PaletteCommand` types; extract shared run handlers from `useSlashCommandHandler` into `src/domain/commands/*` so slash and palette call the same functions. Build groups via a core builder (P0) that becomes a registry provider (P1). Nested `page` from `commandPaletteStore` drives theme (and later shortcuts). Sessions only appear when the query is non-empty.

**Tech Stack:** React 18, TypeScript, Zustand, cmdk, Radix Dialog, lucide-react, i18next, Vitest + Testing Library, existing WebdriverIO e2e harness.

**Spec:** [`docs/superpowers/specs/2026-07-11-command-palette-improvements-spec.md`](../specs/2026-07-11-command-palette-improvements-spec.md)

**Locked defaults (spec §15):**

| Q | Default |
|---|---------|
| Skills handoff | A — fill composer with `/{name} ` |
| Empty-query sessions | **Hidden** |
| Shortcuts help | P0 Dialog; P1 optional nested page |
| Visible trigger | Titlebar tools cluster |
| Theme | Single subpage with light/dark/system |
| Registry | Types in P0; multi-provider in P1 |
| Fuzzy | Zero-dep self-written |

**Out of scope (this plan series):** Raycast-level OS launcher, settings field-level deep-link (P2-2 optional follow-up), plugin command API (P2-1), favorites/prefix modes (P2-3/4), removing `GLOBAL_COMMAND_PALETTE` flag until P2-10.

---

## Dependency graph

```text
T1 types + i18n + rank description
     │
     ├─► T2 CommandRow + GlobalCommandPalette shell (icons, empty IA)
     │        │
     │        ├─► T3 nested page + Theme keepOpen
     │        │
     │        └─► T4 settings deep-links + curated groups
     │
     ├─► T5 domain/commands extract + slash refactor
     │        └─► T6 context/memory/code palette commands
     │
     ├─► T7 shortcuts help Dialog + KEYBIND_HELP
     ├─► T8 titlebar visible trigger
     └─► T9 e2e + unit regression (P0 gate)

P1 (after T9 green):
T10 fuzzy + description scoring polish
T11 usage store + boost
T12 registry + skills search provider
T13 footer + match highlight + root theme shortcuts

P2 (optional backlog):
T14 plugin API / favorites / prefixes / a11y / flag removal
```

**Suggested merge / PR order (maps to spec appendix A):**

| PR | Tasks | Commit theme |
|----|-------|--------------|
| PR-A | T1, T2, T4 | types, rows, settings, empty IA |
| PR-B | T3 | nested theme page |
| PR-C | T5, T6, T7, T8 | shared actions, context cmds, help, trigger |
| PR-D | T9 | e2e + harden |
| PR-E | T10, T11, T13 | fuzzy, usage, polish |
| PR-F | T12 | registry + skills |
| PR-G+ | T14 | P2 backlog |

Each task ends with a commit step; workers may squash within a PR but must not skip tests.

---

## File map

### Create

```
src/components/command-palette/types.ts
src/components/command-palette/components/CommandRow.tsx
src/components/command-palette/components/CommandRow.test.tsx
src/components/command-palette/keys.ts
src/components/command-palette/ShortcutsHelpDialog.tsx
src/domain/commands/memoryActions.ts
src/domain/commands/memoryActions.test.ts
src/domain/commands/codeActions.ts
src/domain/commands/codeActions.test.ts
src/domain/commands/navigationActions.ts
src/domain/commands/index.ts
src/components/command-palette/usageStore.ts          # P1
src/components/command-palette/usageStore.test.ts     # P1
src/components/command-palette/registry.ts            # P1
src/components/command-palette/registry.test.ts       # P1
src/components/command-palette/fuzzyScore.ts          # P1 (or fold into rank)
src/components/command-palette/components/PaletteFooter.tsx  # P1
```

### Modify (primary)

```
src/store/commandPaletteStore.ts          # setPage if needed; keep openPage
src/components/command-palette/buildGlobalCommands.ts
src/components/command-palette/buildGlobalCommands.test.ts
src/components/command-palette/rankGlobalCommands.ts
src/components/command-palette/rankGlobalCommands.test.ts
src/components/command-palette/GlobalCommandPalette.tsx
src/components/command-palette/GlobalCommandPalette.test.tsx
src/components/command-palette/index.ts
src/components/chat/useSlashCommandHandler.ts
src/components/chat/useSlashCommandHandler.test.tsx
src/components/layout/TitleBar.tsx
src/components/layout/TitleBar.test.tsx
src/i18n/en.ts
src/i18n/zh-CN.ts
src/i18n/zh-TW.ts
src/i18n/translation-keys.test.ts         # if parity test exists
e2e/specs/command-palette.spec.ts
```

### Touch lightly / optional

```
src/components/chat/SlashCommandPalette.tsx   # help text only if needed
src/routes/AppLayout.tsx                      # only if trigger not in TitleBar
src/domain/index.ts                           # re-export commands if desired
```

---

## Task 1: Types, i18n, rank description match

**Files:**
- Create: `src/components/command-palette/types.ts`
- Modify: `src/components/command-palette/rankGlobalCommands.ts`
- Modify: `src/components/command-palette/rankGlobalCommands.test.ts`
- Modify: `src/components/command-palette/buildGlobalCommands.ts` (import types; minimal churn OK)
- Modify: `src/i18n/en.ts`, `zh-CN.ts`, `zh-TW.ts`

- [ ] **Step 1: Add `types.ts`**

```ts
// src/components/command-palette/types.ts
import type { RankableItem } from './rankGlobalCommands'

export type CommandGroupId =
  | 'context'
  | 'navigation'
  | 'actions'
  | 'workspace'
  | 'appearance'
  | 'sessions'
  | 'skills'
  | 'settings-pages'
  | 'commands-extra'
  | string

export type PaletteIconName =
  | 'message-square'
  | 'code'
  | 'history'
  | 'settings'
  | 'plus'
  | 'sun'
  | 'moon'
  | 'monitor'
  | 'palette'
  | 'keyboard'
  | 'brain'
  | 'wrench'
  | 'package'
  | 'cpu'
  | 'git-branch'
  | 'sparkles'
  // extend as needed

export interface CommandWhen {
  views?: Array<'chat' | 'code' | 'history' | 'settings'>
  requiresSession?: boolean
  surfaces?: Array<'chat' | 'code'>
  enabled?: boolean
}

export type GlobalCommand = RankableItem & {
  group: CommandGroupId
  description?: string
  icon?: PaletteIconName
  shortcut?: string
  to?: string
  keepOpen?: boolean
  when?: CommandWhen
  contextBoost?: number
  /** true when this is the active theme/view — UI shows check */
  active?: boolean
  run?: () => void
}

export type PaletteGroup = {
  id?: CommandGroupId
  heading?: string
  items: GlobalCommand[]
}
```

Move `GlobalCommand` / `PaletteGroup` **out of** `buildGlobalCommands.ts` (re-export from there for one release if needed to avoid huge import churn).

- [ ] **Step 2: Extend `RankableItem` + `scoreItem` for description**

```ts
// rankGlobalCommands.ts
export type RankableItem = {
  id: string
  label: string
  keywords?: string[]
  description?: string
}

// In scoreItem, after keyword path:
// if description includes needle/terms → return 0.35 (only if no better label match already applied)
```

Add tests:

```ts
it('matches description at weak score', () => {
  expect(
    scoreItem(
      { id: 'x', label: 'Foo', description: 'Open memory settings' },
      'memory',
    ),
  ).toBeGreaterThan(0)
  expect(
    scoreItem(
      { id: 'x', label: 'Foo', description: 'Open memory settings' },
      'memory',
    ),
  ).toBeLessThan(0.5)
})
```

- [ ] **Step 3: i18n keys under `commandPalette`**

English additions (mirror zh-CN / zh-TW):

```ts
commandPalette: {
  title: 'Command palette',
  searchPlaceholder: 'Type a command…',
  noResults: 'No results',
  noResultsHint: 'Try “theme”, “memory”, or a session name',
  back: 'Back',
  current: 'Current',
  openTrigger: 'Command palette',
  openTriggerAria: 'Open command palette',
  groups: {
    navigation: 'Navigation',
    actions: 'Actions',
    theme: 'Theme',
    sessions: 'Sessions',
    context: 'Suggested',
    workspace: 'Workspace',
    appearance: 'Appearance',
    skills: 'Skills',
  },
  actions: {
    newConversation: 'New conversation',
    keyboardShortcuts: 'Keyboard shortcuts',
    changeTheme: 'Change theme…',
  },
  settings: {
    general: 'Settings: General',
    model: 'Settings: Model',
    agents: 'Settings: Agents',
    mcp: 'Settings: MCP',
    skill: 'Settings: Skills',
    plugins: 'Settings: Plugins',
    memory: 'Settings: Memory',
  },
  context: {
    diff: 'Show workspace changes',
    compact: 'Compact conversation',
    init: 'Initialize project',
    memoryOn: 'Enable memories for this session',
    memoryOff: 'Disable memories for this session',
    memoryIncognito: 'Incognito memory for this session',
    memoryStatus: 'Show memory status',
  },
  shortcuts: {
    title: 'Keyboard shortcuts',
    description: 'Common shortcuts in hip',
    openPalette: 'Open command palette',
    slash: 'Slash commands in composer',
  },
  footer: {
    navigate: 'Navigate',
    run: 'Run',
    close: 'Close',
    back: 'Back',
  },
},
```

Remove or stop using `emptyHint: 'Commands coming soon'`.

- [ ] **Step 4: Run tests**

```bash
yarn vitest run src/components/command-palette/rankGlobalCommands.test.ts src/i18n/translation-keys.test.ts
```

Expected: PASS (add translation keys test file path only if project has it).

- [ ] **Step 5: Commit**

```bash
git add src/components/command-palette/types.ts \
  src/components/command-palette/rankGlobalCommands.ts \
  src/components/command-palette/rankGlobalCommands.test.ts \
  src/components/command-palette/buildGlobalCommands.ts \
  src/i18n/en.ts src/i18n/zh-CN.ts src/i18n/zh-TW.ts
git commit -m "feat(command-palette): types, description scoring, i18n keys"
```

---

## Task 2: CommandRow + empty-query IA shell

**Files:**
- Create: `src/components/command-palette/components/CommandRow.tsx`
- Create: `src/components/command-palette/components/CommandRow.test.tsx`
- Modify: `src/components/command-palette/GlobalCommandPalette.tsx`
- Modify: `src/components/command-palette/GlobalCommandPalette.test.tsx`
- Modify: `src/components/command-palette/buildGlobalCommands.ts`
- Modify: `src/components/command-palette/buildGlobalCommands.test.ts`

- [ ] **Step 1: Icon map + CommandRow**

```tsx
// CommandRow.tsx — presentational
import {
  MessageSquare, Code2, History, Settings, Plus, Sun, Moon, Monitor,
  Palette, Keyboard, Brain, Wrench, Package, Cpu, Sparkles, ChevronRight, Check,
} from 'lucide-react'
import type { GlobalCommand, PaletteIconName } from '../types'

const ICONS: Record<PaletteIconName, React.ComponentType<{ className?: string }>> = {
  'message-square': MessageSquare,
  // ...
}

export function CommandRow({ item }: { item: GlobalCommand }) {
  const Icon = item.icon ? ICONS[item.icon] : null
  return (
    <>
      {Icon ? <Icon className="size-3.5 shrink-0 text-ink-tertiary" /> : null}
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.active ? <Check className="size-3.5 shrink-0 text-accent" /> : null}
      {item.description && !item.active ? (
        <span className="hidden max-w-[8rem] truncate text-caption text-ink-tertiary sm:inline">
          {item.description}
        </span>
      ) : null}
      {item.shortcut ? (
        <kbd className="ml-auto shrink-0 rounded bg-surface-muted px-1.5 py-0.5 font-mono text-caption text-ink-tertiary">
          {item.shortcut}
        </kbd>
      ) : null}
      {item.to ? (
        <ChevronRight className={`size-3.5 shrink-0 text-ink-tertiary ${item.shortcut ? '' : 'ml-auto'}`} />
      ) : null}
    </>
  )
}
```

- [ ] **Step 2: Change build — empty query without sessions; icons on nav/actions**

In `buildGlobalCommandGroups`:

1. Attach `icon` to each nav/action/theme command.  
2. **Do not** push sessions group when building the *base* list used for empty query.  
   Prefer API:

```ts
export function buildGlobalCommandGroups(
  ctx: GlobalCommandContext,
  opts?: { search?: string },
): PaletteGroup[]
```

- Base groups always: navigation, actions, appearance entry (later), workspace (later).  
- Sessions: only if `opts?.search?.trim()` non-empty (implement fully in T4 if splitting; at minimum **stop always appending sessions** here).

Update tests that expected sessions on empty list:

```ts
it('omits sessions group when search is empty', () => {
  const groups = buildGlobalCommandGroups(makeCtx({ sessions: [...] }), { search: '' })
  expect(groups.map((g) => g.heading)).not.toContain(labels.groupSessions)
})

it('includes sessions when search is non-empty', () => {
  const groups = buildGlobalCommandGroups(makeCtx({ sessions: [...] }), { search: 'chat' })
  expect(groups.some((g) => g.items.some((i) => i.id.startsWith('session-')))).toBe(true)
})
```

- [ ] **Step 3: Wire CommandRow + empty hint in GlobalCommandPalette**

```tsx
// empty state
<div data-testid="global-command-palette-empty">
  <div>{t('commandPalette.noResults')}</div>
  <div className="mt-1 text-caption text-ink-tertiary">{t('commandPalette.noResultsHint')}</div>
</div>

// item
<Command.Item ...>
  <CommandRow item={item} />
</Command.Item>
```

Add `loop` on `<Command shouldFilter={false} loop>`.

- [ ] **Step 4: Fix unit tests for palette**

Update `GlobalCommandPalette.test.tsx`:

- Recent sessions only appear after typing a query (change existing “lists recent sessions” test).  
- Assert CommandRow shows something icon-related via structure or test id if added.

- [ ] **Step 5: Run**

```bash
yarn vitest run src/components/command-palette/
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(command-palette): CommandRow icons and curated empty list without sessions"
```

---

## Task 3: Nested `page` + Theme keepOpen

**Files:**
- Modify: `src/store/commandPaletteStore.ts` (add `setPage` if useful)
- Modify: `src/store/commandPaletteStore.test.ts`
- Modify: `src/components/command-palette/GlobalCommandPalette.tsx`
- Modify: `src/components/command-palette/GlobalCommandPalette.test.tsx`
- Modify: `src/components/command-palette/buildGlobalCommands.ts`

- [ ] **Step 1: Store — ensure page is readable and settable in-palette**

```ts
// commandPaletteStore.ts
setPage: (page: string | null) => void
// setPage: (page) => set({ page }),
// openPage already sets open+page
// close / setOpen(false) clears page (existing)
```

- [ ] **Step 2: Subpage map in GlobalCommandPalette**

Local UI state may mirror store page:

```tsx
const page = useCommandPaletteStore((s) => s.page)
const setPage = useCommandPaletteStore((s) => s.setPage)

const goBack = () => {
  setSearch('')
  setPage(null)
}

const handleSelect = (item: GlobalCommand) => {
  if (item.to) {
    setPage(item.to)
    setSearch('')
    return
  }
  item.run?.()
  if (!item.keepOpen) useCommandPaletteStore.getState().close()
}
```

Theme subpage groups (inline is fine for P0):

```ts
// when page === 'theme'
{
  heading: labels.groupTheme,
  items: [
    { id: 'theme-light', label: ..., icon: 'sun', keepOpen: true, active: theme === 'light', run: () => setTheme('light') },
    // dark, system
  ],
}
```

Root appearance item:

```ts
{
  id: 'appearance-theme',
  label: labels.actionChangeTheme,
  icon: 'palette',
  keywords: ['theme', 'appearance', 'dark', 'light', '主题'],
  to: 'theme',
  group: 'appearance',
}
```

Remove flat theme trio from **root empty list** (they remain reachable via search in T4/T13 or only via subpage for P0 — **P0 minimum:** subpage only; search “dark” can wait for T13 or add searchGroups in same task if cheap).

**Recommended in this task:** also inject theme mode items into root when `search` non-empty (keepOpen), so typing “dark” works without opening subpage.

- [ ] **Step 3: Back chrome + Esc/Backspace**

```tsx
{page && (
  <button type="button" data-testid="global-command-palette-back" onClick={goBack} className="...">
    <ChevronLeft /> {t('commandPalette.back')} / {pageTitle}
  </button>
)}

// Command.Input onKeyDown:
if (page && (e.key === 'Escape' || (e.key === 'Backspace' && search === ''))) {
  e.preventDefault()
  e.stopPropagation()
  goBack()
}
```

Note: Radix Dialog also handles Escape to close. Prefer stopping propagation on subpage Esc so first Esc backs out. Verify manually; if Dialog still closes, use `onEscapeKeyDown` on `Dialog.Content`:

```tsx
onEscapeKeyDown={(e) => {
  if (useCommandPaletteStore.getState().page) {
    e.preventDefault()
    goBack()
  }
}}
```

- [ ] **Step 4: Tests**

```ts
it('openPage theme shows theme options and keepOpen does not close', () => {
  useCommandPaletteStore.getState().openPage('theme')
  render(<GlobalCommandPalette />)
  expect(screen.getByTestId('global-cmd-theme-dark')).toBeInTheDocument()
  fireEvent.click(screen.getByTestId('global-cmd-theme-dark'))
  expect(useCommandPaletteStore.getState().open).toBe(true)
  expect(useUiStore.getState().theme).toBe('dark')
})

it('back clears page', () => {
  useCommandPaletteStore.getState().openPage('theme')
  render(<GlobalCommandPalette />)
  fireEvent.click(screen.getByTestId('global-command-palette-back'))
  expect(useCommandPaletteStore.getState().page).toBeNull()
})
```

- [ ] **Step 5: Run + commit**

```bash
yarn vitest run src/components/command-palette/ src/store/commandPaletteStore.test.ts
git commit -m "feat(command-palette): nested theme page with keepOpen and back navigation"
```

---

## Task 4: Settings deep-links + workspace curated groups

**Files:**
- Modify: `src/components/command-palette/buildGlobalCommands.ts`
- Modify: `src/components/command-palette/buildGlobalCommands.test.ts`
- Modify: `src/components/command-palette/GlobalCommandPalette.tsx` (pass `setSettingsPage`)

- [ ] **Step 1: Extend context**

```ts
export type GlobalCommandContext = {
  // existing fields...
  setSettingsPage: (p: SettingsPageId) => void
  settingsPage?: SettingsPageId
}
```

- [ ] **Step 2: Add workspace commands**

```ts
const SETTINGS_PAGES: SettingsPageId[] = [
  'general', 'model', 'agents', 'mcp', 'skill', 'plugins', 'memory',
]

const CURATED_SETTINGS: SettingsPageId[] = ['model', 'memory', 'skill', 'mcp']

function settingsCommands(ctx, labels, mode: 'curated' | 'all'): GlobalCommand[] {
  const pages = mode === 'curated' ? CURATED_SETTINGS : SETTINGS_PAGES
  return pages.map((page) => ({
    id: `settings-${page}`,
    label: labels.settings[page],
    icon: page === 'memory' ? 'brain' : page === 'skill' ? 'sparkles' : 'settings',
    keywords: ['settings', page, /* zh aliases */],
    group: 'workspace',
    run: () => {
      ctx.setSettingsPage(page)
      ctx.setActiveView('settings')
    },
  }))
}
```

Empty query: curated settings + appearance + nav + actions.  
Search: all settings pages + sessions + theme modes.

- [ ] **Step 3: Tests**

```ts
it('curated empty list includes settings-model and settings-memory', () => { ... })
it('selecting settings-memory calls setSettingsPage and setActiveView', () => { ... })
it('all settings pages appear when searching settings', () => { ... })
```

- [ ] **Step 4: Run + commit**

```bash
yarn vitest run src/components/command-palette/buildGlobalCommands.test.ts
git commit -m "feat(command-palette): settings page deep-links in workspace group"
```

---

## Task 5: Extract domain command actions (slash share)

**Files:**
- Create: `src/domain/commands/memoryActions.ts`
- Create: `src/domain/commands/memoryActions.test.ts`
- Create: `src/domain/commands/codeActions.ts`
- Create: `src/domain/commands/codeActions.test.ts`
- Create: `src/domain/commands/navigationActions.ts`
- Create: `src/domain/commands/index.ts`
- Modify: `src/components/chat/useSlashCommandHandler.ts`
- Modify: `src/components/chat/useSlashCommandHandler.test.tsx`

- [ ] **Step 1: Implement pure-ish action modules**

```ts
// memoryActions.ts
import { toast } from 'sonner'
import { sessionService, useDomainStore } from '@/domain'
import { useUiStore } from '@/store/uiStore'

export function openMemorySettings(): void {
  useUiStore.getState().setSettingsPage('memory')
  useUiStore.getState().setActiveView('settings')
}

export function setUseMemories(sessionId: string, on: boolean): void {
  sessionService.setMemoryFlags(sessionId, { useMemories: on })
}

export function setIncognito(sessionId: string, on = true): void {
  sessionService.setMemoryFlags(sessionId, { incognito: on })
}

export function showMemoryStatus(
  sessionId: string,
  t: (key: string, opts?: Record<string, string>) => string,
): void {
  const sess = useDomainStore.getState().sessions.find((s) => s.id === sessionId)
  const cfg = sess?.config
  toast.message(t('chat.slash.memoryStatusTitle'), {
    description: t('chat.slash.memoryStatusBody', {
      use: cfg?.useMemories === undefined ? 'inherit' : String(cfg.useMemories),
      generate: cfg?.generateMemories === undefined ? 'inherit' : String(cfg.generateMemories),
      incognito: String(!!cfg?.incognito),
    }),
  })
}
```

```ts
// codeActions.ts
export function runDiff(sessionId: string): void {
  sessionService.requestDiff(sessionId)
  useUiStore.getState().setTab('changes')
  // optional: ensure code view
  useUiStore.getState().setActiveView('code')
}

export function runCompact(sessionId: string): void {
  sessionService.compactSession(sessionId)
}

export function runInit(sessionId: string): void {
  sessionService.gitInitWorkspace(sessionId)
}
```

```ts
// navigationActions.ts
export function goSettingsPage(page: SettingsPageId): void {
  useUiStore.getState().setSettingsPage(page)
  useUiStore.getState().setActiveView('settings')
}
```

- [ ] **Step 2: Refactor slash handler to call these**

Replace inline blocks for memory/diff/compact/init/memory settings with imports. Keep clear/help local (composer-specific).

- [ ] **Step 3: Port existing slash tests**

`useSlashCommandHandler.test.tsx` expectations must still pass; if tests spied on `sessionService` directly they should still work.

Add focused unit tests on `memoryActions` / `codeActions` with mocked stores.

- [ ] **Step 4: Run + commit**

```bash
yarn vitest run src/domain/commands/ src/components/chat/useSlashCommandHandler.test.tsx
git commit -m "refactor(commands): extract shared memory and code actions for slash and palette"
```

---

## Task 6: Context commands on palette

**Files:**
- Modify: `src/components/command-palette/buildGlobalCommands.ts`
- Modify: `src/components/command-palette/buildGlobalCommands.test.ts`
- Modify: `src/components/command-palette/GlobalCommandPalette.tsx` (sessionId resolution)

- [ ] **Step 1: Resolve current session in palette**

```tsx
const activeView = useUiStore((s) => s.activeView)
const chatSessionId = useUiStore((s) => s.chatSessionId)
const codeSessionId = useUiStore((s) => s.codeSessionId)
const sessionId =
  activeView === 'code' ? codeSessionId : activeView === 'chat' ? chatSessionId : null
```

Pass into `buildGlobalCommandGroups` as `sessionId` + `activeView` (already has activeView).

- [ ] **Step 2: Context group with `when` filtering**

```ts
function matchesWhen(when: CommandWhen | undefined, ctx): boolean {
  if (!when) return true
  if (when.enabled === false) return false
  if (when.views && !when.views.includes(ctx.activeView)) return false
  if (when.requiresSession && !ctx.sessionId) return false
  return true
}

const contextItems: GlobalCommand[] = [
  {
    id: 'ctx-diff',
    label: labels.context.diff,
    icon: 'git-branch',
    group: 'context',
    when: { views: ['code'], requiresSession: true },
    contextBoost: 0.1,
    run: () => ctx.sessionId && runDiff(ctx.sessionId),
  },
  // compact, init, memory-* similarly
].filter((i) => matchesWhen(i.when, ctx))
```

Empty query: include non-empty context group first.  
Search: include all matching when, still filtered by when.

- [ ] **Step 3: Tests**

```ts
it('includes ctx-diff only for code + session', () => { ... })
it('includes memory-on when sessionId set', () => { ... })
it('omits session-gated commands without session', () => { ... })
```

- [ ] **Step 4: Run + commit**

```bash
yarn vitest run src/components/command-palette/
git commit -m "feat(command-palette): context commands for code and memory"
```

---

## Task 7: Keyboard shortcuts help

**Files:**
- Create: `src/components/command-palette/keys.ts`
- Create: `src/components/command-palette/ShortcutsHelpDialog.tsx`
- Modify: `src/components/command-palette/buildGlobalCommands.ts`
- Modify: `src/components/command-palette/GlobalCommandPalette.tsx`

- [ ] **Step 1: Static help source**

```ts
// keys.ts
export type KeybindHelpEntry = { id: string; combo: string; labelKey: string }

export function getKeybindHelp(isMac: boolean): KeybindHelpEntry[] {
  const mod = isMac ? '⌘' : 'Ctrl+'
  return [
    { id: 'palette', combo: `${mod}K`, labelKey: 'commandPalette.shortcuts.openPalette' },
    { id: 'slash', combo: '/', labelKey: 'commandPalette.shortcuts.slash' },
  ]
}
```

- [ ] **Step 2: Dialog component**

Radix Dialog (or reuse sonner-less simple dialog). `data-testid="keyboard-shortcuts-dialog"`.

- [ ] **Step 3: Palette command**

```ts
{
  id: 'action-keyboard-shortcuts',
  label: labels.actionKeyboardShortcuts,
  icon: 'keyboard',
  shortcut: isMac ? '⌘/' : 'Ctrl+/', // display only; binding optional
  group: 'actions',
  run: () => ctx.openShortcutsHelp(),
}
```

`openShortcutsHelp` sets local state in `GlobalCommandPalette` **after** closing palette (or keep open — prefer close then open help to avoid focus fight).

- [ ] **Step 4: Tests**

- Command exists and `run` invokes help open.  
- Dialog renders entries.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(command-palette): keyboard shortcuts help dialog"
```

---

## Task 8: Titlebar visible trigger

**Files:**
- Modify: `src/components/layout/TitleBar.tsx`
- Modify: `src/components/layout/TitleBar.test.tsx`

- [ ] **Step 1: Add button next to ConnectionStatus / PanelToggle**

```tsx
import { useCommandPaletteStore } from '@/store/commandPaletteStore'
import { Command } from 'lucide-react' // or Search

// inside non-special view tools cluster:
<button
  type="button"
  data-testid="titlebar-command-palette"
  data-tauri-drag-region="false"
  data-no-drag
  aria-label={t('commandPalette.openTriggerAria')}
  title={t('commandPalette.openTrigger')}
  onClick={() => useCommandPaletteStore.getState().setOpen(true)}
  className="..."
>
  <Command size={16} />
</button>
```

Also show on special views (settings/history) if space allows — prefer always available on the right of titlebar.

- [ ] **Step 2: Test**

```ts
it('opens command palette from titlebar button', () => {
  useCommandPaletteStore.setState({ open: false })
  render(<TitleBar />)
  fireEvent.click(screen.getByTestId('titlebar-command-palette'))
  expect(useCommandPaletteStore.getState().open).toBe(true)
})
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(titlebar): visible command palette trigger"
```

---

## Task 9: P0 e2e + regression gate

**Files:**
- Modify: `e2e/specs/command-palette.spec.ts`
- Modify unit tests as needed for any failures

- [ ] **Step 1: Extend e2e cases**

```ts
it('empty open does not list session-* rows by default', async () => {
  await openCommandPaletteForE2e()
  // assert nav exists
  const sessions = await browser.$$('[data-testid^="global-cmd-session-"]')
  expect(sessions.length).toBe(0)
})

it('filters settings-memory and navigates', async () => {
  await openCommandPaletteForE2e()
  const input = await browser.$('[data-testid="global-command-palette-input"]')
  await input.click()
  await browser.keys('memory')
  const cmd = await browser.$('[data-testid="global-cmd-settings-memory"]')
  await cmd.waitForExist({ timeout: 10000 })
  await browser.execute((el: HTMLElement) => el.click(), cmd)
  // settings view visible — use existing settings testid if any
})

it('theme page keepOpen', async () => {
  await openCommandPaletteForE2e()
  // open appearance-theme or search theme
  // select dark
  // palette still open
})

it('titlebar button opens palette', async () => {
  const btn = await browser.$('[data-testid="titlebar-command-palette"]')
  if (await btn.isExisting()) {
    await browser.execute((el: HTMLElement) => el.click(), btn)
    await (await browser.$('[data-testid="global-command-palette"]')).waitForExist({ timeout: 5000 })
  }
})
```

- [ ] **Step 2: Full unit + typecheck**

```bash
yarn vitest run src/components/command-palette/ src/domain/commands/ src/components/chat/useSlashCommandHandler.test.tsx src/components/layout/TitleBar.test.tsx
yarn tsc --noEmit
```

- [ ] **Step 3: e2e (local / CI)**

```bash
yarn test:e2e --spec e2e/specs/command-palette.spec.ts
```

- [ ] **Step 4: Manual checklist**

- [ ] D18: type `/` then ⌘K — slash dismisses  
- [ ] Esc on theme page backs to root; second Esc closes  
- [ ] Settings deep-link lands on correct nav page  
- [ ] zh-CN keywords still filter 历史 / 设置  

- [ ] **Step 5: Commit**

```bash
git commit -m "test(command-palette): e2e coverage for P0 launcher behaviors"
```

**P0 Done gate:** Spec §17 items 1–6.

---

## Task 10 (P1): Fuzzy scoring

**Files:**
- Create or modify: `src/components/command-palette/fuzzyScore.ts` / `rankGlobalCommands.ts`
- Modify: `src/components/command-palette/rankGlobalCommands.test.ts`

- [ ] **Step 1: Implement `fuzzyScore(label, needle): number`**

Rules:

- All needle chars appear in order in label (case-insensitive).  
- Score from gap penalties; clamp to `(0, 0.65]`.  
- Consecutive matches score higher.

- [ ] **Step 2: Integrate**

```ts
const base = /* existing score */
const fuzzy = fuzzyScore(item.label, needle)
return Math.max(base, fuzzy)
```

Only if base === 0 and fuzzy > 0, allow match.

- [ ] **Step 3: Tests**

```ts
expect(scoreItem({ id: '1', label: 'Set Syntax Markdown' }, 'ssmd')).toBeGreaterThan(0)
expect(scoreItem({ id: '1', label: 'Settings' }, 'set')).toBeGreaterThan(
  scoreItem({ id: '1', label: 'Reset data' }, 'set'),
)
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(command-palette): character-level fuzzy ranking"
```

---

## Task 11 (P1): Usage store + boost

**Files:**
- Create: `src/components/command-palette/usageStore.ts`
- Create: `src/components/command-palette/usageStore.test.ts`
- Modify: `GlobalCommandPalette.tsx` — record on successful run  
- Modify: `rankGlobalCommands.ts` — accept optional usage map

- [ ] **Step 1: Storage**

```ts
const KEY = 'hip.commandPalette.usage.v1'
const MAX_KEYS = 500

export function recordCommandUsage(id: string, now = Date.now()): void { ... }
export function loadCommandUsage(): Record<string, { count: number; lastUsedAtMs: number }> { ... }

export function usageBoost(entry, now = Date.now()): number {
  // min(0.15, log1p(count)*0.03) + small recency
}
```

- [ ] **Step 2: Apply only when `score > 0`**

- [ ] **Step 3: Tests with mock localStorage**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(command-palette): persist usage and boost ranking"
```

---

## Task 12 (P1): Registry + skills search

**Files:**
- Create: `src/components/command-palette/registry.ts`
- Create: `src/components/command-palette/registry.test.ts`
- Modify: `buildGlobalCommands.ts` → `coreCommandProvider`  
- Modify: `GlobalCommandPalette.tsx` — skills from domain/sessionService

- [ ] **Step 1: Registry API**

```ts
export type CommandProvider = (ctx: GlobalCommandContext) => PaletteGroup[]

const providers: CommandProvider[] = []

export function registerCommandProvider(p: CommandProvider): () => void {
  providers.push(p)
  return () => { /* remove */ }
}

export function buildAllGroups(ctx: GlobalCommandContext): PaletteGroup[] {
  const core = coreCommandProvider(ctx)
  const extra = providers.flatMap((p) => p(ctx))
  return mergeGroups(core, extra)
}
```

- [ ] **Step 2: Skills provider (search-only)**

```ts
function skillsProvider(ctx): PaletteGroup[] {
  if (!ctx.search?.trim() || !ctx.skills?.length) return []
  return [{
    heading: ctx.labels.groupSkills,
    items: ctx.skills.map((s) => ({
      id: `skill-${s.id}`,
      label: s.name,
      description: s.description,
      icon: 'sparkles',
      keywords: [s.name, s.description, 'skill'],
      group: 'skills',
      run: () => ctx.insertComposerText(`/${s.name} `),
    })),
  }]
}
```

`insertComposerText`: prefer a tiny event/callback registered from chat surface; fallback `goSettingsPage('skill')` if no composer handler.

Minimal approach for hip:

```ts
// domain or module-level
let composerInserter: ((text: string) => void) | null = null
export function registerComposerInserter(fn: ...) { ... }
// InputBar mounts register; palette calls it
```

- [ ] **Step 3: Tests**

- Provider inject visible in buildAllGroups.  
- Skills absent when search empty.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(command-palette): command registry and skills search provider"
```

---

## Task 13 (P1): Footer, highlight, root theme search

**Files:**
- Create: `PaletteFooter.tsx`
- Modify: `rankGlobalCommands.ts` — optional match indices  
- Modify: `CommandRow.tsx` — highlight spans  
- Modify: `buildGlobalCommands` / palette — searchGroups theme modes

- [ ] **Step 1: Footer**

Show when open; hide if `max-h` cramped optional.

- [ ] **Step 2: Highlight**

If fuzzy/score returns indices, wrap matches in `<mark className="bg-transparent text-accent font-medium">`.

- [ ] **Step 3: Root search theme modes with keepOpen** (if not done in T3)

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(command-palette): footer hints, match highlight, theme search shortcuts"
```

---

## Task 14 (P2 backlog — optional tasks)

Do not start until product prioritizes. Each is a separate mini-PR.

| ID | Task | Notes |
|----|------|-------|
| P2-1 | Document `registerCommandProvider` for plugins | + one example test |
| P2-2 | Settings field search | Only if settings schema is enumerable |
| P2-3 | Favorites pin + optional ⌘1–9 | localStorage |
| P2-4 | Query prefixes `>` `#` `@` | parse in rank entry |
| P2-5 | Slash builtin list from shared catalog | reduce dual definition |
| P2-6 | Keybind store live combos | blocked on keybind product |
| P2-7 | a11y pass | axe / keyboard matrix |
| P2-8 | `prefers-reduced-motion` | animate-menu-in |
| P2-9 | Perf: cap sessions 50 / virtualize if needed | measure first |
| P2-10 | Remove `GLOBAL_COMMAND_PALETTE` flag | after 1 stable release |

---

## Verification matrix

| Gate | Command / check |
|------|-----------------|
| Unit P0 | `yarn vitest run src/components/command-palette/ src/domain/commands/ src/components/chat/useSlashCommandHandler.test.tsx src/store/commandPaletteStore.test.ts src/components/layout/TitleBar.test.tsx` |
| Types | `yarn tsc --noEmit` |
| e2e P0 | `yarn test:e2e --spec e2e/specs/command-palette.spec.ts` |
| D18 | Manual: slash open + ⌘K |
| i18n | translation key parity if present |

---

## Risk checklist (implementer)

| Risk | Mitigation in tasks |
|------|---------------------|
| Esc closes dialog instead of subpage back | T3 `onEscapeKeyDown` |
| Sessions tests break | T2 explicitly rewrite expectations |
| Slash regression | T5 keep handler tests green before T6 |
| Composer insert for skills | T12 registerComposerInserter + settings fallback |
| Dialog focus steal with shortcuts help | T7 close palette before help |
| Titlebar drag vs button | `data-no-drag` + `data-tauri-drag-region="false"` |

---

## Progress tracking

Copy into PR description:

```text
P0
- [x] T1 types + i18n + description score
- [x] T2 CommandRow + empty IA
- [x] T3 theme nested page
- [x] T4 settings deep-links
- [x] T5 domain commands extract
- [x] T6 context commands
- [x] T7 shortcuts help
- [x] T8 titlebar trigger
- [x] T9 e2e gate (unit green; e2e needs app run)

P1
- [x] T10 fuzzy
- [x] T11 usage
- [x] T12 registry + skills
- [x] T13 footer / highlight / theme search

P2
- [x] T14: prefixes, favorites, registry docs, slash catalog, a11y, flag off
- [ ] Optional remaining: settings field search (P2-2), live keybind store (P2-6)
```

---

## Next action

Start **Task 1** on a feature branch (e.g. `feat/command-palette-p0`). Do not combine T3 nested page with T5 domain extract in one unreviewable diff; follow PR-A → PR-D for P0.
