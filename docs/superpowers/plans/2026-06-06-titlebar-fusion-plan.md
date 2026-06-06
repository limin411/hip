# Titlebar Fusion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the system titlebar with the main layout using Tauri's `titleBarStyle: "overlay"` + `trafficLightPosition`, matching Claude Desktop's frameless aesthetic.

**Architecture:** Three changed config files (tauri.conf.json, capabilities/default.json, Cargo.toml) enable frameless overlay mode with precise traffic light positioning. Four changed frontend files (AppLayout, Sidebar, ChatHeader, ArtifactPanel) add drag regions and remove the titlebar/content boundary. One CSS variable for offset tuning.

**Tech Stack:** Tauri v2 (>= 2.4.0), React 18, Tailwind CSS, react-resizable-panels, Zustand v5

---

### Task 1: Verify Tauri version and update configuration files

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 1: Verify Tauri version >= 2.4.0**

Run: `grep 'name = "tauri"' src-tauri/Cargo.lock -A 2 | grep version`
Expected: version is `"2.4.x"` or higher.

If version is below 2.4.0, run `cargo update -p tauri` in `src-tauri/`.

- [ ] **Step 2: Update tauri.conf.json — add overlay config**

In `src-tauri/tauri.conf.json`, replace the `windows` array:

```json
"windows": [
  {
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
  }
]
```

- [ ] **Step 3: Update capabilities/default.json — add drag permission**

In `src-tauri/capabilities/default.json`, add `"core:window:allow-start-dragging"` to the permissions array:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Capability for the main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "opener:default",
    {
      "identifier": "shell:allow-execute",
      "allow": [
        {
          "name": "binaries/sidecar",
          "sidecar": true
        }
      ]
    },
    "core:window:default",
    "core:window:allow-start-dragging"
  ]
}
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/tauri.conf.json src-tauri/capabilities/default.json
git commit -m "feat: enable titlebar overlay with traffic light positioning"
```

---

### Task 2: AppLayout — remove titlebar height compensation

**Files:**
- Modify: `src/routes/AppLayout.tsx`

The root container currently uses `h-screen` which reserves space for the native titlebar. Under overlay mode, the content region extends to the window edge, so we use `h-dvh` (dynamic viewport height).

- [ ] **Step 1: Replace `h-screen` with `h-dvh`**

In `src/routes/AppLayout.tsx`, change line 40 (the root `div` className):

```
// Before:
<div className="relative h-screen w-screen overflow-hidden bg-surface">

// After:
<div className="relative h-dvh w-screen overflow-hidden bg-surface">
```

No other changes to this file.

- [ ] **Step 2: Commit**

```bash
git add src/routes/AppLayout.tsx
git commit -m "feat: use dvh instead of screen height for overlay mode"
```

---

### Task 3: Sidebar — add drag region, hip label, and collapse toggle

**Files:**
- Modify: `src/components/sidebar/Sidebar.tsx`

The Sidebar needs a drag-region header with traffic light offset, "hip" brand label, and a collapse toggle button (moved from ChatHeader). Content below the header is unchanged.

- [ ] **Step 1: Rewrite Sidebar.tsx**

Replace the entire content of `src/components/sidebar/Sidebar.tsx` with:

```tsx
import { PanelLeft } from 'lucide-react'
import { useUiStore } from '@/store/uiStore'
import { NewChatButton } from './NewChatButton'
import { SearchBox } from './SearchBox'
import { SessionList } from './SessionList'
import { UserMenu } from './UserMenu'

