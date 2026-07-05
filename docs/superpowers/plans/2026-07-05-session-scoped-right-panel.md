# Session-Scoped Right Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the right panel open/close state from the global `uiStore` into each `SessionVM` so that Chat and Code panels remember their visibility per session.

**Architecture:** Add `codePanelOpen` and `chatPanelOpen` to `SessionVM` and expose session-scoped actions on `useDomainStore`. Update `AppLayout`, `PanelToggle`, `ArtifactPanel`, `PreviewPanel`, and `ArtifactCard` to read from and write to the active session. Remove the now-redundant global fields and actions from `uiStore` and migrate the tests.

**Tech Stack:** React, Zustand, TypeScript, Vitest, react-resizable-panels.

## Global Constraints

- Do not change the server protocol (`@hip/protocol`). `SessionVM` is a client-side view model.
- Panel state is in-memory only; do not persist it to `localStorage` or the server in this iteration.
- Keep the existing toggle button in the title bar; only change its data source and disable it when no session is active.
- Preserve existing optimistic no-op behavior when setting a value to its current value.
- Follow existing file naming, import aliases (`@/domain`, `@/store/uiStore`), and test patterns.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/domain/sessionStore.ts` | Owns `SessionVM` and the new per-session panel state actions. |
| `src/store/uiStore.ts` | Drops global panel state; keeps `activeTab`, `chatActiveTab`, `selectedArtifactPath`, view routing, etc. |
| `src/routes/AppLayout.tsx` | Reads active session's panel state and syncs `react-resizable-panels` collapse/expand. |
| `src/components/layout/PanelToggle.tsx` | Toggles the active session's panel based on `activeView`. |
| `src/components/artifact/ArtifactPanel.tsx` | Closes the active session's `codePanelOpen`. |
| `src/components/artifact/PreviewPanel.tsx` | Closes the active session's `chatPanelOpen` and resets the chat tab. |
| `src/components/artifact/ArtifactCard.tsx` | Opens the active session's panel when a user clicks an artifact. |
| `src/domain/sessionStore.test.ts` | Tests for new session-scoped panel actions and `session:loaded` preservation. |
| `src/store/uiStore.test.ts` | Removes global panel-state assertions. |
| `src/store/panelLifecycle.test.ts` | Rewritten to test session-scoped panel lifecycle. |
| `src/components/layout/PanelToggle.test.tsx` | Tests disabled state without session and toggle call routing. |

---

### Task 1: Add per-session panel state to `src/domain/sessionStore.ts`

**Files:**
- Modify: `src/domain/sessionStore.ts`
- Test: `src/domain/sessionStore.test.ts`

**Interfaces:**
- Consumes: existing `SessionVM`, `DomainStore`, `emptySession`, `summaryToVM`.
- Produces:
  - `SessionVM.codePanelOpen?: boolean`
  - `SessionVM.chatPanelOpen?: boolean`
  - `DomainStore.setSessionCodePanelOpen(sessionId, open)`
  - `DomainStore.setSessionChatPanelOpen(sessionId, open)`
  - `DomainStore.toggleSessionCodePanel(sessionId)`
  - `DomainStore.toggleSessionChatPanel(sessionId)`

- [ ] **Step 1: Write the failing test**

Append to `src/domain/sessionStore.test.ts`:

```ts
describe('session-scoped panel state', () => {
  beforeEach(() => {
    useDomainStore.setState({ sessions: [], activeSessionId: null, connection: 'disconnected' })
  })

  it('new sessions default both panel flags to false', () => {
    useDomainStore.getState().createSession('s1', { llmProvider: 'deepseek', model: 'm', tools: [] })
    const s = useDomainStore.getState().sessions.find((x) => x.id === 's1')!
    expect(s.codePanelOpen).toBe(false)
    expect(s.chatPanelOpen).toBe(false)
  })

  it('setSessionCodePanelOpen updates only the target session', () => {
    useDomainStore.getState().createSession('s1', { llmProvider: 'deepseek', model: 'm', tools: [] })
    useDomainStore.getState().createSession('s2', { llmProvider: 'deepseek', model: 'm', tools: [] })
    useDomainStore.getState().setSessionCodePanelOpen('s1', true)
    expect(useDomainStore.getState().sessions.find((s) => s.id === 's1')!.codePanelOpen).toBe(true)
    expect(useDomainStore.getState().sessions.find((s) => s.id === 's2')!.codePanelOpen).toBe(false)
  })

  it('setSessionChatPanelOpen is a no-op when value unchanged', () => {
    useDomainStore.getState().createSession('s1', { llmProvider: 'deepseek', model: 'm', tools: [] })
    const before = useDomainStore.getState().sessions[0]
    useDomainStore.getState().setSessionChatPanelOpen('s1', false)
    expect(useDomainStore.getState().sessions[0]).toBe(before)
  })

  it('toggleSessionCodePanel flips the flag', () => {
    useDomainStore.getState().createSession('s1', { llmProvider: 'deepseek', model: 'm', tools: [] })
    useDomainStore.getState().toggleSessionCodePanel('s1')
    expect(useDomainStore.getState().sessions[0].codePanelOpen).toBe(true)
    useDomainStore.getState().toggleSessionCodePanel('s1')
    expect(useDomainStore.getState().sessions[0].codePanelOpen).toBe(false)
  })

  it('session:loaded preserves existing panel state', () => {
    const s0 = { sessions: [{ ...emptySession('s1'), loaded: false, codePanelOpen: true, chatPanelOpen: true }] }
    const next = applyServerMessage(s0, {
      type: 'session:loaded',
      sessionId: 's1',
      messages: [{ id: 'a1', role: 'assistant', content: 'x', timestamp: 1 }],
    }, 0)
    expect(next.sessions[0].codePanelOpen).toBe(true)
    expect(next.sessions[0].chatPanelOpen).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest src/domain/sessionStore.test.ts -t "session-scoped panel state" --run
```

Expected: FAIL — `codePanelOpen` / `chatPanelOpen` undefined, actions not defined.

- [ ] **Step 3: Add fields and actions to `sessionStore.ts`**

In `src/domain/sessionStore.ts`:

1. Add fields to `SessionVM`:

```ts
export interface SessionVM {
  // ... existing fields
  codePanelOpen?: boolean
  chatPanelOpen?: boolean
}
```

2. Add actions to `DomainStore` interface:

```ts
interface DomainStore {
  // ... existing fields/actions
  setSessionCodePanelOpen: (sessionId: string, open: boolean) => void
  setSessionChatPanelOpen: (sessionId: string, open: boolean) => void
  toggleSessionCodePanel: (sessionId: string) => void
  toggleSessionChatPanel: (sessionId: string) => void
}
```

3. Initialize defaults in `emptySession`:

```ts
export function emptySession(id: string): SessionVM {
  return {
    // ... existing fields
    codePanelOpen: false,
    chatPanelOpen: false,
  }
}
```

4. Initialize defaults in `summaryToVM`:

```ts
function summaryToVM(s: SessionSummary): SessionVM {
  return {
    id: s.id,
    config: { ...DEFAULT_CONFIG, surface: s.surface },
    title: s.title,
    preview: s.preview,
    updatedAtMs: s.updatedAt,
    loaded: false,
    messages: [],
    status: 'idle',
    error: null,
    interrupt: null,
    codePanelOpen: false,
    chatPanelOpen: false,
  }
}
```

5. Implement the four actions in `useDomainStore`:

```ts
setSessionCodePanelOpen: (sessionId, open) =>
  set((s) => ({
    sessions: s.sessions.map((sess) =>
      sess.id !== sessionId
        ? sess
        : sess.codePanelOpen === open
          ? sess
          : { ...sess, codePanelOpen: open }
    ),
  })),
setSessionChatPanelOpen: (sessionId, open) =>
  set((s) => ({
    sessions: s.sessions.map((sess) =>
      sess.id !== sessionId
        ? sess
        : sess.chatPanelOpen === open
          ? sess
          : { ...sess, chatPanelOpen: open }
    ),
  })),
toggleSessionCodePanel: (sessionId) =>
  set((s) => ({
    sessions: s.sessions.map((sess) =>
      sess.id !== sessionId ? sess : { ...sess, codePanelOpen: !sess.codePanelOpen }
    ),
  })),
toggleSessionChatPanel: (sessionId) =>
  set((s) => ({
    sessions: s.sessions.map((sess) =>
      sess.id !== sessionId ? sess : { ...sess, chatPanelOpen: !sess.chatPanelOpen }
    ),
  })),
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npx vitest src/domain/sessionStore.test.ts -t "session-scoped panel state" --run
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/sessionStore.ts src/domain/sessionStore.test.ts
git commit -m "feat(domain): add session-scoped code/chat panel state"
```

---

### Task 2: Remove global panel state from `src/store/uiStore.ts`

**Files:**
- Modify: `src/store/uiStore.ts`
- Test: `src/store/uiStore.test.ts`

**Interfaces:**
- Consumes: existing `UiState` shape.
- Produces: `UiState` without `panelOpen`, `chatPanelOpen`, `togglePanel`, `toggleChatPanel`, `setPanelOpen`, `setChatPanelOpen`.

- [ ] **Step 1: Update `src/store/uiStore.test.ts` to remove panel assertions**

Replace the first `beforeEach` block (lines 5–13) with:

```ts
beforeEach(() => {
  useUiStore.setState({
    settingsNavCollapsed: false,
    activeTab: 'agents',
    theme: 'system',
    openSessionIds: [],
  })
})
```

Delete the entire `describe('uiStore - panel state management', ...)` block (lines 15–58).

In `describe('uiStore - code surface', ...)` (around line 192), replace:

```ts
beforeEach(() => useUiStore.setState({ activeView: 'chat', chatPanelOpen: false, selectedArtifactPath: null, chatSessionId: null, codeSessionId: null }))
```

with:

```ts
beforeEach(() => useUiStore.setState({ activeView: 'chat', selectedArtifactPath: null, chatSessionId: null, codeSessionId: null }))
```

Delete the test `toggleChatPanel / setChatPanelOpen drive the chat preview panel` (lines 199–203).

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest src/store/uiStore.test.ts --run
```

Expected: FAIL — `panelOpen` / `chatPanelOpen` referenced in `beforeEach` or missing actions.

- [ ] **Step 3: Remove global panel state from `uiStore.ts`**

In `src/store/uiStore.ts`:

1. Remove from `UiState` interface:

```ts
// REMOVE these lines:
// Code surface: the four-tab ArtifactPanel.
panelOpen: boolean
activeTab: ArtifactTab
setTab: (t: ArtifactTab) => void
togglePanel: () => void
setPanelOpen: (v: boolean) => void

// Chat surface: the slim preview/artifacts panel.
chatPanelOpen: boolean
toggleChatPanel: () => void
setChatPanelOpen: (v: boolean) => void
```

Keep `activeTab`/`setTab` and `chatActiveTab`/`setChatActiveTab`/`resetChatActiveTab`/`selectedArtifactPath` — those are tab/content selections, not panel visibility.

2. Remove from the store implementation:

```ts
// REMOVE these lines from the persist creator:
panelOpen: false,
activeTab: 'agents',
setTab: (t) => set({ activeTab: t }),
togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
setPanelOpen: (v) => set((s) => (s.panelOpen === v ? s : { panelOpen: v })),

chatPanelOpen: false,
toggleChatPanel: () => set((s) => ({ chatPanelOpen: !s.chatPanelOpen })),
setChatPanelOpen: (v) => set((s) => (s.chatPanelOpen === v ? s : { chatPanelOpen: v })),
```

3. Verify `partialize` still only includes `codeSessionId` and `theme`.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npx vitest src/store/uiStore.test.ts --run
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/uiStore.ts src/store/uiStore.test.ts
git commit -m "refactor(uiStore): remove global panelOpen/chatPanelOpen state"
```

---

### Task 3: Update `src/routes/AppLayout.tsx` to read session-scoped panel state

**Files:**
- Modify: `src/routes/AppLayout.tsx`
- Test: create `src/routes/AppLayout.test.tsx` (optional, manual verification is acceptable if tests are hard to set up)

**Interfaces:**
- Consumes: `useActiveSession()` from `@/domain`, `useDomainStore` actions `setSessionCodePanelOpen`, `setSessionChatPanelOpen`.
- Produces: `rightOpen` derived from active session, collapse/expand callbacks write back to active session.

- [ ] **Step 1: Update imports and hooks**

Replace:

```ts
import { sessionService, useActiveSessionId } from '@/domain'
```

with:

```ts
import { sessionService, useActiveSession, useActiveSessionId } from '@/domain'
```

- [ ] **Step 2: Replace global panel reads/writes with session-scoped ones**

Replace the panel-related hooks and logic:

```ts
export function AppLayout() {
  const rightPanelRef = useRef<ImperativePanelHandle>(null)
  const navigate = useNavigate()
  const activeSession = useActiveSession()
  const activeSessionId = useActiveSessionId()
  const activeView = useUiStore((s) => s.activeView)
  const setActiveView = useUiStore((s) => s.setActiveView)
  const logout = useAuthStore((s) => s.logout)

  // ... existing useEffect for providers/sessionService stays unchanged

  const codeOpen = activeView === 'code' && activeSession?.codePanelOpen === true
  const chatOpen = activeView === 'chat' && activeSession?.chatPanelOpen === true
  const rightOpen = codeOpen || chatOpen

  useEffect(() => {
    const p = rightPanelRef.current
    if (!p) return
    const t = setTimeout(() => {
      if (rightOpen && p.isCollapsed()) p.expand()
      if (!rightOpen && !p.isCollapsed()) p.collapse()
    }, 0)
    return () => clearTimeout(t)
  }, [rightOpen])

  const handleCollapse = () => {
    if (!activeSessionId) return
    if (activeView === 'code') useDomainStore.getState().setSessionCodePanelOpen(activeSessionId, false)
    else if (activeView === 'chat') useDomainStore.getState().setSessionChatPanelOpen(activeSessionId, false)
  }

  const handleExpand = () => {
    if (!activeSessionId) return
    if (activeView === 'code') useDomainStore.getState().setSessionCodePanelOpen(activeSessionId, true)
    else if (activeView === 'chat') useDomainStore.getState().setSessionChatPanelOpen(activeSessionId, true)
  }

  // ... rest of component unchanged
}
```

Remove the old imports/hooks for `panelOpen`, `setPanelOpen`, `chatPanelOpen`, `setChatPanelOpen`.

- [ ] **Step 3: Type-check**

Run:

```bash
yarn type-check
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/routes/AppLayout.tsx
git commit -m "refactor(AppLayout): derive right panel state from active session"
```

---

### Task 4: Update `src/components/layout/PanelToggle.tsx`

**Files:**
- Modify: `src/components/layout/PanelToggle.tsx`
- Test: `src/components/layout/PanelToggle.test.tsx`

**Interfaces:**
- Consumes: `useActiveSessionId()` from `@/domain`, `useDomainStore` toggle actions, `useUiStore((s) => s.activeView)`.
- Produces: disabled button when `activeSessionId == null`; otherwise toggles the active session's panel.

- [ ] **Step 1: Rewrite `PanelToggle.tsx`**

```tsx
import { useTranslation } from 'react-i18next'
import { PanelRight } from 'lucide-react'
import { useActiveSessionId } from '@/domain'
import { useUiStore } from '@/store/uiStore'
import { useDomainStore } from '@/domain/sessionStore'
import { Button } from '@/components/ui/Button'

export function PanelToggle() {
  const { t } = useTranslation()
  const activeSessionId = useActiveSessionId()
  const activeView = useUiStore((s) => s.activeView)
  const toggleSessionCodePanel = useDomainStore((s) => s.toggleSessionCodePanel)
  const toggleSessionChatPanel = useDomainStore((s) => s.toggleSessionChatPanel)

  const onToggle = () => {
    if (!activeSessionId) return
    if (activeView === 'code') toggleSessionCodePanel(activeSessionId)
    else if (activeView === 'chat') toggleSessionChatPanel(activeSessionId)
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onToggle}
      disabled={activeSessionId == null}
      title={t('chat.togglePanel')}
      data-tauri-drag-region="false"
      data-no-drag
      data-testid="toggle-panel"
    >
      <PanelRight size={17} />
    </Button>
  )
}
```

- [ ] **Step 2: Update `PanelToggle.test.tsx`**

Replace the entire file with:

```tsx
// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { PanelToggle } from './PanelToggle'

afterEach(cleanup)

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const toggleSessionCodePanel = vi.fn()
const toggleSessionChatPanel = vi.fn()

vi.mock('@/domain', () => ({
  useActiveSessionId: () => mockActiveSessionId,
}))

vi.mock('@/store/uiStore', () => ({
  useUiStore: (selector: (state: any) => any) =>
    selector({
      activeView: mockActiveView,
    }),
}))

vi.mock('@/domain/sessionStore', () => ({
  useDomainStore: (selector: (state: any) => any) =>
    selector({
      toggleSessionCodePanel,
      toggleSessionChatPanel,
    }),
}))

let mockActiveSessionId: string | null = 's1'
let mockActiveView = 'chat'

describe('PanelToggle', () => {
  beforeEach(() => {
    mockActiveSessionId = 's1'
    mockActiveView = 'chat'
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders toggle button', () => {
    render(<PanelToggle />)
    expect(screen.getByTestId('toggle-panel')).toBeInTheDocument()
  })

  it('is disabled when no session is active', () => {
    mockActiveSessionId = null
    render(<PanelToggle />)
    expect(screen.getByTestId('toggle-panel')).toBeDisabled()
  })

  it('calls toggleSessionChatPanel when active view is chat', () => {
    render(<PanelToggle />)
    fireEvent.click(screen.getByTestId('toggle-panel'))
    expect(toggleSessionChatPanel).toHaveBeenCalledWith('s1')
    expect(toggleSessionCodePanel).not.toHaveBeenCalled()
  })

  it('calls toggleSessionCodePanel when active view is code', () => {
    mockActiveView = 'code'
    render(<PanelToggle />)
    fireEvent.click(screen.getByTestId('toggle-panel'))
    expect(toggleSessionCodePanel).toHaveBeenCalledWith('s1')
    expect(toggleSessionChatPanel).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run test**

Run:

```bash
npx vitest src/components/layout/PanelToggle.test.tsx --run
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/PanelToggle.tsx src/components/layout/PanelToggle.test.tsx
git commit -m "refactor(PanelToggle): toggle active session's panel, disable when no session"
```

---

### Task 5: Update panel close buttons

**Files:**
- Modify: `src/components/artifact/ArtifactPanel.tsx`
- Modify: `src/components/artifact/PreviewPanel.tsx`

**Interfaces:**
- Consumes: `useActiveSessionId()` from `@/domain`, `useDomainStore` `setSessionCodePanelOpen` / `setSessionChatPanelOpen`.
- Produces: close button writes to the active session.

- [ ] **Step 1: Update `ArtifactPanel.tsx`**

Add imports:

```ts
import { useActiveSessionId } from '@/domain'
import { useDomainStore } from '@/domain/sessionStore'
```

Keep the existing `useUiStore` import (it is still needed for `activeTab`/`setTab`).

Replace:

```ts
  const togglePanel = useUiStore((s) => s.togglePanel)
```

with:

```ts
  const activeSessionId = useActiveSessionId()
  const setSessionCodePanelOpen = useDomainStore((s) => s.setSessionCodePanelOpen)
```

Update the close button `onClick`:

```tsx
<Button variant="ghost" size="icon" onClick={() => activeSessionId && setSessionCodePanelOpen(activeSessionId, false)} title={t('artifact.closePanel')}>
  <X size={16} />
</Button>
```

- [ ] **Step 2: Update `PreviewPanel.tsx`**

Add imports:

```ts
import { useActiveSessionId } from '@/domain'
import { useDomainStore } from '@/domain/sessionStore'
```

Keep the existing `useUiStore` import (it is still needed for `chatActiveTab`/`setChatActiveTab`/`resetChatActiveTab`/`selectedArtifactPath`).

Replace:

```ts
  const toggleChatPanel = useUiStore((s) => s.toggleChatPanel)
```

with:

```ts
  const activeSessionId = useActiveSessionId()
  const setSessionChatPanelOpen = useDomainStore((s) => s.setSessionChatPanelOpen)
```

Update the `close` function:

```ts
  const close = () => {
    resetChatActiveTab()
    if (activeSessionId) setSessionChatPanelOpen(activeSessionId, false)
  }
```

- [ ] **Step 3: Type-check**

Run:

```bash
yarn type-check
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/artifact/ArtifactPanel.tsx src/components/artifact/PreviewPanel.tsx
git commit -m "refactor(panels): close buttons write to session-scoped panel state"
```

---

### Task 6: Update `ArtifactCard` auto-open

**Files:**
- Modify: `src/components/artifact/ArtifactCard.tsx`

**Interfaces:**
- Consumes: `useActiveSessionId()` from `@/domain`, `useDomainStore` `setSessionCodePanelOpen` / `setSessionChatPanelOpen`, `useUiStore` `activeView`, `setTab`, `setSelectedArtifactPath`.
- Produces: clicking an artifact opens the active session's panel instead of the global one.

- [ ] **Step 1: Update imports and hooks**

Replace:

```ts
import { sessionService } from '@/domain'
```

with:

```ts
import { sessionService, useActiveSessionId } from '@/domain'
import { useDomainStore } from '@/domain/sessionStore'
```

Replace:

```ts
  const { t } = useTranslation()
  const { scopeId, isDraft } = useFsScope()
```

with:

```ts
  const { t } = useTranslation()
  const activeSessionId = useActiveSessionId()
  const { scopeId, isDraft } = useFsScope()
  const setSessionCodePanelOpen = useDomainStore((s) => s.setSessionCodePanelOpen)
  const setSessionChatPanelOpen = useDomainStore((s) => s.setSessionChatPanelOpen)
```

- [ ] **Step 2: Update the `open` function**

Replace the existing `open` function body with:

```ts
  const open = (path: string) => {
    if (!scopeId || !activeSessionId) return
    useFsStore.getState().setActive(scopeId, path)
    if (isDraft) sessionService.readDraftFile(scopeId, path)
    else sessionService.readFile(scopeId, path)
    const ui = useUiStore.getState()
    if (ui.activeView === 'code') {
      const session = useDomainStore.getState().sessions.find((s) => s.id === activeSessionId)
      if (!session?.codePanelOpen) {
        setSessionCodePanelOpen(activeSessionId, true)
        setTimeout(() => useUiStore.getState().setTab('files'), 0)
      } else {
        ui.setTab('files')
      }
    } else {
      ui.setSelectedArtifactPath(path)
      setSessionChatPanelOpen(activeSessionId, true)
    }
  }
```

- [ ] **Step 3: Type-check**

Run:

```bash
yarn type-check
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/artifact/ArtifactCard.tsx
git commit -m "refactor(ArtifactCard): open panel on active session instead of global state"
```

---

### Task 7: Rewrite `src/store/panelLifecycle.test.ts` to test session-scoped lifecycle

**Files:**
- Modify: `src/store/panelLifecycle.test.ts`

**Interfaces:**
- Consumes: `useDomainStore`, `emptySession` from `@/domain/sessionStore`.
- Produces: tests verifying per-session panel lifecycle.

- [ ] **Step 1: Replace the test file**

```ts
// src/store/panelLifecycle.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useDomainStore, emptySession } from '@/domain/sessionStore'
import { applyServerMessage } from '@/domain/sessionStore'
import { useUiStore } from './uiStore'

function reset() {
  useDomainStore.setState({ sessions: [], activeSessionId: null, connection: 'disconnected' })
}

describe('Session-scoped panel lifecycle', () => {
  beforeEach(reset)

  it('open panel → switch tabs → close panel on the active session', () => {
    useDomainStore.getState().createSession('s1', { llmProvider: 'deepseek', model: 'm', tools: [] })
    const ui = useUiStore.getState()

    ui.setTab('files')
    expect(useUiStore.getState().activeTab).toBe('files')

    useDomainStore.getState().setSessionCodePanelOpen('s1', true)
    expect(useDomainStore.getState().sessions[0].codePanelOpen).toBe(true)

    useDomainStore.getState().toggleSessionCodePanel('s1')
    expect(useDomainStore.getState().sessions[0].codePanelOpen).toBe(false)
  })

  it('setSessionCodePanelOpen(true) when already open is safe', () => {
    useDomainStore.getState().createSession('s1', { llmProvider: 'deepseek', model: 'm', tools: [] })
    useDomainStore.getState().setSessionCodePanelOpen('s1', true)
    useDomainStore.getState().setTab('files')

    useDomainStore.getState().setSessionCodePanelOpen('s1', true)
    expect(useDomainStore.getState().sessions[0].codePanelOpen).toBe(true)
    expect(useUiStore.getState().activeTab).toBe('files')
  })

  it('setSessionCodePanelOpen(false) when already closed is a no-op (same reference)', () => {
    useDomainStore.getState().createSession('s1', { llmProvider: 'deepseek', model: 'm', tools: [] })
    useDomainStore.getState().toggleSessionCodePanel('s1')
    useDomainStore.getState().toggleSessionCodePanel('s1')
    const before = useDomainStore.getState().sessions[0]

    useDomainStore.getState().setSessionCodePanelOpen('s1', false)
    expect(useDomainStore.getState().sessions[0]).toBe(before)
  })

  it('panel state is isolated between sessions', () => {
    useDomainStore.getState().createSession('s1', { llmProvider: 'deepseek', model: 'm', tools: [] })
    useDomainStore.getState().createSession('s2', { llmProvider: 'deepseek', model: 'm', tools: [] })

    useDomainStore.getState().setSessionCodePanelOpen('s1', true)
    useDomainStore.getState().setSessionChatPanelOpen('s2', true)

    const s1 = useDomainStore.getState().sessions.find((s) => s.id === 's1')!
    const s2 = useDomainStore.getState().sessions.find((s) => s.id === 's2')!

    expect(s1.codePanelOpen).toBe(true)
    expect(s1.chatPanelOpen).toBe(false)
    expect(s2.codePanelOpen).toBe(false)
    expect(s2.chatPanelOpen).toBe(true)
  })
})
```

Note: add `import { useUiStore } from './uiStore'` at the top if not already present.

- [ ] **Step 2: Run test**

Run:

```bash
npx vitest src/store/panelLifecycle.test.ts --run
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/store/panelLifecycle.test.ts
git commit -m "test(panelLifecycle): rewrite panel lifecycle tests for session-scoped state"
```

---

### Task 8: Integration verification

**Files:**
- All files above.

- [ ] **Step 1: Run type-check**

```bash
yarn type-check
```

Expected: PASS.

- [ ] **Step 2: Run unit tests**

```bash
yarn test
```

Expected: all tests pass (the known flaky `packages/sidecar/src/session/session-manager-diff.test.ts` `ENOTEMPTY` failure is unrelated; re-run that file in isolation if it fails).

- [ ] **Step 3: Manual verification**

1. Start the app in dev mode (`yarn dev` or the project's dev script).
2. Create a Chat session A, open the right preview panel, switch to the Agents tab.
3. Create a Chat session B. Observe that the right panel is closed (or matches B's state).
4. Switch back to session A. Observe the right panel is open on the Agents tab.
5. Switch to Code view with a code session. Open the ArtifactPanel, switch to the Files tab.
6. Switch to another code session. Observe that panel state is independent.
7. Close the panel from the panel's X button. Verify it only affects the current session.
8. Click an artifact card in a chat/code session. Verify it opens the current session's panel.
9. With no session active (e.g., on the `NewConversation` landing), verify the title-bar toggle is disabled.

- [ ] **Step 4: Final commit if any verification fixes were needed**

If no code changes were needed after verification, skip this step. Otherwise:

```bash
git add <changed-files>
git commit -m "fix: address integration verification findings"
```

---

## Plan Self-Review

**Spec coverage:**
- Add `codePanelOpen`/`chatPanelOpen` to `SessionVM` → Task 1.
- Preserve panel state on `session:loaded` → Task 1.
- Remove global `panelOpen`/`chatPanelOpen` → Task 2.
- Update `AppLayout` → Task 3.
- Update `PanelToggle` → Task 4.
- Update `ArtifactPanel`/`PreviewPanel` close buttons → Task 5.
- Update `ArtifactCard` auto-open → Task 6.
- Update tests → Tasks 1, 2, 4, 7.
- Manual verification → Task 8.

**Placeholder scan:** No TBD/TODO/"implement later"/"add appropriate" placeholders. Every step includes concrete code or exact commands.

**Type consistency:**
- `SessionVM.codePanelOpen?: boolean` and `SessionVM.chatPanelOpen?: boolean` used consistently.
- Domain store actions use `(sessionId: string, open: boolean)` and `(sessionId: string)` signatures throughout.
- `useActiveSessionId()` returns `string | null`; all consumers guard against `null` before calling actions.
