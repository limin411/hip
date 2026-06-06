# Remove Panel Fullscreen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the fullscreen maximize feature from the right panel, keeping only drag-resize and close. Increase panel maxSize from 44% to 65%.

**Architecture:** Remove `panelFullscreen` from Zustand store, remove the overlay render in ArtifactPanel, remove the Maximize button from the header, increase `maxSize` in AppLayout. Tests are cleaned up to match.

**Tech Stack:** Zustand v5, react-resizable-panels, React, Vitest

---

### Task 1: Remove `panelFullscreen` from Zustand store

**Files:**
- Modify: `src/store/uiStore.ts:1-41`

- [ ] **Step 1: Remove `panelFullscreen` and `toggleFullscreen` from the store**

In `src/store/uiStore.ts`, remove:
1. Line 13: `panelFullscreen: boolean`
2. Line 18: `toggleFullscreen: () => void`
3. Line 30: `panelFullscreen: false,` (the initial state value)
4. Lines 35: `panelFullscreen: s.panelOpen ? false : s.panelFullscreen,` from `togglePanel`
5. Lines 38: the `...(v ? {} : { panelFullscreen: false })` spread from `setPanelOpen`
6. Line 40: `toggleFullscreen` action entirely

The resulting file should be:

```ts
import { create } from 'zustand'
import type { ArtifactTab } from '@/mock/types'

interface UiState {
  collapsed: boolean
  setCollapsed: (v: boolean) => void
  toggleCollapsed: () => void

  search: string
  setSearch: (q: string) => void

  panelOpen: boolean
  activeTab: ArtifactTab
  setTab: (t: ArtifactTab) => void
  togglePanel: () => void
  setPanelOpen: (v: boolean) => void
}

export const useUiStore = create<UiState>((set) => ({
  collapsed: false,
  setCollapsed: (v) => set((s) => (s.collapsed === v ? s : { collapsed: v })),
  toggleCollapsed: () => set((s) => ({ collapsed: !s.collapsed })),

  search: '',
  setSearch: (q) => set({ search: q }),

  panelOpen: true,
  activeTab: 'agents',
  setTab: (t) => set({ activeTab: t }),
  togglePanel: () => set((s) => ({
    panelOpen: !s.panelOpen,
  })),
  setPanelOpen: (v) => set((s) =>
    s.panelOpen === v ? s : { panelOpen: v },
  ),
}))
```

Note how `togglePanel` and `setPanelOpen` are simplified — they no longer need to reset fullscreen state.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit src/store/uiStore.ts
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/store/uiStore.ts
git commit -m "feat: remove panelFullscreen and toggleFullscreen from uiStore"
```

---

### Task 2: Remove fullscreen UI from ArtifactPanel

**Files:**
- Modify: `src/components/artifact/ArtifactPanel.tsx:1-78`

- [ ] **Step 1: Remove fullscreen code from ArtifactPanel**

In `src/components/artifact/ArtifactPanel.tsx`:

1. Line 1: Remove `Maximize2, Minimize2` from the `lucide-react` import (keep `X`)

Change:
```tsx
import { Maximize2, Minimize2, X } from 'lucide-react'
```
To:
```tsx
import { X } from 'lucide-react'
```

2. Lines 21-22: Remove the `fullscreen` and `toggleFullscreen` store selectors

Remove:
```tsx
  const fullscreen = useUiStore((s) => s.panelFullscreen)
  const toggleFullscreen = useUiStore((s) => s.toggleFullscreen)
```

3. Lines 42-48: Remove the maximize button from the header buttons div, keeping only the close button

Change:
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
To:
```tsx
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon" onClick={togglePanel} title="关闭面板" data-tauri-drag-region="false">
            <X size={16} />
          </Button>
        </div>
```

4. Lines 67-75: Remove the fullscreen overlay render branch. Remove the entire `if (fullscreen)` block (lines 67-75). Keep only the normal return (line 77).

The resulting component should be:

```tsx
import { X } from 'lucide-react'
import type { ArtifactTab } from '@/mock/types'
import { useUiStore } from '@/store/uiStore'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs'
import { Button } from '@/components/ui/Button'
import { DocRenderer } from './DocRenderer'
import { FileTree } from './FileTree'
import { AgentDashboard } from './AgentDashboard'
import { DiffViewer } from './DiffViewer'

const TABS: { value: ArtifactTab; label: string }[] = [
  { value: 'doc', label: '文档' },
  { value: 'files', label: '文件' },
  { value: 'agents', label: '智能体' },
  { value: 'diff', label: 'Diff' },
]

