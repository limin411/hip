# Windows Visual Polish — Platform Chrome, Type, Vibrancy

| Field | Value |
|-------|-------|
| **Title** | Windows (and Linux) visual parity with macOS-quality desktop chrome |
| **Author** | hip |
| **Date** | 2026-07-17 |
| **Status** | Ready for implementation |
| **Related** | `src/styles/tokens.css`, `src/lib/windowVibrancy.ts`, `src/components/layout/AppSidebar.tsx`, `src/components/layout/MainToolbar.tsx`, `src-tauri/tauri.conf.json`, [`2026-07-16-app-shell-sidebar-spec.md`](./2026-07-16-app-shell-sidebar-spec.md) |
| **Supersedes (partial)** | App-shell Non-Goal “Custom Windows titlebar” and platform table row “Win/Linux: OS decorations; no glass” — those were deliberate v1 deferrals; this doc promotes them to goals |

---

## Overview

hip looks strong on macOS (Overlay traffic lights + `Sidebar` vibrancy + SF metrics + flat hairlines over real material) and weak on Windows (native title bar + empty sidebar top + Mica/Acrylic mismatch or dirty semi-transparent fallback + Segoe/CJK stack + flat chrome with no depth).

This design makes **Windows a first-class visual host** without redesigning product IA or the brand palette. Goal is not pixel-identical macOS: goal is a credible modern Windows 11 desktop client that reuses hip tokens.

---

## Background & Motivation

### Current state (as of 2026-07-17)

| Layer | macOS | Windows / Linux |
|-------|-------|-----------------|
| Window frame | `titleBarStyle: Overlay` + traffic lights over sidebar | Default **OS decorations** (double chrome: system bar + `MainToolbar`) |
| Vibrancy | `Effect.Sidebar` + `data-vibrancy=native` glass tint | Mica → Acrylic → Blur try-chain; fail → solid body but **sidebar still `glass-surface` half-transparent** (dirty) |
| Sidebar top | `h-10` + `--titlebar-lights-inset: 90px` | Same empty `h-10` with 8px inset — wasted blank strip |
| Fonts | `-apple-system` → SF | Segoe; **no CJK** in production stack; `antialiased` hurts ClearType |
| Mono | `SF Mono` first | Missing SF Mono; no Cascadia/Consolas |
| Spec stance | Fully polished | Explicit Non-Goal for custom caption; “no glass” |

### Why it reads “ugly” on Windows

1. **Double title chrome** — system min/max/close + in-app 40px toolbar.
2. **False glass** — semi-transparent sidebar without reliable native material.
3. **Typography** — stack and smoothing tuned for Apple; CJK fallback uncontrolled.
4. **Flat language without material** — shadows stripped; on mac vibrancy supplies depth; on Win it does not.
5. **Empty mac clearance row** on non-mac platforms.

### Why change now

Shell v2 (sidebar) shipped. Remaining gap is host chrome, not IA. Users compare mac and Win builds of the same product.

---

## Goals & Non-Goals

### Goals

1. **Typography**: platform-aware font stack (UI + CJK + mono) and Windows ClearType-friendly smoothing.
2. **Vibrancy modes**: explicit modes (`mac-sidebar` | `win-mica` | `win-acrylic` | `solid` | off) driving CSS; **never** half-transparent glass without native material.
3. **Sidebar top**: mac keeps traffic-light clearance; Win/Linux collapse empty clearance (tight drag or brand-free slim strip).
4. **Windows caption**: frameless (runtime `setDecorations(false)`) + in-content min / max / close on `MainToolbar`; single logical top chrome.
5. **Linux**: solid chrome (no fake glass); keep OS decorations (no custom caption in v1 of this work).
6. **macOS**: no visual regression (Overlay + Sidebar path unchanged).
7. **Tests**: unit coverage for platform detection, vibrancy mode marking, caption controls render gates.
8. **Incremental PRs** that each leave the app usable.

### Non-Goals

