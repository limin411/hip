# 智能体管理 Layout Iteration — Design

**Date:** 2026-06-16
**Status:** Approved (brainstorm), pending spec review
**Follow-on to:** `2026-06-16-agent-categories-internal-design.md` (three-category + internal managed agents, MERGED local)

## Goal

Iterate the 智能体管理 (Agent Management) settings page on three axes:

1. **Two-pane layout** — replace the single stacked column with a left filter rail (filters by agent *type*) + a right list pane.
2. **Future-proof ACP** — today only OpenCode is reachable; reserve the UI shape and a preset catalog for Claude Code / Codex / Kimi Code without building their backends.
3. **In-app help** — a 「如何接入」 (how-to-connect) drawer with localized, structured connection guides.

This is a **frontend + pure-data iteration**. No protocol change, no new sidecar provider, no network calls.

## Non-Goals (explicit YAGNI)

- **No real Claude Code / Codex / Kimi Code integration.** No new `AgentProvider`, no new `AcpQuirks` profile wired into spawn, no `buildAcpSpawn` branch. Those presets are *reserved placeholders* (`status: 'coming-soon'`, not selectable).
- **No `AgentConfig` / protocol changes.** Presets only seed the editor form; the existing `quirks` field already carries the OpenCode linkage.
- **No external/network help content.** Help text is static, in-app, localized across all three locales.
- **No new vitest component config.** The project's vitest `include` glob matches `*.test.ts`, not `*.test.tsx`; component behavior is verified by browser-preview GUI (mocked `__TAURI_INTERNALS__.invoke`), consistent with prior iterations. Only pure `.ts` helpers get unit tests.

## Decisions (locked in brainstorm)

- ACP scope = **reserve UI + preset catalog only** (no new backend).
- Help = **in-app right-side drawer** with per-category + per-provider connection guides (localized), deep-linkable.
- Left rail entries = **全部 / 内置核心 / 内部 / CLI / ACP** (each with a count badge).
- `全部` view stays **grouped** (built-in pinned, then three labeled sub-sections) — it is the single overview screen; per-category views are the filtered ones.
- A 「自定义 / 通用 ACP」 escape hatch in the provider picker preserves the generic-ACP creation shipped last iteration.

---

## A. Two-Pane Layout

### A.1 Filter model — `src/lib/agentFilters.ts` (new, pure)

```ts
import type { AgentConfig } from '@hip/protocol'
import { agentCategory, type AgentCategory } from './agentCategory'

export type AgentFilter = 'all' | 'builtin' | AgentCategory   // 'all' | 'builtin' | 'acp' | 'cli' | 'internal'

export interface AgentFilterEntry {
  id: AgentFilter
  /** lucide-react icon name resolved in the component */
  icon: 'layout-grid' | 'sparkles' | 'bot' | 'terminal' | 'plug'
  /** i18n key for the label */
  labelKey: string
}

/** Fixed, ordered rail entries. Order: overview, built-in, then the three categories. */
export const AGENT_FILTERS: AgentFilterEntry[] = [
  { id: 'all',      icon: 'layout-grid', labelKey: 'settings.agents.filterAll' },
  { id: 'builtin',  icon: 'sparkles',    labelKey: 'settings.agents.filterBuiltin' },
  { id: 'internal', icon: 'bot',         labelKey: 'settings.agents.filterInternal' },
  { id: 'cli',      icon: 'terminal',    labelKey: 'settings.agents.filterCli' },
  { id: 'acp',      icon: 'plug',        labelKey: 'settings.agents.filterAcp' },
]

/**
 * Count per rail entry.
 * - builtin is always 1 (the single hip core agent)
 * - all = builtin + every configured agent
 * - internal/cli/acp = configured agents in that category
 */
export function agentFilterCounts(agents: AgentConfig[]): Record<AgentFilter, number> {
  const counts: Record<AgentFilter, number> = { all: agents.length + 1, builtin: 1, acp: 0, cli: 0, internal: 0 }
  for (const a of agents) counts[agentCategory(a)] += 1
  return counts
}
```

### A.2 Composition — `AgentManagement.tsx` (modify)

