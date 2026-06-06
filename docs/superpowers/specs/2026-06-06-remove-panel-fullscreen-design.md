# Remove Fullscreen Maximize, Keep Drag-Resize

**Date**: 2026-06-06
**Status**: Approved

## Problem

The right panel's "maximize" button renders a full-viewport overlay (`fixed inset-0 z-40`) with a dark backdrop. This modal-style behavior:
- Blocks access to sidebar and chat while maximized
- Feels disconnected from the panel layout
- Doesn't match how Claude Desktop or Codex Desktop handle panel sizing

## Design Decision

**Remove the fullscreen maximize feature entirely.** The panel is already resizable via drag handles (`react-resizable-panels`), which provides sufficient size control. This matches Codex Desktop's approach: close + drag-resize, no maximize button.

## Changes

### 1. Store (`src/store/uiStore.ts`)
- Remove `panelFullscreen` state field
- Remove `toggleFullscreen` action
- Remove fullscreen-reset logic inside `togglePanel` and `setPanelOpen`
- Kept: `panelOpen`, `activeTab`, `setTab`, `togglePanel`, `setPanelOpen`, `collapsed`, `sessions`, `activeSessionId`

### 2. Panel Component (`src/components/artifact/ArtifactPanel.tsx`)
- Remove the fullscreen overlay render branch (current lines 67-75 that return `fixed inset-0 z-40` wrapper)
- Remove the Maximize2/Minimize2 toggle button from the header (current line 43-45)
- Always render in normal inline mode (the `<div className="h-full bg-surface">` path)
- Remove `panelFullscreen` and `toggleFullscreen` from store selector

### 3. Layout (`src/routes/AppLayout.tsx`)
- Increase right Panel's `maxSize` from `44` to `65` (to compensate for removed maximize, allowing wider drag)

### 4. Tests
- `src/store/uiStore.test.ts`: Remove test cases for `panelFullscreen` and `toggleFullscreen`
- `src/store/panelLifecycle.test.ts`: Remove fullscreen lifecycle test cases (close-during-fullscreen, reopen-after-fullscreen, etc.)

## Panel Header After Changes

```
┌─────────────────────────────────────┐
│ [文档] [文件] [智能体] [Diff]    [✕] │  ← tabs + close only, no maximize
└─────────────────────────────────────┘
```

## Panel Sizing After Changes

```
┌─────────────┬──┬──────────────────┬──┬───────────────────────┐
│   Sidebar   │↕│    Chat Pane     │↕│    Right Panel         │
│  min 12%    │ │   min 34%        │ │  min 18%  max 65%      │
│  max 22%    │ │                  │ │  collapsible            │
└─────────────┴──┴──────────────────┴──┴───────────────────────┘
```

## References

- Codex Desktop: right panel uses close + drag-resize only, no maximize button
- Claude Desktop: drag-and-drop panes within layout, no fullscreen overlay