- Redesign brand colors, chat bubbles, knowledge editor, or artifact panels.
- Force Windows to look identical to macOS (wrong platform idiom).
- Custom Linux client-side caption (defer).
- Web fonts / bundled Inter subset (optional later; system fonts first).
- Fix WebView2 bugs outside our control (document workarounds only).
- Change Auth / sidecar / protocol.

---

## Key Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Promote custom Windows caption** (override shell Non-Goal) | Double chrome is the largest layout-quality gap; OS decorations cannot merge with Overlay-style immersion. |
| D2 | **Vibrancy mode enum on `data-vibrancy`**, not boolean `native` | CSS and diagnostics need to know Mica vs solid vs mac Sidebar; single `native` hid Win failures. |
| D3 | **Win11 prefer Mica; Win10/fail → solid sidebar** (Acrylic optional last-resort, no CSS blur on top) | Acrylic + CSS blur is dirty/slow; solid Fluent-like sidebar is better than fake glass. |
| D4 | **Runtime `setDecorations(false)` only on Windows** | Keep mac Overlay + traffic lights; avoid global conf that breaks mac or Linux. |
| D5 | **Caption buttons live in `MainToolbar` (right cluster)** | Main column already has drag + global actions; avoids a third horizontal bar. Sidebar stays product nav. |
| D6 | **Font stack uses `system-ui` + explicit CJK** | Matches prototype HTML; production tokens had dropped CJK. |
| D7 | **Windows: `-webkit-font-smoothing: auto`** | Restore ClearType; `antialiased` greyscale often looks soft on Win. |
| D8 | **No new palette** | Depth via solid fills / borders / correct material, not new hues. |

---

## Proposed Design

### 1. Platform attribute (unchanged contract)

`src/main.tsx` continues to set `html[data-platform]` = `mac` | `windows` | `linux`.

Centralize detection in `src/lib/platform.ts` so layout, vibrancy, and caption share one implementation:

```ts
export type HipPlatform = 'mac' | 'windows' | 'linux' | 'unknown'
export function detectHipPlatform(): HipPlatform
export function isMacPlatform(): boolean
export function isWindowsPlatform(): boolean
```

`windowVibrancy.detectVibrancyPlatform` becomes a thin alias or re-exports from `platform.ts`.

### 2. Typography (`tokens.css` + `tailwind.config.js`)

**Body / sans**

```css
body {
  font-family:
    system-ui, -apple-system, BlinkMacSystemFont,
    'Segoe UI', 'Segoe UI Variable',
    'PingFang SC', 'Hiragino Sans GB',
    'Microsoft YaHei UI', 'Microsoft YaHei',
    'Noto Sans CJK SC', 'Noto Sans SC',
    sans-serif;
  font-size: 13px;
  line-height: 1.7;
  -webkit-font-smoothing: antialiased; /* default (mac-friendly) */
  text-rendering: optimizeLegibility;
}

html[data-platform="windows"] body {
  -webkit-font-smoothing: auto;
  text-rendering: auto;
}
```

**Mono (Tailwind `fontFamily.mono`)**

```js
mono: [
  'ui-monospace',
  'Cascadia Mono', 'Cascadia Code',
  'SF Mono', 'JetBrains Mono',
  'Consolas', 'Menlo', 'monospace',
]
```

**Sans Tailwind mirror**: same stack as body for `font-sans`.

No webfont fetch; CSP stays as-is.

### 3. Vibrancy modes

#### 3.1 Mode values

| `data-vibrancy` | Meaning | Body bg | `.glass-surface` |
|-----------------|---------|---------|------------------|
| *(absent)* | Browser / pre-init | solid `--bg-app` | CSS blur fallback OK for web |
| `mac-sidebar` | macOS NSVisualEffect Sidebar applied | transparent | tint only, **no** CSS blur |
| `win-mica` | Windows 11 Mica applied | transparent | tint only, **no** CSS blur |
| `win-acrylic` | Acrylic applied (rare) | transparent | **thicker** tint, no CSS blur |
| `solid` | Explicit solid host (Win fail, Linux, reduced transparency) | solid `--bg-app` | **solid** `--bg-subtle` |