Becomes the two-pane composition root and owns three pieces of state: `filter: AgentFilter` (default `'all'`), the existing `editing`/`deleting`, and new `help: { open: boolean; sectionId?: string }`.

Structure:

```
<div className="p-6">
  header row: title + intro (left)  ·  「如何接入」 button (right, opens help drawer at overview)
  <div className="mt-5 flex gap-3.5">
    <AgentFilterList active={filter} counts={…} onSelect={setFilter} />
    <AgentListPane
      filter={filter}
      byCat={…} agents={…}
      onAdd={(kind) => setEditing({ mode:'add', kind })}
      onEdit/onToggle/onDelete={…}
    />
  </div>
  {editing && <AgentEditor … onOpenHelp={(id)=>setHelp({open:true, sectionId:id})} />}
  {deleting && <DeleteAgentDialog … />}
  <AgentHelpDrawer open={help.open} sectionId={help.sectionId} onOpenChange={…} />
</div>
```

`byCat` is the existing `useMemo` grouping (unchanged).

### A.3 Left rail — `AgentFilterList.tsx` (new)

Styled like [ProviderList](../../src/components/account/ProviderList.tsx) but **no search box** (only five fixed entries). Width `w-[184px] shrink-0 self-start`, bordered rounded container. Each row: icon + label (flex-1) + count. Active row uses the accent treatment (`bg-accent-active` / accent text), matching ProviderList's active row. Props:

```ts
{ active: AgentFilter; counts: Record<AgentFilter, number>; onSelect: (f: AgentFilter) => void }
```

Icons resolved from a local `Record<entry.icon, LucideIcon>` map (lucide-react `LayoutGrid`, `Sparkles`, `Bot`, `Terminal`, `Plug`).

### A.4 Right pane — `AgentListPane.tsx` (new)

Receives the active filter and renders accordingly:

- **`all`** → `<BuiltinCard />` pinned on top, then the three labeled sub-sections (reuse the current `SECTIONS` map + empty-state markup verbatim). The Add control here is the existing **3-item dropdown menu** (`modal={false}`).
- **`builtin`** → `<BuiltinCard />` only, plus a muted note `settings.agents.builtinOnlyNote` ("内置核心智能体由 hip 提供，不可编辑或删除"). **No Add button.**
- **`internal` / `cli` / `acp`** → a header row (`{categoryTitle}` + a **direct** `新增…` button that calls `onAdd(kindFor(filter))`), then that category's cards (or the dashed empty state).

`kindFor`: `internal → 'internal'`, `cli → 'custom'`, `acp → 'acp'`. The header title reuses the existing `sectionInternal/sectionCli/sectionAcp` keys; the direct-add button reuses `addInternal/addCli/addAcp`.

Props:

```ts
{
  filter: AgentFilter
  byCat: Record<AgentCategory, AgentConfig[]>
  onAdd: (kind: AgentConfig['kind']) => void
  onEdit: (a: AgentConfig) => void
  onToggle: (a: AgentConfig, enabled: boolean) => void
  onDelete: (a: AgentConfig) => void
}
```

The current `AgentManagement` stacked rendering (BuiltinCard + SECTIONS loop + AgentCard wiring + 3-item Add menu) moves into this component for the `all` branch; the per-category branch is new but reuses the same `AgentCard` and empty-state markup.

---

## B. ACP Provider Presets (reserve-only)

### B.1 Catalog — `src/lib/acpPresets.ts` (new, pure)

