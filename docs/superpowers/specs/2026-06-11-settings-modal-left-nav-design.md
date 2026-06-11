# Settings modal: left navigation + 通用设置 page

Date: 2026-06-11
Status: approved (design), pending implementation

## Problem

The settings modal (opened from the bottom-left user menu → 设置) is a single flat
list: DeepSeek API Key, then 界面语言. There is no structure to group settings or to
add new categories later. We want to introduce a left-side navigation rail inside
the modal and move today's settings under a single page named **通用设置**, with the
nav built to grow as more setting categories are added.

## Scope

- **In scope:** restructure the settings modal into a two-pane shell (left nav +
  content). Move the existing API Key + 界面语言 settings, unchanged in behavior,
  into one **通用设置** page. Widen the modal. Frontend only.
- **Out of scope (per decision):** any additional settings pages. The nav is built
  as an extensible registry, but only the real **通用设置** page ships now — no
  greyed-out / "coming soon" placeholder items in the rail. Adding a page later =
  one registry entry + one page component.

## Non-goals

- No change to API-key logic (`saveApiKey` / `clearApiKey` / `restartSidecar`) or
  to language switching — those move verbatim into the new page component.
- No change to the generic `Modal` component itself (it already accepts `className`).
- No change to the modal trigger or its open/close state (`uiStore.settingsOpen`).
- No new `.tsx` test harness (repo has none; vitest runs in `node`). Verification
  stays GUI acceptance, per project preference.

## Design

The generic `Modal` stays as-is; only the content it wraps changes. `SettingsPanel`
is rewritten from a flat list into a two-pane shell driven by a page registry, and
the current settings content is extracted into its own page component so each page
is an independent, self-contained unit.

### Component shape

```
Modal (title="设置", className widened)
└── SettingsPanel               ← two-pane shell + page registry + active state
    ├── left nav (Radix Tabs, vertical)
    │   └── 通用设置  ← active by default (only item today)
    └── content pane
        └── GeneralSettings      ← the current API Key + 界面语言 blocks, moved verbatim
```

The page registry is a local array so growth is trivial:

```ts
const PAGES = [
  { id: 'general', icon: SlidersHorizontal, labelKey: 'settings.general', Component: GeneralSettings },
] as const
```

Active page is local `useState` seeded to `'general'`. (Implemented on Radix Tabs
`orientation="vertical"`, which gives roving-tabindex keyboard nav for free once
more pages exist; the underline-styled `ui/Tabs.tsx` wrappers are horizontal and
are **not** reused — the rail uses the primitives with custom vertical styling.)

> Alternative considered: keep everything inline in one `SettingsPanel.tsx` and
> switch with `useState`. Simpler today, but it gives the pages no boundary, which
> defeats the extensibility we explicitly want. Rejected.

### Change 1 — New `GeneralSettings.tsx` (extracted, behavior-identical)

File: `src/components/account/GeneralSettings.tsx` (new).

- Move the current `SettingsPanel` body verbatim: the API Key block (status,
  password input, 保存 / 清除 buttons, error line) and the 界面语言 block (select).
- Keep all state and effects as-is (`isApiKeyConfigured`, `saveApiKey`,
  `clearApiKey`, `restartSidecar`, `i18n.changeLanguage`). No logic changes.
- Outer wrapper stays the existing `flex flex-col` with the same `px-6 py-5`
  section padding, so the page looks identical to today inside the content pane.

### Change 2 — `SettingsPanel.tsx` becomes the two-pane shell

File: `src/components/account/SettingsPanel.tsx` (rewritten).

- Render a `flex` row with `min-h-[400px]` so the rail has presence even with one
  short page.
- **Left nav:** `shrink-0`, width ~168px, `bg-surface-subtle` + `border-r border-border`,
  padding `p-2`. Each item follows the existing `SessionItem` affordance —
  `flex items-center gap-2 rounded-md px-2.5 py-2 text-body transition-colors`,
  with a leading lucide `SlidersHorizontal` (size ~16) + the page label.
  - Active: `bg-accent-active text-accent-strong`.
  - Inactive (future pages): `text-ink-secondary hover:bg-surface-muted`.
- **Content pane:** `flex-1 min-w-0 overflow-y-auto` renders the active page's
  `Component`. The rail stays put; the content pane owns vertical scroll if a page
  ever exceeds the height.
- Default selected page: `general`.

### Change 3 — Widen the modal

File: `src/components/sidebar/UserMenu.tsx`.

- Pass `className="max-w-2xl"` to `<Modal>` (≈672px, up from `max-w-lg`/512px) so
  the ~168px rail is added beside a content pane that keeps roughly today's width.
  `Modal` merges via `cn` (tailwind-merge), so `max-w-2xl` cleanly overrides the
  default `max-w-lg`.
- Modal `title` stays `t('settings.title')` ("设置"); the header (title + close ✕)
  is unchanged. The nav labels are the sub-pages beneath it.

### i18n

Add `general` under the existing `settings` object in all three locales:

- `src/i18n/zh-CN.ts` → `general: '通用设置'`
- `src/i18n/zh-TW.ts` → `general: '通用設置'`
- `src/i18n/en.ts`    → `general: 'General Settings'`

`settings.title` ("设置" / "設置" / "Settings") is unchanged and remains the modal
header.

## Verification

- **Behavior:** API-key save/clear and language switch are moved, not modified, so
  no functional regression is expected.
- **No test selectors at risk:** a repo-wide search confirms only
  `SettingsPanel.tsx` and `UserMenu.tsx` reference the settings UI — no E2E/unit
  test opens settings, and the modal title "设置" stays the same.
- **GUI acceptance (dev preview):** open 设置 from the user menu → confirm the left
  rail shows a single active **通用设置** item and the content pane shows API Key +
  界面语言; verify API Key 保存 / 清除 still work and switching language still
  re-renders; resize check at the wider `max-w-2xl` width and on a narrow window
  (the Modal's `w-[calc(100vw-2rem)]` cap still applies).

## Risks / notes

- Confirm `accent-active` / `accent-strong` / `surface-subtle` / `surface-muted`
  tokens exist (they do — used by `SessionItem`); reuse them rather than new values.
- A one-item rail is intentional (extensibility scaffold). It should read as a
  deliberate, sparse panel, not an empty/broken one — the `min-h-[400px]` and the
  surface-tinted rail background carry that.
- Keep `GeneralSettings` a pure presentational/stateful page with no knowledge of
  the rail, so future pages can be added without touching it.
