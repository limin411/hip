# Titlebar Fusion Design

## Summary

Merge the system titlebar with the main interface, mimicking Claude Desktop's frameless design. Use Tauri's `titleBarStyle: "overlay"` to make macOS traffic light buttons float over the sidebar content, eliminating the visual separation between OS chrome and application content.

## Motivation

- The system-native titlebar creates a visual "seam" between OS and app
- Modern macOS apps (Claude Desktop, Arc, Spotify, VS Code Terminal) use frameless designs
- More vertical space for content since no dedicated titlebar row exists
- Consistent with the app's minimalist monochrome aesthetic

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Tauri approach | `titleBarStyle: "overlay"` + `trafficLightPosition` | Native traffic lights, no custom window control implementation needed. `trafficLightPosition` (v2.4.0+) provides pixel-level control. |
| Title text | `hiddenTitle: true` | "hip" is displayed in Sidebar; no need for duplicate OS title text |
| Traffic lights position | Precisely positioned over Sidebar top-left via `trafficLightPosition` | Claude Desktop convention; always visible regardless of sidebar state |
| Drag region | Sidebar top area + ChatHeader row + ArtifactPanel header | Top-row draggability without interfering with interactive elements |
| Drag permission | `core:window:allow-start-dragging` | Required for `data-tauri-drag-region` to function; not included in `core:window:default` |
| Sidebar collapse | Independent of traffic lights | Sidebar can fully collapse; traffic lights remain visible |
| ChatHeader toggle | Sidebar toggle moves into Sidebar | ChatHeader simplifies to: session title + panel toggle |
| Fusion style | True Claude Desktop — no separate titlebar row | Content starts from window edge; no visible titlebar/content boundary |

## Architecture

### Tauri Configuration

```json
// src-tauri/tauri.conf.json
"windows": [{
  "title": "hip",
  "width": 1800,
  "height": 1200,
  "maximized": true,
  "titleBarStyle": "overlay",
  "hiddenTitle": true,
  "trafficLightPosition": {
    "x": 19,
    "y": 25
  }
}]
```

| Config | Value | Purpose |
|--------|-------|---------|
| `titleBarStyle` | `"overlay"` | Frameless window + native traffic lights floating over content |
| `hiddenTitle` | `true` | Hides OS "hip" title text (shown in Sidebar instead) |
| `trafficLightPosition` | `{x: 19, y: 25}` | Places traffic lights at 19px from left, 25px from top |

### Capabilities Permission

```json
// src-tauri/capabilities/default.json — add to permissions array
"core:window:allow-start-dragging"
```

Without this permission, `data-tauri-drag-region` attributes are ignored and window dragging silently fails.

`trafficLightPosition` requires Tauri v2.4.0+. The project currently uses `tauri = { version = "2", features = [] }` in Cargo.toml — verify the resolved version is >= 2.4.0.

