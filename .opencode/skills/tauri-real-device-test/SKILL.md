---
name: tauri-real-device-test
description: >-
  Control and verify the hip Tauri desktop app on a real machine. Use when
  testing window resize setSize, right-panel widen, capabilities permissions,
  yarn tauri dev, WebdriverIO e2e, osascript window control, DEV probes, or
  when unit mocks are not enough to prove Tauri IPC behavior.
---

# Tauri real-device testing (hip)

Unit mocks cannot prove Tauri IPC, capabilities, or native window geometry.
Use the layers below; prefer the **lowest layer that answers the question**.

## Decision matrix

| Question | Layer |
|----------|--------|
| Pure TS logic (width math, guards) | vitest + mock `@tauri-apps/api/window` |
| UI click path + DOM assertions | WDIO e2e (`yarn test:e2e`, `@panel`, etc.) |
| Did the **OS window** actually change size? | osascript / WebDriver window API + optional DEV probe |
| Permission denied / silent IPC failure | Real `yarn tauri dev` + capability check + console |
| One-off debug of store → layout → setSize | DEV probe encoding result as window width |

## Layer 1 — Unit (fast, CI)

```ts
// @vitest-environment happy-dom
const setSize = vi.fn().mockResolvedValue(undefined)
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ setSize }),
  LogicalSize: class LogicalSize {
    type = 'Logical'
    constructor(public width: number, public height: number) {}
  },
}))
// Simulate Tauri webview:
;(window as any).__TAURI_INTERNALS__ = {}
```

Gate real Tauri calls with `__TAURI_INTERNALS__ in window` (see `src/lib/rightPanelWidth.ts`).

## Layer 2 — WDIO + Tauri WebDriver (project standard)

Docs: `e2e/README.md`.

```bash
yarn tauri build --debug   # or cargo build → src-tauri/target/debug/hip
yarn test:e2e:smoke
yarn test:e2e --spec e2e/specs/<file>.spec.ts
E2E_GREP=@panel yarn test:e2e
```

- Driver: `@wdio/tauri-service`, `browserName: 'tauri'`
- Prefer `data-testid` selectors already in the app
- Prefer `waitUntil` over long fixed pauses
- Window size: try `browser.setWindowSize(w, h)` / `getWindowSize()`; if unreliable on this driver, use Layer 3–4

## Layer 3 — OS window control (macOS)

Process name is usually `hip` (lowercase).

```bash
# Read
osascript -e 'tell application "System Events" to tell process "hip" to get size of window 1'

# Write
osascript -e 'tell application "System Events" to tell process "hip" to set size of window 1 to {900, 800}'

# Frontmost
osascript -e 'tell application "System Events" to tell process "hip" to set frontmost to true'
```

**Limits:** System Events often only exposes traffic-light buttons — **not** WebView internals. Cannot click `[data-testid=...]` this way. Use WDIO or a DEV probe for in-app actions.

## Layer 4 — DEV probes (temporary, never commit)

When you need to prove a path without WDIO:

1. Run `yarn tauri dev` (must rebuild Rust when `src-tauri/capabilities/*` changes).
2. Add a **short-lived** probe under `import.meta.env.DEV` in `src/main.tsx` (or a store call).
3. Encode outcomes as **window width** so an external script can observe without WebView console:

| Width | Meaning (example convention) |
|------:|------------------------------|
| 1111 | no active session |
| 1222 | `widenWindowForRightPanel` returned false |
| 1333 | direct widen OK |
| 1444 | open-via-store path widened (AppLayout) |
| 1555 | open-via-store path did **not** widen |

```ts
// Pattern only — delete before commit
if (import.meta.env.DEV) {
  void (async () => {
    await new Promise((r) => setTimeout(r, 2500))
    const { getCurrentWindow, LogicalSize } = await import('@tauri-apps/api/window')
    const win = getCurrentWindow()
    const setW = (w: number) => win.setSize(new LogicalSize(w, 800))
    // shrink → exercise path → setW(code)
  })()
}
```

Watch:

```bash
for i in $(seq 1 12); do
  sleep 1
  osascript -e 'tell application "System Events" to tell process "hip" to get size of window 1'
done
```

**Do not** rely on `document.title` when `tauri.conf.json` has `hiddenTitle: true` — the OS title may stay `"hip"`.

**Do not** leave probes in committed code. Remove after verification.

## Critical gotcha — Tauri v2 capabilities

`core:window:default` does **not** include `set_size`.

Without:

```json
"core:window:allow-set-size"
```

in `src-tauri/capabilities/default.json`, `getCurrentWindow().setSize(...)` **throws**. A bare `try/catch` looks like “feature not working” with no UI signal.

After editing capabilities:

1. Restart `yarn tauri dev` (Rust rebuild embeds ACL).
2. Confirm `src-tauri/gen/schemas/capabilities.json` lists the permission.
3. `cargo check` in `src-tauri/` validates capability shape.

Related permissions often needed for window chrome tests: `allow-start-dragging`, `allow-set-effects`, `allow-set-theme` (already used on Windows caption).

## Right-panel widen (product rule)

Source of truth: `src/lib/rightPanelWidth.ts` + open sync in `src/routes/AppLayout.tsx`.

- **Main content width** = `[data-main-content-group]` `clientWidth`, else `innerWidth − sidebar`.
- Target constants: `RIGHT_PANEL_MAIN_TARGET` / `RIGHT_PANEL_SCREEN_MIN` (currently **1600**).
- On `rightOpen → true`: **await widen**, then `panel.expand()`.
- If `screen.availWidth < SCREEN_MIN`, skip widen (original open only).
- Clamp target to `availWidth`; never shrink the window.

**Wire widen in AppLayout (or every open path), not only PanelToggle** — auto-open / store setters bypass the toolbar dropdown.

## setSize coordinate space

```ts
await win.setSize(new LogicalSize(
  Math.round(targetWidth),
  Math.max(1, Math.round(window.innerHeight)), // CSS logical px
))
```

Prefer `window.innerWidth` / `innerHeight` over physical `innerSize()/scaleFactor` unless you intentionally work in physical pixels.

## Verification checklist (window geometry feature)

1. [ ] Unit tests for pure math + guards
2. [ ] Capability permission present and rebuilt
3. [ ] Real app: shrink window (osascript or setSize) → trigger open path → window grows
4. [ ] Screen smaller than target → no enlarge, panel still opens
5. [ ] `yarn type-check` + relevant vitest
6. [ ] No DEV probes left in tree

## Anti-patterns

- Mocking Tauri and claiming “real device verified”
- Swallowing setSize errors without `console.warn` while debugging
- Only testing PanelToggle when other code paths set `*PanelOpen`
- Committing temporary probes or title hacks
- Assuming HMR reloads Rust capabilities (it does not)