#### 3.2 Apply logic (`enableNativeVibrancy`)

```
platform mac:
  setTheme → setEffects(Sidebar) → mark mac-sidebar | solid on failure

platform windows:
  setTheme
  try Mica → mark win-mica
  else try Acrylic (with tint color) → mark win-acrylic
  else mark solid (do NOT try Blur as success for glass UI)

platform linux / unknown:
  mark solid
```

Drop “Blur as last resort success” — Blur on modern Win is poor and still not Sidebar-like; prefer solid.

#### 3.3 CSS

Replace broad `html[data-vibrancy="native"]` with:

```css
html[data-vibrancy="mac-sidebar"],
html[data-vibrancy="win-mica"],
html[data-vibrancy="win-acrylic"] {
  --glass-bg: color-mix(in srgb, var(--bg-subtle) 70%, transparent);
  --glass-backdrop: none;
  --titlebar-bg: var(--glass-bg);
  --titlebar-backdrop: none;
}

html.dark[data-vibrancy="mac-sidebar"],
html.dark[data-vibrancy="win-mica"] {
  --glass-bg: color-mix(in srgb, var(--bg-subtle) 86%, transparent);
}

html.dark[data-vibrancy="win-acrylic"] {
  --glass-bg: color-mix(in srgb, var(--bg-subtle) 92%, transparent);
}

html[data-vibrancy="solid"] {
  --glass-bg: var(--bg-subtle);
  --glass-backdrop: none;
  --titlebar-bg: var(--bg-app);
  --titlebar-backdrop: none;
}

html:not([data-vibrancy="mac-sidebar"]):not([data-vibrancy="win-mica"]):not([data-vibrancy="win-acrylic"]) body {
  background: var(--bg-app);
}
/* native material hosts keep transparent body — explicit list */
html[data-vibrancy="mac-sidebar"] body,
html[data-vibrancy="win-mica"] body,
html[data-vibrancy="win-acrylic"] body {
  background: transparent;
}
```

Windows platform overrides that force pure `--titlebar-bg: var(--bg-app)` must **not** override native material modes (order: platform defaults → solid → native modes last for material hosts).

#### 3.4 Theme sync

`syncVibrancyWithTheme` re-runs `enableNativeVibrancy` (already does); ensure mode rematch after dark class toggle.

### 4. Sidebar top platformization (`AppSidebar`)

| Platform | Drag row |
|----------|----------|
| mac | Keep `h-10` + lights inset spacer (`--titlebar-lights-inset: 90px`) |
| windows / linux | **`h-3` (12px)** minimal drag strip, **no** lights spacer; primary drag remains `MainToolbar` |

Rationale: Win custom caption lives on MainToolbar; empty 40px over search looks broken.

`data-testid="sidebar-drag-region"` retained for e2e.

### 5. Windows custom caption

#### 5.1 Runtime chrome (`src/lib/windowChrome.ts`)

Called from `main.tsx` after platform attr (Tauri only):

```ts
export async function applyPlatformWindowChrome(): Promise<void> {
  if (!isWindowsPlatform()) return
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const win = getCurrentWindow()
    await win.setDecorations(false)
    await win.setShadow(true).catch(() => {})
    document.documentElement.dataset.caption = 'custom'
  } catch {
    // browser / API missing — leave OS decorations
    delete document.documentElement.dataset.caption
  }
}
```

Do **not** set `decorations: false` in `tauri.conf.json` globally (mac/Linux safety).

#### 5.2 `WindowCaptionButtons` component

Path: `src/components/layout/WindowCaptionButtons.tsx`

- Render **only** when `document.documentElement.dataset.caption === 'custom'` **or** `data-platform="windows"` after chrome applied (prefer `data-caption="custom"` gate so browser e2e without Tauri stays clean).
- Buttons: minimize · maximize/restore · close.
- APIs: `minimize()`, `toggleMaximize()`, `close()`; track `isMaximized` via `onResized` / `onMoved` / initial query.
- Styling: 46×32 hit targets (Win11-ish), hover states; close hover uses danger red fill; `data-no-drag` + `data-tauri-drag-region="false"`.
- i18n aria labels: en / zh-CN / zh-TW under `windowCaption.*`.
- `data-testid`: `window-caption`, `window-caption-min`, `window-caption-max`, `window-caption-close`.