```ts
import type { AgentAuthMode } from '@hip/protocol'

export type AcpPresetStatus = 'available' | 'coming-soon'

export interface AcpPreset {
  id: string                       // 'opencode' | 'claude-code' | 'codex' | 'kimi-code'
  name: string                     // brand label, NOT localized
  status: AcpPresetStatus
  command: string                  // default executable; '' for coming-soon
  args: string[]                   // default launch args; [] for coming-soon
  quirks?: string                  // quirk-profile key (acp-quirks.ts)
  authModeDefault?: AgentAuthMode  // seeds the editor's auth radio
  docsId: string                   // → agentHelp.ts section id
  icon: 'code' | 'anthropic' | 'cpu' | 'rocket'  // resolved in the picker
}

export const ACP_PRESETS: AcpPreset[] = [
  { id: 'opencode',    name: 'OpenCode',    status: 'available',    command: 'opencode', args: ['acp'], quirks: 'opencode', authModeDefault: 'opencode-self', docsId: 'acp-opencode',    icon: 'code' },
  { id: 'claude-code', name: 'Claude Code', status: 'coming-soon', command: '', args: [], docsId: 'acp-claude-code', icon: 'anthropic' },
  { id: 'codex',       name: 'Codex',       status: 'coming-soon', command: '', args: [], docsId: 'acp-codex',       icon: 'cpu' },
  { id: 'kimi-code',   name: 'Kimi Code',   status: 'coming-soon', command: '', args: [], docsId: 'acp-kimi-code',   icon: 'rocket' },
]

export const CUSTOM_ACP_PRESET_ID = 'custom'   // the 自定义/通用 escape hatch

export function acpPresetById(id: string): AcpPreset | undefined {
  return ACP_PRESETS.find((p) => p.id === id)
}
```

> `AgentAuthMode` is already exported from `@hip/protocol` ([index.ts:38](../../packages/protocol/src/index.ts)) — import it directly; no protocol change needed.

### B.2 Provider picker — `AcpProviderPicker.tsx` (new)

A step shown **only when adding a new ACP agent**. Renders preset cards in a responsive grid:

- **available** → selectable card; clicking calls `onPick(preset)`.
- **coming-soon** → dimmed, non-selectable card with an 「即将支持」 badge and a 「查看接入文档」 link calling `onOpenDocs(preset.docsId)`.
- **custom** → a dashed card 「自定义 / 通用」 calling `onPickCustom()`.

Props:

```ts
{ onPick: (p: AcpPreset) => void; onPickCustom: () => void; onOpenDocs: (sectionId: string) => void }
```

### B.3 Editor flow — `AgentEditor.tsx` (modify)

Add ACP-only step state: `const [acpStep, setAcpStep] = useState<'pick' | 'form'>(...)`.

- Initial `acpStep` = `'pick'` **iff** `initial === null && initialKind === 'acp'`; otherwise `'form'` (CLI, internal, and *editing* any kind skip the picker — current behavior preserved byte-for-byte).
- When `category === 'acp' && acpStep === 'pick'`: render `<AcpProviderPicker … />` inside the modal body (title 「新增 ACP — 选择提供方」). The footer Save/enable row is hidden in the pick step.
- `onPick(preset)` → seed the form, then `setAcpStep('form')`:
  - `command = preset.command`
  - `args = preset.args.join(' ')`
  - `quirks = preset.quirks`
  - `authMode = preset.authModeDefault ?? 'opencode-self'`
  - `transport = 'rich'`
- `onPickCustom()` → leave command/args blank, `quirks = undefined`, `authMode = 'opencode-self'`, `transport = 'rich'`, then `setAcpStep('form')`.
- In the ACP form step, add a small 「← 返回选择提供方」 back link (only when the picker was the entry, i.e. new ACP) that returns to `'pick'`.
- `onOpenDocs` / the form's contextual help link calls a new `onOpenHelp(sectionId: string)` prop (passed from `AgentManagement`) to open the help drawer.

New `AgentEditor` prop: `onOpenHelp?: (sectionId: string) => void`.

No change to the CLI or internal branches, nor to `buildAgentDraft`/`isAgentDraftValid` (the seeded fields flow through the existing draft builder).

### B.4 Backend reserve markers (comment-only, no behavior change)

- [acp-quirks.ts](../../packages/sidecar/src/session/agents/acp-quirks.ts): one comment above `PROFILES` noting future profiles (`claude-code`, `codex`, `kimi-code`) slot in here.
- [acp-config.ts](../../packages/sidecar/src/session/agents/acp-config.ts): one comment in `buildAcpSpawn` noting the body is OpenCode-shaped and a future provider will branch on `agent.quirks`.

These document the reserved extension points the picker references. No logic changes, so no path can reach an unimplemented provider (coming-soon presets are unselectable).

---