export function ArtifactPanel() {
  const activeTab = useUiStore((s) => s.activeTab)
  const setTab = useUiStore((s) => s.setTab)
  const togglePanel = useUiStore((s) => s.togglePanel)

  return (
    <div className="h-full bg-surface">
      <Tabs
        value={activeTab}
        onValueChange={(v) => setTab(v as ArtifactTab)}
        className="flex h-full flex-col"
      >
        <div
          data-tauri-drag-region
          className="flex h-11 shrink-0 items-center justify-between border-b border-border px-2"
        >
          <TabsList className="h-full gap-4" data-tauri-drag-region="false">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="flex items-center gap-0.5">
            <Button variant="ghost" size="icon" onClick={togglePanel} title="关闭面板" data-tauri-drag-region="false">
              <X size={16} />
            </Button>
          </div>
        </div>

        <TabsContent value="doc" className="p-4">
          <DocRenderer />
        </TabsContent>
        <TabsContent value="files" className="p-2">
          <FileTree />
        </TabsContent>
        <TabsContent value="agents" className="p-3">
          <AgentDashboard />
        </TabsContent>
        <TabsContent value="diff" className="p-0">
          <DiffViewer />
        </TabsContent>
      </Tabs>
    </div>
  )
}
```

Note: The `body` variable is no longer needed — the Tabs are rendered directly in the return.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/artifact/ArtifactPanel.tsx
git commit -m "feat: remove fullscreen UI and maximize button from ArtifactPanel"
```

---

### Task 3: Increase panel maxSize from 44 to 65

**Files:**
- Modify: `src/routes/AppLayout.tsx:86`

- [ ] **Step 1: Change maxSize**

In `src/routes/AppLayout.tsx`, line 86:

Change:
```tsx
          maxSize={44}
```
To:
```tsx
          maxSize={65}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/routes/AppLayout.tsx
git commit -m "feat: increase right panel maxSize from 44 to 65"
```

---

### Task 4: Clean up tests

**Files:**
- Modify: `src/store/uiStore.test.ts:1-113`
- Modify: `src/store/panelLifecycle.test.ts:1-145`

- [ ] **Step 1: Remove `panelFullscreen` from test initial state**

In `src/store/uiStore.test.ts`, line 10:

Remove:
```ts
    panelFullscreen: false,
```

In `src/store/panelLifecycle.test.ts`, line 10:

Remove:
```ts
    panelFullscreen: false,
```

- [ ] **Step 2: Remove fullscreen-related test cases from uiStore.test.ts**

Remove the following entire `it(...)` blocks from `src/store/uiStore.test.ts`:

1. Lines 16-19: `'initial state: panel is open, not fullscreen'` — the `panelFullscreen` assertion
2. Lines 40-48: `'toggleFullscreen toggles panelFullscreen'`
3. Lines 50-62: `'closing panel while fullscreen resets panelFullscreen to false'`
4. Lines 64-71: `'closing panel via setPanelOpen(false) while fullscreen resets fullscreen'`
5. Lines 73-82: `'reopening panel after close-from-fullscreen starts in normal mode'`
6. Lines 105-112: `'fullscreen preserves active tab'`

Simplify the existing initial state test (lines 16-19) to only check `panelOpen`:

```ts
  it('initial state: panel is open', () => {
    const s = useUiStore.getState()
    expect(s.panelOpen).toBe(true)
  })
```

- [ ] **Step 3: Remove fullscreen-related test cases from panelLifecycle.test.ts**

Remove the following entire `it(...)` blocks from `src/store/panelLifecycle.test.ts`:

1. Lines 39-47: `'fullscreen → exit fullscreen → stays open'`
2. Lines 51-62: `'fullscreen → close panel → reopen → normal (not fullscreen)'`
3. Lines 66-74: `'fullscreen → switch tabs → exit fullscreen → tab preserved'`
4. Lines 78-84: `'setPanelOpen(false) while fullscreen resets fullscreen'`
5. Lines 104-115: `'sequential fullscreen toggles preserve tab'`
6. Lines 119-133: `'rapid togglePanel → toggleFullscreen → togglePanel is consistent'`
7. Lines 137-144: `'panel collapse while fullscreen resets fullscreen'`

Also update the describe block label on line 15 from:
```ts
describe('ArtifactPanel — full lifecycle state transitions', () => {
```
To:
```ts
describe('ArtifactPanel — lifecycle state transitions', () => {
```

- [ ] **Step 4: Run tests to verify**

```bash
npx vitest run src/store/uiStore.test.ts src/store/panelLifecycle.test.ts
```
Expected: all remaining tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/store/uiStore.test.ts src/store/panelLifecycle.test.ts
git commit -m "test: remove fullscreen-related test cases"
```

---

### Task 5: Full verification

**Files:**
- None (verification only)

- [ ] **Step 1: Run all tests**

```bash
npx vitest run
```
Expected: all tests pass.

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```
Expected: no type errors.

- [ ] **Step 3: Quick grep to confirm no remaining references**

```bash
rg "panelFullscreen|toggleFullscreen" src/
```
Expected: no matches (all removed).