#### 5.3 Placement

`MainToolbar` right cluster order:

```
[ ⌘K ] [ ConnectionStatus? ] [ PanelToggle? ] [ WindowCaptionButtons? ]
```

Toolbar remains `data-tauri-drag-region` + `useWindowDrag`; caption buttons excluded from drag.

Optional: double-click on empty toolbar title area toggles maximize (Windows convention) — implement if cheap via `onDoubleClick` on title div when `data-caption=custom`.

#### 5.4 Login screen

Login already uses full-page drag. On Windows frameless:

- Mount a thin top-right `WindowCaptionButtons` absolutely on login layout, **or** call same chrome and add buttons to `LoginScreen` corner.
- Required so users can close/min without OS bar.

### 6. Linux

- `data-vibrancy=solid`
- OS decorations kept
- Sidebar top slim (same as Win pre-caption / shared non-mac)
- No caption buttons

### 7. macOS regression guard

- Do not call `setDecorations(false)` on mac
- Keep `titleBarStyle: Overlay`, traffic lights, inset 90px, `Effect.Sidebar`
- Font stack still prefers system-ui / -apple-system first

---

## Interaction contracts

### Cold start (desktop)

1. Set `data-platform`
2. `applyPlatformWindowChrome()` (Win → frameless + `data-caption=custom`)
3. `enableNativeVibrancy()` → set `data-vibrancy`
4. React mount; ThemeProvider may re-sync vibrancy on theme

### Theme toggle

ThemeProvider applies `.dark` then `syncVibrancyWithTheme()` → re-setEffects + remint acrylic colors if any.

### Caption buttons

| Control | Action |
|---------|--------|
| Min | `window.minimize()` |
| Max | `window.toggleMaximize()`; icon swaps restore when maximized |
| Close | `window.close()` |

### Failure modes

| Failure | Fallback |
|---------|----------|
| `setEffects` throws | `data-vibrancy=solid`, opaque body + solid sidebar |
| `setDecorations` throws | no `data-caption`; no custom buttons; OS bar remains |
| Non-Tauri (unit / vite browser) | solid body CSS; no caption; no effects |

---

## File touch list

| File | Change |
|------|--------|
| `docs/design/2026-07-17-windows-visual-polish-spec.md` | This spec |
| `docs/design/README.md` | Link |
| `src/lib/platform.ts` | **New** — detect helpers |
| `src/lib/platform.test.ts` | **New** |
| `src/lib/windowVibrancy.ts` | Modes, solid-first fallback, use platform |
| `src/lib/windowVibrancy.test.ts` | Mode marking tests |
| `src/lib/windowChrome.ts` | **New** — Win decorations |
| `src/lib/windowChrome.test.ts` | **New** — no-op outside Tauri/Win |
| `src/styles/tokens.css` | Fonts, vibrancy CSS, platform rules |
| `tailwind.config.js` | fontFamily sans/mono |
| `src/main.tsx` | platform helper + chrome + vibrancy order |
| `src/components/layout/AppSidebar.tsx` | Slim top on non-mac |
| `src/components/layout/AppSidebar.test.tsx` | Optional platform cases |
| `src/components/layout/MainToolbar.tsx` | Caption + dblclick maximize |
| `src/components/layout/WindowCaptionButtons.tsx` | **New** |
| `src/components/layout/WindowCaptionButtons.test.tsx` | **New** |
| `src/routes/LoginScreen.tsx` | Caption on Win frameless |
| `src/i18n/en.ts`, `zh-CN.ts`, `zh-TW.ts` | `windowCaption.*` |
| `docs/design/2026-07-16-app-shell-sidebar-spec.md` | Short “Superseded in part” note (optional one-liner in README only if we avoid editing frozen shell spec) |