## C. In-App Help Drawer

### C.1 Content model — `src/lib/agentHelp.ts` (new, pure)

```ts
export interface HelpSection {
  id: string                 // matches preset.docsId for provider sections
  titleKey: string           // i18n key
  bodyKeys: string[]         // i18n keys, one per paragraph (rendered as <p>)
  status?: 'coming-soon'     // provider sections not yet supported
}

export const HELP_SECTIONS: HelpSection[] = [
  { id: 'overview',        titleKey: 'settings.agents.help.overviewTitle',  bodyKeys: ['settings.agents.help.overviewBody1', 'settings.agents.help.overviewBody2'] },
  { id: 'internal',        titleKey: 'settings.agents.help.internalTitle',  bodyKeys: ['settings.agents.help.internalBody1', 'settings.agents.help.internalBody2'] },
  { id: 'cli',             titleKey: 'settings.agents.help.cliTitle',       bodyKeys: ['settings.agents.help.cliBody1', 'settings.agents.help.cliBody2'] },
  { id: 'acp',             titleKey: 'settings.agents.help.acpTitle',       bodyKeys: ['settings.agents.help.acpBody1', 'settings.agents.help.acpBody2'] },
  { id: 'acp-opencode',    titleKey: 'settings.agents.help.opencodeTitle',  bodyKeys: ['settings.agents.help.opencodeBody1', 'settings.agents.help.opencodeBody2', 'settings.agents.help.opencodeBody3'] },
  { id: 'acp-claude-code', titleKey: 'settings.agents.help.claudeTitle',    bodyKeys: ['settings.agents.help.comingSoonBody'], status: 'coming-soon' },
  { id: 'acp-codex',       titleKey: 'settings.agents.help.codexTitle',     bodyKeys: ['settings.agents.help.comingSoonBody'], status: 'coming-soon' },
  { id: 'acp-kimi-code',   titleKey: 'settings.agents.help.kimiTitle',      bodyKeys: ['settings.agents.help.comingSoonBody'], status: 'coming-soon' },
]

export function helpSectionById(id: string): HelpSection | undefined {
  return HELP_SECTIONS.find((s) => s.id === id)
}
```

### C.2 Drawer — `AgentHelpDrawer.tsx` (new)

A **right-anchored panel** built on the same Radix Dialog primitive family as [Modal](../../src/components/ui/Modal.tsx), but rendered **non-modal** (`modal={false}` semantics: it must NOT set `body{pointer-events:none}`) with its own dimming scrim. Rationale: the drawer can be opened from inside the open `AgentEditor` modal (via 「查看接入文档」); the project has a documented footgun where stacking two pointer-events locks freezes the app, so the drawer must not add a second lock. **As built (a11y refinement):** opening help from inside the editor closes the editor first (`onOpenHelp` clears `editing`) before mounting the drawer — this releases the default-modal editor's focus-trap/`aria-hidden`, which would otherwise leave the non-modal drawer mouse-only for keyboard/screen-reader users. The drawer's `modal={false}` + `pointer-events-auto` scrim remain as defensive design. This `onOpenHelp` path is only reachable from the pre-data provider-pick step, so closing the editor loses nothing.

Internal layout: a left mini-nav listing `HELP_SECTIONS` titles (provider sub-sections indented under ACP, coming-soon ones with a small 「即将支持」 tag) + a right scrollable content area rendering the selected section's title + each `bodyKey` as a `<p>` (with `whitespace-pre-line`).

Props:

```ts
{ open: boolean; sectionId?: string; onOpenChange: (open: boolean) => void }
```

