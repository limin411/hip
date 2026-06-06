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
| Tauri approach | `titleBarStyle: "overlay"` | Native traffic lights, no custom window control implementation needed |
| Traffic lights position | Floating over Sidebar top-left | Claude Desktop convention; always visible regardless of sidebar state |
| Drag region | Sidebar top area + ChatHeader row + ArtifactPanel header | Top-row draggability without interfering with interactive elements |
| Sidebar collapse | Independent of traffic lights | Sidebar can fully collapse; traffic lights remain visible |
| ChatHeader toggle | Sidebar toggle moves into Sidebar | ChatHeader simplifies to: session title + panel toggle |
| Fusion style | True Claude Desktop — no separate titlebar row | Content starts from window edge; no visible titlebar/content boundary |

## Architecture

### Tauri Configuration

```json
// tauri.conf.json — single-line change
"windows": [{
  "title": "hip",
  "width": 1800,
  "height": 1200,
  "maximized": true,
  "titleBarStyle": "overlay"   // <- NEW
}]
```

`titleBarStyle: "overlay"` (macOS only):
- Makes the window frameless
- Keeps native traffic light buttons drawn by macOS
- Traffic lights float over the content area at top-left
- App gets full control of the entire window area (no reserved titlebar height)

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

- Traffic lights (●●●) float at top-left, over Sidebar
- Sidebar gets `padding-top` to push content below traffic lights
- ChatHeader, ChatPane, InputBar all start from window top edge

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

### Traffic Light Offset

macOS places traffic lights at approximately `y=0` to `y=14px` from the window top, with some automatic spacing. We add `padding-top: 44px` to the Sidebar to push its content (app name, search, sessions) below the traffic lights. This value may need tuning against actual macOS rendering.

## Files Changed

### 1. `src-tauri/tauri.conf.json`
- Add `"titleBarStyle": "overlay"` to window config

### 2. `src/routes/AppLayout.tsx`
- Remove `h-screen` from root container (overlay mode doesn't need titlebar height compensation)
- The root container uses `h-full` or `h-dvh` instead

### 3. `src/components/sidebar/Sidebar.tsx`
- Add `padding-top: 44px` (or equivalent Tailwind class) to offset traffic lights
- Add `data-tauri-drag-region` to the top area containing "hip" label
- Add sidebar collapse toggle button (moved from ChatHeader)
- The "hip" brand label becomes interactive for window dragging

### 4. `src/components/chat/ChatHeader.tsx`
- Remove `PanelLeft` (sidebar toggle) button
- Add `data-tauri-drag-region` to root container
- Keep: session title + `PanelRight` (panel toggle) button

### 5. `src/components/artifact/ArtifactPanel.tsx`
- Add `data-tauri-drag-region` to the tab bar / header area

### 6. `src/components/sidebar/SidebarPeek.tsx`
- Adjust `top` offset if needed (was `top-0`, may need `top-0` to remain correct since overlay mode gives us control of the full area)

### 7. `src/styles/tokens.css`
- Add traffic light offset variable: `--traffic-lights-height: 44px`
- Ensure `data-tauri-drag-region` areas have `-webkit-app-region: drag` (set by Tauri's built-in styles)

## Implementation Notes

### overlay mode caveats

- **macOS only**: `titleBarStyle: "overlay"` is a macOS feature. Windows/Linux builds will keep native decorations. This is acceptable since the app targets macOS primarily and the design language (traffic lights) is macOS-specific.
- **Traffic light positioning**: macOS automatically positions traffic lights at the top-left of the window. We don't control exact position — only the content offset via padding.
- **No custom minimize/maximize/close**: We don't need to implement these — macOS provides them natively.

### Drag region gotchas

- Elements inside a `data-tauri-drag-region` that need click handling must explicitly have `data-tauri-drag-region="false"`
- This includes: buttons, input fields, dropdown triggers, links
- The ChatHeader's panel toggle button needs `data-tauri-drag-region="false"`

### Sidebar collapse interaction

The collapsed state behavior is unchanged:
- Sidebar panel collapses to 0 width (via `react-resizable-panels`)
- A thin hover zone (current 12px `w-3`) triggers `SidebarPeek` overlay
- SidebarPeek slides in from the left, still managed by the existing peek state machine

The only difference: traffic lights remain visible in the top-left corner of the chat area when the sidebar is collapsed. Since they're OS-drawn, no code change is needed for this — it's the overlay mode's natural behavior.

### Testing considerations

- The `data-tauri-drag-region` attributes don't affect WebDriver E2E tests (they're Tauri-specific)
- E2E tests should verify: sidebar toggle functionality, session title display, panel toggle, window appears without native titlebar border
- Manual QA: verify dragging by the ChatHeader row actually moves the window

## Design Principles Preserved

- **Minimalist aesthetic**: No added chrome, no borders, no shadows — consistent with existing flat design
- **Existing Zustand patterns**: Only primitive selectors per AGENTS.md rules
- **Existing layout**: 3-panel `react-resizable-panels` structure unchanged
- **SidebarPeek**: Unchanged behavior, only traffic lights are independent
- **No new dependencies**: Uses built-in Tauri features and existing Tailwind utilities