No Rust changes required for v1 (JS `setDecorations` / `setEffects` suffice).

---

## Testing plan

1. **Unit**
   - `detectHipPlatform` UA matrix (Mac / Win / Linux)
   - `markVibrancyMode` / enable returns false outside Tauri → solid or off
   - `WindowCaptionButtons` hidden without `data-caption=custom`; visible with it; clicks call mocked window API
   - `AppSidebar` drag region height class under stubbed platform if tested
2. **Manual (Windows 11)**
   - Cold light/dark; maximize; drag toolbar; caption min/max/close
   - Sidebar solid vs mica (visual)
   - Login close button present
3. **Manual (macOS)**
   - Traffic lights position unchanged; sidebar vibrancy; no caption buttons
4. **Regression**
   - `yarn test` for touched packages; `yarn tsc`

---

## Rollout

- Ship on existing `dev.*` branch; no feature flag (chrome is host-level; half-on is worse).
- If Win frameless regressions appear in the wild: gate caption behind quick revert = stop calling `setDecorations(false)` (buttons auto-hide without `data-caption`).

---

## Open Questions

None blocking. Deferred optional:

- Q1: Win10-only Acrylic as opt-in setting — **out of v1** (solid default).
- Q2: Bundled Inter — **out of v1**.
- Q3: Linux custom caption — **out of v1**.

---

## Alternatives considered

| Alternative | Why rejected |
|-------------|--------------|
| Keep OS decorations; only fix fonts/CSS | Leaves double chrome — largest remaining ugly factor |
| Global `decorations: false` in tauri.conf | Risks mac Overlay / Linux; runtime Win-only safer |
| CSS-only glass blur on Win instead of Mica | Double-blur dirty; poor performance |
| Blur effect as success mode | Not Sidebar-like; prefer solid |
| Separate top Windows title bar component full-width | Third bar; worse density than folding into MainToolbar |
| Web font for perfect parity | Bundle size + CSP + CJK cost; system fonts first |

---

## PR Plan

### PR-W1 — Typography + solid glass contract + sidebar top

- **Scope**: fonts/smoothing/CJK/mono; CSS solid vs material; platform sidebar top height; extract `platform.ts`; stop treating Blur as glass success if touched early.
- **Files**: `tokens.css`, `tailwind.config.js`, `platform.ts(+test)`, `windowVibrancy.ts(+test)` (partial), `AppSidebar.tsx`, `main.tsx` (import platform).
- **Depends**: none
- **Done when**: non-mac sidebar top is slim; `data-vibrancy=solid` yields opaque sidebar; unit tests green; mac paths unchanged in code review.

### PR-W2 — Vibrancy mode enum (full)

- **Scope**: replace `native` with `mac-sidebar` | `win-mica` | `win-acrylic` | `solid`; CSS selectors; ThemeProvider continues to sync.
- **Files**: `windowVibrancy.ts(+test)`, `tokens.css`
- **Depends**: PR-W1 (platform helper)
- **Done when**: no remaining `data-vibrancy=native`; tests assert mode strings.

### PR-W3 — Windows custom caption + login chrome

- **Scope**: `windowChrome.ts`, `WindowCaptionButtons`, MainToolbar + LoginScreen, i18n.
- **Files**: listed in § File touch list for chrome
- **Depends**: PR-W1 (platform)
- **Done when**: on Win Tauri, no OS title bar, caption works, drag still works; mac shows no caption buttons; unit tests for visibility gate.

### Implementation note

PR-W1…W3 may land as **one branch / one commit series** if reviewed together; logical boundaries above still structure the diff and tests.

---

## Success criteria

1. Windows: single app top chrome (no OS title bar when Tauri chrome apply succeeds).
2. Windows: no dirty translucent sidebar without material (solid or real Mica/Acrylic).
3. Windows: body text uses ClearType-friendly smoothing; CJK fonts in stack.
4. macOS: no intentional visual change to lights, inset, Sidebar material.
5. Linux: solid, no crash, slim sidebar top.
6. Automated tests for platform, vibrancy modes, caption gate pass.
)