`sectionId` selects the initially-shown section (deep-link from the picker's 「接入文档」); defaults to `'overview'`. Selecting a nav item updates the shown section locally.

### C.3 Entry points

- Page header 「如何接入」 button → `setHelp({ open: true, sectionId: 'overview' })`.
- `AcpProviderPicker` coming-soon 「查看接入文档」 → `onOpenDocs(docsId)` → `onOpenHelp(docsId)` → opens drawer at that provider section.

---

## D. i18n (en / zh-CN / zh-TW)

All three locale files gain a parallel `settings.agents.*` block. New keys:

- **Filters:** `filterAll`, `filterBuiltin`, `filterInternal`, `filterCli`, `filterAcp`.
- **Right pane:** `builtinOnlyNote`, `helpButton`.
- **Picker:** `acpPickTitle` (modal title 「新增 ACP — 选择提供方」), `acpPresetAvailable` (现已支持), `acpPresetComingSoon` (即将支持), `acpPresetCustom` (自定义 / 通用), `acpPresetCustomDesc`, `viewDocs` (查看接入文档), `backToProviders` (← 返回选择提供方).
- **Help:** `help.title`, plus for each `HelpSection`: its `titleKey` and every `bodyKey` listed in C.1 (`overviewTitle/Body1/Body2`, `internalTitle/Body1/Body2`, `cliTitle/Body1/Body2`, `acpTitle/Body1/Body2`, `opencodeTitle/Body1/Body2/Body3`, `claudeTitle`, `codexTitle`, `kimiTitle`, `comingSoonBody`).

Brand names (OpenCode, Claude Code, Codex, Kimi Code) are **not** localized — they live in `acpPresets.ts` as literals.

Follow the existing typed-`t()` pattern (`as const` on key literals where the call site needs the union), per [i18n](../../src/i18n/zh-CN.ts).

---

## E. Testing (paid-free)

Pure-helper unit tests only (`.test.ts`, which the vitest glob runs):

1. `src/lib/agentFilters.test.ts`
   - `agentFilterCounts([])` → `{ all: 1, builtin: 1, acp: 0, cli: 0, internal: 0 }`.
   - mixed roster → correct per-category counts and `all === agents.length + 1`.
   - `AGENT_FILTERS` ids are exactly `['all','builtin','internal','cli','acp']` in order.

2. `src/lib/acpPresets.test.ts`
   - exactly one `opencode` preset; `status === 'available'`; `command` non-empty; `quirks === 'opencode'`; `authModeDefault === 'opencode-self'`.
   - `claude-code`, `codex`, `kimi-code` present; each `status === 'coming-soon'` with empty `command`.
   - all `docsId`s unique; all preset ids unique.
   - `acpPresetById('opencode')` returns it; unknown id → `undefined`.

3. `src/lib/agentHelp.test.ts`
   - section ids unique.
   - **cross-link:** every non-custom `ACP_PRESETS[i].docsId` resolves via `helpSectionById`.
   - coming-soon presets map to `status: 'coming-soon'` help sections; the `opencode` preset maps to a section without that status.
   - `helpSectionById('overview')` exists; unknown id → `undefined`.

Components (`AgentFilterList`, `AgentListPane`, `AcpProviderPicker`, `AgentHelpDrawer`, edited `AgentEditor`/`AgentManagement`) are verified by **browser-preview GUI** with a mocked `__TAURI_INTERNALS__.invoke`, consistent with the prior two iterations: left-rail selection filters the right pane; per-category Add opens the editor at the right step; new-ACP shows the picker (OpenCode selectable, others disabled + doc link); custom card → blank form; help button + doc link open the drawer at the right section; editor + drawer coexist without freezing.

Full-suite run must move `~/.hip/config/auth.json` aside (trap-restore) to stay paid-free; never run bare `vitest run src` (substring-matches the sidecar paid suites).

---

## F. File Summary

**New (pure):** `src/lib/agentFilters.ts`, `src/lib/acpPresets.ts`, `src/lib/agentHelp.ts`
**New (components):** `src/components/account/AgentFilterList.tsx`, `AgentListPane.tsx`, `AcpProviderPicker.tsx`, `AgentHelpDrawer.tsx`
**Modify:** `src/components/account/AgentManagement.tsx`, `AgentEditor.tsx`, `src/i18n/{en,zh-CN,zh-TW}.ts`
**Comment-only:** `packages/sidecar/src/session/agents/acp-quirks.ts`, `acp-config.ts`
**Test:** `src/lib/agentFilters.test.ts`, `acpPresets.test.ts`, `agentHelp.test.ts`
**No protocol change:** `AgentAuthMode` is already exported from `@hip/protocol` (import directly).