export function Sidebar() {
  const toggleCollapsed = useUiStore((s) => s.toggleCollapsed)

  return (
    <div className="flex h-full flex-col">
      {/* Drag region header: traffic light offset + hip label + collapse toggle */}
      <div
        data-tauri-drag-region
        className="flex shrink-0 items-center justify-between px-4"
        style={{ paddingTop: 'var(--traffic-lights-offset, 40px)' }}
        aria-label="hip"
      >
        <span className="text-sm font-bold text-ink select-none">hip</span>
        <button
          onClick={toggleCollapsed}
          title="折叠侧边栏"
          className="flex h-7 w-7 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:text-ink"
          data-tauri-drag-region="false"
        >
          <PanelLeft size={16} />
        </button>
      </div>

      {/* Rest of Sidebar: same as before */}
      <div className="flex flex-col gap-2 p-1.5">
        <NewChatButton />
        <SearchBox />
      </div>
      <div className="flex-1 overflow-y-auto px-1">
        <SessionList />
      </div>
      <div className="border-t border-border p-1.5">
        <UserMenu />
      </div>
    </div>
  )
}
```

Key design decisions in this code:
- `paddingTop: 'var(--traffic-lights-offset, 40px)'` uses a CSS variable for easy calibration; falls back to 40px
- `data-tauri-drag-region` on the header div makes the whole row draggable
- `data-tauri-drag-region="false"` on the collapse button excludes it from drag
- `select-none` on the label prevents text selection during drag
- `aria-label="hip"` on the drag region provides accessibility for screen readers (since `hiddenTitle: true` hides the OS title)
- `PanelLeft` icon replaces the one that was in ChatHeader

- [ ] **Step 2: Commit**

```bash
git add src/components/sidebar/Sidebar.tsx
git commit -m "feat: add sidebar drag region with hip label and collapse toggle"
```

---

### Task 4: ChatHeader — remove sidebar toggle, add drag region

**Files:**
- Modify: `src/components/chat/ChatHeader.tsx`

- [ ] **Step 1: Rewrite ChatHeader.tsx**

Replace the entire content of `src/components/chat/ChatHeader.tsx` with:

```tsx
import { PanelRight } from 'lucide-react'
import { useUiStore } from '@/store/uiStore'
import { useActiveSession } from '@/domain'
import { Button } from '@/components/ui/Button'

export function ChatHeader() {
  const togglePanel = useUiStore((s) => s.togglePanel)
  const active = useActiveSession()

  return (
    <div
      data-tauri-drag-region
      className="flex h-11 shrink-0 items-center gap-1.5 border-b border-border bg-surface px-3"
    >
      <span className="min-w-0 truncate text-[13px] font-medium text-ink">
        {active?.title ?? '对话'}
      </span>
      <div className="flex-1" />
      <Button
        variant="ghost"
        size="icon"
        onClick={togglePanel}
        title="切换产物面板"
        data-tauri-drag-region="false"
      >
        <PanelRight size={17} />
      </Button>
    </div>
  )
}
```

Changes from original:
- Removed `PanelLeft` import and button (moved to Sidebar in Task 3)
- Added `data-tauri-drag-region` to root div for window dragging
- Added `data-tauri-drag-region="false"` to the `PanelRight` button so clicks aren't consumed
- Added explicit `select-none` to title via CSS (Tauri's drag region CSS handles this, but explicit is safer)

- [ ] **Step 2: Commit**

```bash
git add src/components/chat/ChatHeader.tsx
git commit -m "feat: chat header as drag region, sidebar toggle moved to sidebar"
```

---

### Task 5: ArtifactPanel — add drag region to tab bar

**Files:**
- Modify: `src/components/artifact/ArtifactPanel.tsx`

- [ ] **Step 1: Add drag region to ArtifactPanel header row**

In `src/components/artifact/ArtifactPanel.tsx`, modify the tab header div (line 31) to include `data-tauri-drag-region` and exclude the interactive buttons:

The header div currently is:
```tsx
<div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-2">
```

Change it to:
```tsx
<div
  data-tauri-drag-region
  className="flex h-11 shrink-0 items-center justify-between border-b border-border px-2"