**`trafficLightPosition` feature compatibility check:**
- Requires `titleBarStyle: "overlay"` AND `decorations: true` (decorations defaults to true)
- Does NOT work with the `unstable` Rust feature flag (bug #14072). The project does not use `unstable`.
- Available in Tauri JS API as `trafficLightPosition?` on `WindowOptions` since 2.4.0

### Layout Structure

```
┌─[●●●]──────────────────────────────────────────┐
│ hip        │ ChatHeader (session title) [panel] │ Artifact
│            │────────────────────────────────   │ Panel
│ Sidebar    │ ChatPane                          │ Header
│ [collapse] │                                   │
│            │                                   │ Content
│ New Chat   │                                   │
│ Search     │                                   │
│            │                                   │
│ Sessions   │                                   │
│            │────────────────────────────────   │
│            │ InputBar                          │
│ User       │                                   │
└────────────────────────────────────────────────┘
```

- Traffic lights (●●●) positioned at `trafficLightPosition` coordinates, floating over Sidebar
- Sidebar content below traffic lights, aligned with their natural padding
- ChatHeader, ChatPane, InputBar all start from window top edge
- Sidebar top area (containing "hip" label) is a drag region

When sidebar collapsed:
```
┌─[●●●]──────────────────────────────────────────┐
│ ▶│ ChatHeader (session title)         [panel]  │ Artifact
│  │──────────────────────────────────────────── │ Panel
│  │ ChatPane                                    │
│  │                                             │
│  │                                             │
│  │──────────────────────────────────────────── │
│  │ InputBar                                    │
│  │                                             │
└────────────────────────────────────────────────┘
│  ┌──────────┐  ← SidebarPeek (on hover)
│  │ Sessions │
│  └──────────┘
```

### Drag Regions

`data-tauri-drag-region` attributes enable window dragging:

| Region | Attribute | Notes |
|--------|-----------|-------|
| Sidebar top (around "hip" label) | `data-tauri-drag-region` | Also serves as traffic light offset area |
| ChatHeader | `data-tauri-drag-region` | Full row draggable |
| ArtifactPanel header | `data-tauri-drag-region` | Tab bar / header area |
| InputBar, buttons, inputs | `data-tauri-drag-region="false"` | Exclude interactive elements |

### Traffic Light Offset in Sidebar

With `trafficLightPosition: {x: 19, y: 25}`, the traffic lights occupy approximately `y=25` to `y=39` (14px button height). The Sidebar content ("hip" label, search, sessions) must begin below this area.

**Calibration approach:**

1. Set `trafficLightPosition` in config
2. Add `padding-top` to Sidebar equal to `trafficLightPosition.y + 14px` (button height) + visual padding
3. Fine-tune visually. Typical values from community (Ghostty, tauri-plugin-decorum):
   - `trafficLightPosition` y: 19–28px
   - Sidebar content offset: ~28–44px from top

**Reference values from tauri-plugin-decorum:**
```rust
main_window.set_traffic_lights_inset(12.0, 16.0).unwrap();
// x-offset: 12px, y-offset: 16px
```

### macOS HIG Compliance

Apple's Human Interface Guidelines state:
> "Avoid creating custom window UI" — don't replicate system window frames/controls.

Our approach complies:
- We use **native traffic lights** via `titleBarStyle: "overlay"` — no custom replicas
- We use `trafficLightPosition` to align them with our layout, not to replace them
- No custom close/minimize/maximize buttons are implemented
- Standard macOS window behavior (resizing, shadows, rounded corners) is preserved

## Files Changed

### 1. `src-tauri/tauri.conf.json`
- Add `"titleBarStyle": "overlay"`, `"hiddenTitle": true`, `"trafficLightPosition": {"x": 19, "y": 25}`

### 2. `src-tauri/capabilities/default.json`
- Add `"core:window:allow-start-dragging"` to permissions array

### 3. `src/routes/AppLayout.tsx`
- Remove `h-screen` from root container (overlay mode doesn't need titlebar height compensation)
- The root container uses `h-dvh` instead

### 4. `src/components/sidebar/Sidebar.tsx`
- Add top padding to offset traffic lights (value determined by `trafficLightPosition.y + 14px`)
- Add `data-tauri-drag-region` to the top area containing "hip" label
- Add sidebar collapse toggle button (moved from ChatHeader)
- The "hip" brand label serves double duty as drag region

### 5. `src/components/chat/ChatHeader.tsx`
- Remove `PanelLeft` (sidebar toggle) button
- Add `data-tauri-drag-region` to root container
- Add `data-tauri-drag-region="false"` to `PanelRight` button
- Keep: session title + `PanelRight` (panel toggle) button

### 6. `src/components/artifact/ArtifactPanel.tsx`
- Add `data-tauri-drag-region` to the tab bar / header area
- Exclude interactive tab buttons with `data-tauri-drag-region="false"`

### 7. `src/components/sidebar/SidebarPeek.tsx`
- Verify `top-0` offset remains correct under overlay mode

### 8. `src/styles/tokens.css`
- Add CSS variable: `--traffic-lights-offset: 44px` (tuned to `trafficLightPosition.y` value)

## Implementation Notes

### overlay mode caveats

- **macOS only**: `titleBarStyle: "overlay"` is a macOS feature. Windows/Linux builds will keep native decorations. This is acceptable since the app targets macOS primarily.
- **No custom minimize/maximize/close**: We don't need to implement these — macOS provides them natively, positioned via `trafficLightPosition`.
- **`hiddenTitle: true` caveat**: Some accessibility tools rely on the window title. The sidebar "hip" label should be made accessible via `aria-label` on the drag region.

### Drag region gotchas

- Elements inside a `data-tauri-drag-region` that need click handling must explicitly have `data-tauri-drag-region="false"`
- This includes: buttons, input fields, dropdown triggers, links
- The `data-tauri-drag-region` CSS (`-webkit-app-region: drag`) is injected by Tauri's runtime stylesheet — no manual CSS needed

### Known Limitation: Unfocused Window Dragging (Tauri #11605)

On macOS, `data-tauri-drag-region` does **not** work when the window is not in focus. If the user clicks another app, then clicks your app's drag region to move the window, the drag will not start until the window receives focus first (requiring a second click).

**Mitigation:** None available in Tauri v2 at this time. This is a platform bug in `tao` (the underlying windowing library). Recommend watching [tauri-apps/tauri#11605](https://github.com/tauri-apps/tauri/issues/11605) for resolution.

**User impact:** Low. macOS users typically click a window first to focus it, then drag. The native titlebar also exhibits this behavior on some macOS versions.

### Sidebar collapse interaction

The collapsed state behavior is unchanged:
- Sidebar panel collapses to 0 width (via `react-resizable-panels`)
- A thin hover zone (current 12px `w-3`) triggers `SidebarPeek` overlay
- SidebarPeek slides in from the left, still managed by the existing peek state machine

The only difference: traffic lights remain visible in the top-left corner when the sidebar is collapsed. Since they're OS-drawn and positioned via `trafficLightPosition`, they remain visible atop the chat area.

### Testing considerations

- WebDriver E2E: `data-tauri-drag-region` attributes don't affect tests; verify sidebar toggle, session title, panel toggle
- Manual QA checklist:
  1. Window appears without native titlebar border (only traffic lights visible)
  2. Dragging by ChatHeader row moves the window (when focused)
  3. Dragging by Sidebar "hip" label area moves the window (when focused)
  4. Traffic lights are at correct position (19px from left, aligned with "hip" label)
  5. Sidebar collapse/expand works normally, traffic lights unaffected
  6. Panel toggle button in ChatHeader responds to clicks (not consumed by drag region)
  7. InputBar text input works (not consumed by drag region)

### Rollback Plan

If `trafficLightPosition` or overlay mode causes issues, the changes are self-contained:
- Remove `titleBarStyle`, `hiddenTitle`, `trafficLightPosition` from `tauri.conf.json`
- Revert `AppLayout.tsx` to `h-screen`
- Remove `data-tauri-drag-region` attributes
- Remove `core:window:allow-start-dragging` permission

## Design Principles Preserved

- **Minimalist aesthetic**: No added chrome, no borders, no shadows — consistent with existing flat design
- **Existing Zustand patterns**: Only primitive selectors per AGENTS.md rules
- **Existing layout**: 3-panel `react-resizable-panels` structure unchanged
- **SidebarPeek**: Unchanged behavior, only traffic lights are independent
- **No new dependencies**: Uses built-in Tauri features (v2.4.0+) and existing Tailwind utilities

## References

- [Tauri v2 WindowConfig — TitleBarStyle](https://v2.tauri.app/reference/config/#titlebarstyle)
- [Tauri v2 WindowConfig — trafficLightPosition](https://v2.tauri.app/reference/config/) (since 2.4.0)
- [Tauri v2 Window Customization Guide](https://v2.tauri.app/learn/window-customization/)
- [Apple HIG — Windows](https://developer.apple.com/design/human-interface-guidelines/windows)
- [tauri-plugin-decorum](https://lib.rs/crates/tauri-plugin-decorum) — community plugin with `set_traffic_lights_inset`
- [Tauri #9503](https://github.com/tauri-apps/tauri/issues/9503) — v1 overlay dragging issue (fixed in v2 with `data-tauri-drag-region`)
- [Tauri #11605](https://github.com/tauri-apps/tauri/issues/11605) — v2 unfocused window drag bug (open)
- [Tauri #14072](https://github.com/tauri-apps/tauri/issues/14072) — `trafficLightPosition` + `unstable` bug (not applicable — project does not use `unstable`)