>
```

And on the fullscreen and close buttons (lines 40-45), add `data-tauri-drag-region="false"`:

```tsx
<div className="flex items-center gap-0.5">
  <Button variant="ghost" size="icon" onClick={toggleFullscreen} title={fullscreen ? '还原' : '全屏'} data-tauri-drag-region="false">
    {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
  </Button>
  <Button variant="ghost" size="icon" onClick={togglePanel} title="关闭面板" data-tauri-drag-region="false">
    <X size={16} />
  </Button>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/artifact/ArtifactPanel.tsx
git commit -m "feat: artifact panel header as drag region"
```

---

### Task 6: Add CSS variable for traffic lights offset

**Files:**
- Modify: `src/styles/tokens.css`

- [ ] **Step 1: Add `--traffic-lights-offset` variable**

In `src/styles/tokens.css`, add the variable to the `:root` block after the existing CSS custom properties:

```css
:root {
  --bg-app: #fafafa;
  --bg-subtle: #f5f5f5;
  --bg-muted: #efefef;
  --border: #e4e4e4;
  --text-primary: #111111;
  --text-secondary: #666666;
  --text-tertiary: #999999;
  --accent: #111111;
  --accent-hover: #000000;
  --accent-subtle: #e8e8e8;
  --success: #3d9a50;
  --danger: #d64545;
  --warning: #c77a1a;
  --role-supervisor: #5b5bd6;
  --role-planner: #1a8cd8;
  --role-coder: #3d9a50;
  --role-reviewer: #c77a1a;
  /* NEW: traffic lights offset for overlay titlebar */
  --traffic-lights-offset: 40px;
}
```

This value (`40px`) is derived from `trafficLightPosition.y` (25) + button height (14) + visual breathing room (1). Tune after first build if content overlaps with traffic lights.

- [ ] **Step 2: Commit**

```bash
git add src/styles/tokens.css
git commit -m "feat: add traffic-lights-offset CSS variable"
```

---

### Task 7: Build and verify

**Files:**
- No new files

- [ ] **Step 1: Type-check the frontend**

```bash
yarn type-check
```
Expected: No TypeScript errors.

- [ ] **Step 2: Build for E2E testing**

```bash
cargo tauri build --debug
```
Expected: Build succeeds. Note the binary path (`src-tauri/target/debug/hip`).

- [ ] **Step 3: Run E2E tests**

```bash
yarn test:e2e
```
Expected: All existing E2E tests pass. Pay attention to:
- Sidebar toggle still works (selector moved from ChatHeader to Sidebar)
- Session title is still rendered in ChatHeader
- Panel toggle button still works in ChatHeader

- [ ] **Step 4: Manual QA checklist**

Launch the app (`./src-tauri/target/debug/hip`) and verify:

1. [ ] Window appears without native titlebar border — only traffic lights visible
2. [ ] Traffic lights are positioned at (19, 25), overlaid on Sidebar's "hip" label area
3. [ ] "hip" label is visible in Sidebar, below traffic lights, not overlapping
4. [ ] Dragging by ChatHeader row moves the window (when window is focused)
5. [ ] Dragging by Sidebar "hip" label area moves the window (when focused)
6. [ ] Sidebar collapse toggle (PanelLeft button in Sidebar header) works
7. [ ] Sidebar expand/Peek behavior is unchanged
8. [ ] Panel toggle button in ChatHeader responds to clicks (not consumed by drag)
9. [ ] Tab buttons and fullscreen/close buttons in ArtifactPanel work (not consumed by drag)
10. [ ] InputBar text input works (not consumed by drag)

- [ ] **Step 5: Calibrate traffic lights offset**

If the "hip" label overlaps with traffic lights or has too much space:
- Adjust `--traffic-lights-offset` in `tokens.css` (increase if overlap, decrease if too much gap)
- Rebuild with `cargo tauri build --debug` and re-check

- [ ] **Step 6: Final commit**

```bash
git add .
git commit -m "chore: final calibration and cleanup for titlebar fusion"
```

---

### Rollback (if needed)

If the overlay mode causes critical issues, revert all changes:

```bash
# Remove overlay config from tauri.conf.json
# Remove allow-start-dragging from capabilities/default.json
# Revert AppLayout.tsx h-dvh -> h-screen
# Revert Sidebar.tsx to original (without drag region/hip/collapse)
# Revert ChatHeader.tsx to original (with PanelLeft)
# Revert ArtifactPanel.tsx drag region
# Remove --traffic-lights-offset from tokens.css
# Rebuild: cargo tauri build --debug
```
