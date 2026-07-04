# Layout Refine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the settings/title-bar overlap, move history access to the floating avatar menu, make the title-bar `+` dropdown create Chat/Code conversations, and remove the Chat/Code toggle from the new-conversation page.

**Architecture:** `activeView` becomes the single source of truth for the top-level page (`chat` | `code` | `settings` | `history`). `TitleBar` renders three modes based on it. `AppLayout` switches main content below the title bar instead of overlaying it. The `+` dropdown and avatar menu dispatch simple view/deselect actions.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Zustand, react-i18next, Radix DropdownMenu, lucide-react, Vitest, WebdriverIO.

## Global Constraints

- Keep changes scoped to the layout/navigation layer; do not refactor unrelated chat/settings logic.
- Match existing component style, naming, and test patterns.
- Every code task ends with a test run covering the changed files.
- Run `yarn type-check`, `yarn test`, `yarn test:e2e` before finishing.
- Commit after each task.

---

## File Map

| File | Responsibility |
|------|----------------|
| `src/store/uiStore.ts` | Extend `ActiveView` to include `'history'`; keep `previousView` logic consistent. |
| `src/components/layout/TitleBar.tsx` | Render normal/settings/history modes; back button returns to `previousView` or `'chat'`. |
| `src/components/tabs/SessionTabBar.tsx` | Replace plain `+` button with dropdown containing New Chat / New Code. |
| `src/components/account/FloatingAvatarButton.tsx` | Add History menu item above Settings. |
| `src/components/history/SessionHistory.tsx` | New page listing all sessions, searchable, clickable to open. |
| `src/routes/AppLayout.tsx` | Route `activeView` to the correct main content; remove absolute settings overlay. |
| `src/components/chat/NewConversation.tsx` | Remove `SurfaceToggle`; derive `surface` from `activeView`. |
| `src/components/chat/SurfaceToggle.tsx` | Delete (no longer used). |
| `src/components/chat/SurfaceToggle.test.tsx` | Delete. |
| `src/i18n/en.ts`, `src/i18n/zh-CN.ts`, `src/i18n/zh-TW.ts` | Add new translation keys. |
| `e2e/helpers/surface.ts` | Replace `SurfaceToggle`-based helper with activeView-based navigation. |

---

## Task 1: Extend `ActiveView` in `uiStore`

**Files:**
- Modify: `src/store/uiStore.ts:7`

**Interfaces:**
- Consumes: nothing new.
- Produces: `ActiveView = 'chat' | 'code' | 'settings' | 'history'`.

- [ ] **Step 1: Write the type change**

Change line 7 from:
```ts
export type ActiveView = 'chat' | 'code' | 'settings'
```
to:
```ts
export type ActiveView = 'chat' | 'code' | 'settings' | 'history'
```

- [ ] **Step 2: Verify `previousView` handling still compiles**

The existing `setActiveView` already preserves `previousView` when entering settings and restores it when leaving. `history` will follow the same path automatically because the logic keys off `v === 'settings'` and `s.activeView === 'settings'`. No change needed, but confirm the code reads correctly.

- [ ] **Step 3: Run type check on this file**

```bash
yarn type-check
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/store/uiStore.ts
git commit -m "chore(ui): extend ActiveView with history"
```

---

## Task 2: Update `TitleBar` for Settings/History Modes

**Files:**
- Modify: `src/components/layout/TitleBar.tsx`
- Modify: `src/components/layout/TitleBar.test.tsx`

**Interfaces:**
- Consumes: `useUiStore.activeView`, `useUiStore.previousView`, `useUiStore.setActiveView`.
- Produces: Three title-bar modes; back button restores previous view.

- [ ] **Step 1: Write the failing test**

Add to `src/components/layout/TitleBar.test.tsx`:

```tsx
it('renders back button and title in settings mode', () => {
  useUiStore.setState({ activeView: 'settings', previousView: 'chat' })
  render(<TitleBar />)
  expect(screen.getByTestId('titlebar-back')).toBeInTheDocument()
  expect(screen.getByText('settings.title')).toBeInTheDocument()
  expect(screen.queryByTestId('session-tab-bar')).not.toBeInTheDocument()
})

it('renders back button and title in history mode', () => {
  useUiStore.setState({ activeView: 'history', previousView: 'chat' })
  render(<TitleBar />)
  expect(screen.getByTestId('titlebar-back')).toBeInTheDocument()
  expect(screen.getByText('history.title')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
yarn test src/components/layout/TitleBar.test.tsx
```
Expected: FAIL — `titlebar-back` and `history.title` not found.

- [ ] **Step 3: Implement the three-mode TitleBar**

Replace the body of `src/components/layout/TitleBar.tsx` with:

```tsx
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft } from 'lucide-react'
import { useUiStore } from '@/store/uiStore'
import { useDomainStore } from '@/domain'
import { SessionTabBar } from '@/components/tabs/SessionTabBar'
import { ConnectionStatus } from './ConnectionStatus'
import { PanelToggle } from './PanelToggle'

export function TitleBar() {
  const { t } = useTranslation()
  const activeView = useUiStore((s) => s.activeView)
  const previousView = useUiStore((s) => s.previousView)
  const setActiveView = useUiStore((s) => s.setActiveView)
  const onNewSession = useCallback(() => useDomainStore.getState().deselect(), [])

  const handleBack = () => {
    setActiveView(previousView ?? 'chat')
  }

  const isSpecialView = activeView === 'settings' || activeView === 'history'
  const titleKey = activeView === 'settings' ? 'settings.title' : 'history.title'

  return (
    <header
      data-tauri-drag-region
      data-testid="titlebar"
      className="relative flex h-11 shrink-0 items-center border-b border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-xl shadow-sticky-top"
    >
      <div className="shrink-0" style={{ width: 'var(--titlebar-lights-inset, 90px)' }} aria-hidden />

      {isSpecialView ? (
        <>
          <button
            type="button"
            data-testid="titlebar-back"
            onClick={handleBack}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-body text-ink-secondary transition-colors hover:bg-surface-muted hover:text-ink"
          >
            <ChevronLeft size={16} />
            {t('common.back')}
          </button>
          <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 truncate text-body font-medium text-ink">
            {t(titleKey)}
          </span>
          <div className="ml-auto shrink-0" style={{ width: 'var(--titlebar-lights-inset, 90px)' }} aria-hidden />
        </>
      ) : (
        <>
          <SessionTabBar onNewSession={onNewSession} />
          <div className="flex shrink-0 items-center gap-2 pr-3" data-tauri-drag-region="false">
            <ConnectionStatus />
            <PanelToggle />
          </div>
        </>
      )}
    </header>
  )
}
```

- [ ] **Step 4: Run tests**

```bash
yarn test src/components/layout/TitleBar.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/TitleBar.tsx src/components/layout/TitleBar.test.tsx
git commit -m "feat(titlebar): add settings and history modes with back button"
```

---

## Task 3: Convert `SessionTabBar` `+` to Dropdown

**Files:**
- Modify: `src/components/tabs/SessionTabBar.tsx`
- Modify: `src/components/tabs/SessionTabBar.test.tsx`

**Interfaces:**
- Consumes: `DropdownMenu` from `src/components/ui/DropdownMenu.tsx`, `sessionService.newConversation`, `useUiStore.setActiveView`.
- Produces: `+` button opens a menu with "New Chat" and "New Code".

- [ ] **Step 1: Write the failing test**

Replace `src/components/tabs/SessionTabBar.test.tsx` with an updated version that checks the dropdown. Keep the existing mocks and add:

```tsx
import { DropdownMenu } from '@/components/ui/DropdownMenu'
// ... existing imports

vi.mock('@radix-ui/react-dropdown-menu', () => ({
  Root: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Trigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Portal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Content: ({ children }: { children: React.ReactNode }) => <div data-testid="dropdown-content">{children}</div>,
  Item: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
  Separator: () => <hr />,
}))

it('renders chat and code dropdown options', () => {
  render(<SessionTabBar onNewSession={() => {}} />)
  expect(screen.getByText('dropdown.newChat')).toBeInTheDocument()
  expect(screen.getByText('dropdown.newCode')).toBeInTheDocument()
})
```

> Note: If mocking Radix is simpler in your environment, mock `@radix-ui/react-dropdown-menu` instead. The goal is a deterministic test that the two items render and are clickable.

- [ ] **Step 2: Run test to verify it fails**

```bash
yarn test src/components/tabs/SessionTabBar.test.tsx
```
Expected: FAIL — `dropdown.newChat` / `dropdown.newCode` not found.

- [ ] **Step 3: Implement the dropdown**

Replace `src/components/tabs/SessionTabBar.tsx`:

```tsx
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { useUiStore } from '@/store/uiStore'
import { useSessions, useActiveSessionId, sessionService } from '@/domain'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/DropdownMenu'
import { SessionTab } from './SessionTab'

interface SessionTabBarProps {
  onNewSession: () => void
}

export function SessionTabBar({ onNewSession }: SessionTabBarProps) {
  const { t } = useTranslation()
  const openIds = useUiStore((s) => s.openSessionIds)
  const sessions = useSessions()
  const activeId = useActiveSessionId()

  const openSessions = openIds
    .map((id) => sessions.find((s) => s.id === id))
    .filter((s): s is NonNullable<typeof s> => Boolean(s))

  const handleNewChat = () => {
    sessionService.newConversation('chat')
  }

  const handleNewCode = () => {
    sessionService.newConversation('code')
  }

  return (
    <div
      role="tablist"
      aria-label={t('tabs.tabList')}
      className="flex h-full flex-1 items-end gap-0.5 overflow-x-auto scrollbar-hide"
    >
      {openSessions.map((session) => (
        <SessionTab
          key={session.id}
          session={session}
          active={session.id === activeId}
          onSelect={() => sessionService.selectSession(session.id)}
          onClose={() => sessionService.closeSession(session.id)}
        />
      ))}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title={t('tabs.newSession')}
            data-testid="new-session-button"
            className="mb-[3px] ml-0.5 flex h-[26px] w-[26px] items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-muted hover:text-ink"
          >
            <Plus size={14} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={handleNewChat}>
            <span className="truncate">{t('dropdown.newChat')}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleNewCode}>
            <span className="truncate">{t('dropdown.newCode')}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
```

- [ ] **Step 4: Run tests**

```bash
yarn test src/components/tabs/SessionTabBar.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/tabs/SessionTabBar.tsx src/components/tabs/SessionTabBar.test.tsx
git commit -m "feat(tabs): add chat/code dropdown to new-session button"
```

---

## Task 4: Add History Entry to `FloatingAvatarButton`

**Files:**
- Modify: `src/components/account/FloatingAvatarButton.tsx`
- Modify: `src/components/account/FloatingAvatarButton.test.tsx`

**Interfaces:**
- Consumes: `useUiStore.setActiveView`.
- Produces: Menu item labeled `nav.history` that sets `activeView` to `'history'`.

- [ ] **Step 1: Write the failing test**

Add to `src/components/account/FloatingAvatarButton.test.tsx`:

```tsx
it('shows history menu item that calls onOpenHistory', () => {
  const onOpenHistory = vi.fn()
  render(<FloatingAvatarButton onOpenHistory={onOpenHistory} onOpenSettings={() => {}} onLogout={() => {}} />)
  fireEvent.click(screen.getByTestId('account-menu-button'))
  fireEvent.click(screen.getByTestId('account-history-menu-item'))
  expect(onOpenHistory).toHaveBeenCalled()
})
```

Also update all existing `render(<FloatingAvatarButton ... />)` calls in this file to include `onOpenHistory={vi.fn()}` so the new required prop is satisfied.

- [ ] **Step 2: Run test to verify it fails**

```bash
yarn test src/components/account/FloatingAvatarButton.test.tsx
```
Expected: FAIL — `account-history-menu-item` not found.

- [ ] **Step 3: Add history item to the menu**

In `src/components/account/FloatingAvatarButton.tsx`:

1. Add `History` icon import alongside `Settings` and `LogOut`.
2. Add a new `onOpenHistory` prop.
3. Insert the history button before settings in the menu.

Updated prop interface:
```tsx
interface FloatingAvatarButtonProps {
  onOpenSettings: () => void
  onOpenHistory: () => void
  onLogout: () => void
}
```

Updated menu render:
```tsx
<button
  type="button"
  data-testid="account-history-menu-item"
  onClick={() => { setOpen(false); onOpenHistory() }}
  className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-body text-ink transition-colors hover:bg-surface-muted"
  role="menuitem"
>
  <History size={14} className="text-ink-secondary" />
  {t('nav.history')}
</button>
<div className="my-1 h-px bg-border" />
<button
  type="button"
  data-testid="account-settings-menu-item"
  ...
```

- [ ] **Step 4: Run tests**

```bash
yarn test src/components/account/FloatingAvatarButton.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/account/FloatingAvatarButton.tsx src/components/account/FloatingAvatarButton.test.tsx
git commit -m "feat(account): add history entry to avatar menu"
```

---

## Task 5: Create `SessionHistory` Component

**Files:**
- Create: `src/components/history/SessionHistory.tsx`
- Create: `src/components/history/SessionHistory.test.tsx`

**Interfaces:**
- Consumes: `useSessions`, `sessionService.selectSession` from `@/domain`; `useTranslation`.
- Produces: A scrollable list of all sessions with search, click-to-open, and empty state.

- [ ] **Step 1: Write the failing test**

Create `src/components/history/SessionHistory.test.tsx`:

```tsx
// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SessionHistory } from './SessionHistory'
import { useUiStore } from '@/store/uiStore'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/domain', () => ({
  useSessions: () => [
    { id: 's1', title: 'Chat A', preview: 'Hello', updatedAtMs: 1000, config: { surface: 'chat' } },
    { id: 's2', title: 'Code B', preview: 'Refactor', updatedAtMs: 2000, config: { surface: 'code' } },
  ],
  sessionService: {
    selectSession: vi.fn(),
  },
}))

describe('SessionHistory', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders all sessions', () => {
    render(<SessionHistory />)
    expect(screen.getByText('Chat A')).toBeInTheDocument()
    expect(screen.getByText('Code B')).toBeInTheDocument()
  })

  it('filters sessions by search query', () => {
    render(<SessionHistory />)
    fireEvent.change(screen.getByPlaceholderText('history.searchPlaceholder'), { target: { value: 'Code' } })
    expect(screen.queryByText('Chat A')).not.toBeInTheDocument()
    expect(screen.getByText('Code B')).toBeInTheDocument()
  })

  it('opens session on click', () => {
    const { sessionService } = require('@/domain')
    render(<SessionHistory />)
    fireEvent.click(screen.getByText('Code B'))
    expect(sessionService.selectSession).toHaveBeenCalledWith('s2')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
yarn test src/components/history/SessionHistory.test.tsx
```
Expected: FAIL — component or file not found.

- [ ] **Step 3: Implement `SessionHistory`**

Create `src/components/history/SessionHistory.tsx`:

```tsx
import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, MessageSquare, Code2 } from 'lucide-react'
import { useSessions, sessionService } from '@/domain'
import { surfaceOf } from '@/lib/sessions'
import { cn } from '@/lib/utils'

export function SessionHistory() {
  const { t } = useTranslation()
  const sessions = useSessions()
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = [...sessions].sort((a, b) => b.updatedAtMs - a.updatedAtMs)
    if (!q) return list
    return list.filter((s) =>
      s.title.toLowerCase().includes(q) || s.preview.toLowerCase().includes(q),
    )
  }, [sessions, query])

  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-6 py-5" data-testid="session-history">
      <h2 className="mb-4 text-display font-semibold text-ink">{t('history.title')}</h2>
      <div className="relative mb-4 max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-tertiary" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('history.searchPlaceholder')}
          className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-body text-ink placeholder:text-ink-tertiary focus:border-accent focus:outline-none"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center text-ink-secondary">
          <span className="text-body">{t('history.empty')}</span>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((session) => {
            const surface = surfaceOf(session.config)
            const Icon = surface === 'code' ? Code2 : MessageSquare
            return (
              <button
                key={session.id}
                type="button"
                onClick={() => sessionService.selectSession(session.id)}
                className="flex items-center justify-between rounded-lg border border-border bg-surface p-3 text-left transition-colors hover:border-accent"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-body font-medium text-ink">{session.title}</span>
                  <span className="truncate text-meta text-ink-secondary">{session.preview}</span>
                </div>
                <span
                  className={cn(
                    'ml-3 flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-caption',
                    surface === 'code'
                      ? 'bg-accent-subtle text-accent-strong'
                      : 'bg-surface-subtle text-ink-secondary',
                  )}
                >
                  <Icon size={12} />
                  {t(`nav.${surface}`)}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests**

```bash
yarn test src/components/history/SessionHistory.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/history/SessionHistory.tsx src/components/history/SessionHistory.test.tsx
git commit -m "feat(history): add session history page"
```

---

## Task 6: Remove `SurfaceToggle` from `NewConversation`

**Files:**
- Modify: `src/components/chat/NewConversation.tsx`
- Delete: `src/components/chat/SurfaceToggle.tsx`
- Delete: `src/components/chat/SurfaceToggle.test.tsx`

**Interfaces:**
- Consumes: `useUiStore.activeView`.
- Produces: `surface` derived from `activeView`; no toggle UI.

- [ ] **Step 1: Update `NewConversation` tests**

In `src/components/chat/NewConversation.test.tsx`, remove any assertions about `SurfaceToggle` / `surface-toggle-chat` / `surface-toggle-code`. Add an assertion that the toggle is absent:

```tsx
it('does not render surface toggle', () => {
  render(<NewConversation />)
  expect(screen.queryByTestId('surface-toggle-chat')).not.toBeInTheDocument()
  expect(screen.queryByTestId('surface-toggle-code')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
yarn test src/components/chat/NewConversation.test.tsx
```
Expected: FAIL — toggle still present.

- [ ] **Step 3: Remove SurfaceToggle from NewConversation**

In `src/components/chat/NewConversation.tsx`:

1. Remove `import { SurfaceToggle } from './SurfaceToggle'`.
2. Change `const surface = activeView === 'code' ? 'code' : 'chat'` (line ~28) to derive directly from `activeView`.
3. Remove the `<SurfaceToggle ... />` JSX block.

The `surface` derivation already exists; confirm it reads:
```tsx
const surface = activeView === 'code' ? 'code' : 'chat'
```

- [ ] **Step 4: Delete SurfaceToggle files**

```bash
rm src/components/chat/SurfaceToggle.tsx src/components/chat/SurfaceToggle.test.tsx
```

- [ ] **Step 5: Run tests**

```bash
yarn test src/components/chat/NewConversation.test.tsx
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/chat/NewConversation.tsx src/components/chat/NewConversation.test.tsx
git rm src/components/chat/SurfaceToggle.tsx src/components/chat/SurfaceToggle.test.tsx
git commit -m "feat(new-conversation): derive surface from activeView, remove SurfaceToggle"
```

---

## Task 7: Update `AppLayout` View Routing

**Files:**
- Modify: `src/routes/AppLayout.tsx`
- Modify: `src/routes/AppLayout.test.tsx`

**Interfaces:**
- Consumes: `SessionHistory`, updated `TitleBar`, updated `FloatingAvatarButton` props.
- Produces: Main content switched by `activeView`; settings/history rendered below TitleBar; no absolute overlay.

- [ ] **Step 1: Update `AppLayout.test.tsx`**

Add a test that settings/history render inside the layout rather than as an overlay:

```tsx
vi.mock('@/components/history/SessionHistory', () => ({ SessionHistory: () => <div data-testid="session-history" /> }))

it('renders history view below title bar', () => {
  useUiStore.setState({ activeView: 'history' })
  render(<AppLayout />, { wrapper: MemoryRouter })
  expect(screen.getByTestId('session-history')).toBeInTheDocument()
  expect(screen.getByTestId('title-bar')).toBeInTheDocument()
})

it('renders settings view below title bar', () => {
  useUiStore.setState({ activeView: 'settings' })
  render(<AppLayout />, { wrapper: MemoryRouter })
  expect(screen.getByTestId('settings-page')).toBeInTheDocument()
  expect(screen.getByTestId('title-bar')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
yarn test src/routes/AppLayout.test.tsx
```
Expected: FAIL — `SessionHistory` not imported / rendered.

- [ ] **Step 3: Implement view routing in AppLayout**

Replace the body of `src/routes/AppLayout.tsx`:

```tsx
import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from 'react-resizable-panels'
import { useProvidersStore } from '@/store/providersStore'
import { sessionService, useActiveSessionId } from '@/domain'
import { useUiStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import { NewConversation } from '@/components/chat/NewConversation'
import { ChatPane } from '@/components/chat/ChatPane'
import { InputBar } from '@/components/chat/InputBar'
import { ArtifactPanel } from '@/components/artifact/ArtifactPanel'
import { PreviewPanel } from '@/components/artifact/PreviewPanel'
import { TitleBar } from '@/components/layout/TitleBar'
import { SettingsPage } from '@/components/account/SettingsPage'
import { SessionHistory } from '@/components/history/SessionHistory'
import { FloatingAvatarButton } from '@/components/account/FloatingAvatarButton'

export function AppLayout() {
  const rightPanelRef = useRef<ImperativePanelHandle>(null)
  const navigate = useNavigate()
  const activeSessionId = useActiveSessionId()
  const activeView = useUiStore((s) => s.activeView)
  const setActiveView = useUiStore((s) => s.setActiveView)
  const logout = useAuthStore((s) => s.logout)
  const panelOpen = useUiStore((s) => s.panelOpen)
  const setPanelOpen = useUiStore((s) => s.setPanelOpen)
  const chatPanelOpen = useUiStore((s) => s.chatPanelOpen)
  const setChatPanelOpen = useUiStore((s) => s.setChatPanelOpen)

  useEffect(() => {
    if (!useProvidersStore.getState().loaded) {
      void useProvidersStore.getState().load().catch((err) => {
        console.error('Failed to load providers catalog (safety net):', err)
      })
    }
    sessionService.connect()
    return () => sessionService.disconnect()
  }, [])

  const codeOpen = activeView === 'code' && panelOpen
  const chatOpen = activeView === 'chat' && chatPanelOpen
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
    if (activeView === 'code') setPanelOpen(false)
    else if (activeView === 'chat') setChatPanelOpen(false)
  }

  const handleExpand = () => {
    if (activeView === 'code') setPanelOpen(true)
    else if (activeView === 'chat') setChatPanelOpen(true)
  }

  const renderMainContent = () => {
    if (activeView === 'history') return <SessionHistory />
    if (activeView === 'settings') return <SettingsPage />
    return activeSessionId == null ? (
      <NewConversation />
    ) : (
      <>
        <ChatPane />
        <InputBar />
      </>
    )
  }

  return (
    <div className="flex h-dvh w-screen flex-col overflow-hidden bg-surface">
      <TitleBar />
      <div className="relative flex min-h-0 flex-1">
        <PanelGroup direction="horizontal" className="flex-1">
          <Panel minSize={34} className="flex min-w-0 flex-col">
            {renderMainContent()}
          </Panel>

          <PanelResizeHandle className="group relative z-10 w-2 -mx-1 bg-transparent">
            <div className="mx-auto h-full w-px bg-border transition-colors group-hover:bg-accent group-data-[resize-handle-state=drag]:bg-accent" />
          </PanelResizeHandle>

          <Panel
            ref={rightPanelRef}
            defaultSize={26}
            minSize={18}
            maxSize={65}
            collapsible
            collapsedSize={0}
            onCollapse={handleCollapse}
            onExpand={handleExpand}
          >
            {rightOpen ? (
              codeOpen ? <ArtifactPanel /> : <PreviewPanel />
            ) : null}
          </Panel>
        </PanelGroup>

        <FloatingAvatarButton
          onOpenHistory={() => setActiveView('history')}
          onOpenSettings={() => setActiveView('settings')}
          onLogout={() => {
            logout()
            navigate('/login')
          }}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests**

```bash
yarn test src/routes/AppLayout.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/AppLayout.tsx src/routes/AppLayout.test.tsx
git commit -m "feat(layout): route activeView below title bar, remove settings overlay"
```

---

## Task 8: Add i18n Keys

**Files:**
- Modify: `src/i18n/en.ts`
- Modify: `src/i18n/zh-CN.ts`
- Modify: `src/i18n/zh-TW.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: New translation keys used by TitleBar, SessionTabBar, FloatingAvatarButton, and SessionHistory.

- [ ] **Step 1: Add keys to `en.ts`**

Under `nav`:
```ts
nav: {
  chat: 'Work',
  code: 'Coding',
  settings: 'Settings',
  history: 'History',
},
```

Add a new top-level section after `nav`:
```ts
dropdown: {
  newChat: 'New Chat',
  newCode: 'New Code',
},
history: {
  title: 'History',
  empty: 'No conversations yet',
  searchPlaceholder: 'Search conversations…',
},
```

- [ ] **Step 2: Add keys to `zh-CN.ts`**

```ts
nav: {
  chat: '办公',
  code: '编码',
  settings: '设置',
  history: '历史会话',
},
dropdown: {
  newChat: '新建 Chat',
  newCode: '新建 Code',
},
history: {
  title: '历史会话',
  empty: '暂无历史会话',
  searchPlaceholder: '搜索会话…',
},
```

- [ ] **Step 3: Add keys to `zh-TW.ts`**

Mirror the structure with Traditional Chinese:
```ts
nav: {
  chat: '辦公',
  code: '編碼',
  settings: '設定',
  history: '歷史會話',
},
dropdown: {
  newChat: '新建 Chat',
  newCode: '新建 Code',
},
history: {
  title: '歷史會話',
  empty: '暫無歷史會話',
  searchPlaceholder: '搜尋會話…',
},
```

- [ ] **Step 4: Run type check**

```bash
yarn type-check
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/i18n/en.ts src/i18n/zh-CN.ts src/i18n/zh-TW.ts
git commit -m "feat(i18n): add history and dropdown keys"
```

---

## Task 9: Update e2e Helpers

**Files:**
- Modify: `e2e/helpers/surface.ts`

**Interfaces:**
- Consumes: `SessionTabBar` dropdown or activeView navigation.
- Produces: Helpers that no longer depend on deleted `SurfaceToggle`.

- [ ] **Step 1: Inspect existing helper**

Read `e2e/helpers/surface.ts` and identify usages of `surface-toggle-code` / `surface-toggle-chat`.

- [ ] **Step 2: Rewrite helper to use the + dropdown**

Replace the toggle-based click with an action that opens the `+` dropdown and selects the target surface:

```ts
export async function switchToSurface(surface: 'chat' | 'code'): Promise<void> {
  const label = surface === 'code' ? 'New Code' : 'New Chat'
  const button = await $(`[data-testid="new-session-button"]`)
  await button.click()
  const item = await $(`//*[contains(text(), "${label}")]`)
  await item.click()
}
```

Adjust XPath/text selector to match the actual i18n output in the e2e environment.

- [ ] **Step 3: Run e2e type check / lint**

```bash
yarn type-check
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add e2e/helpers/surface.ts
git commit -m "test(e2e): update surface helper to use title-bar dropdown"
```

---

## Task 10: Full Verification

**Files:**
- All modified files.

- [ ] **Step 1: Run type check**

```bash
yarn type-check
```
Expected: no errors.

- [ ] **Step 2: Run unit tests**

```bash
yarn test
```
Expected: all tests pass.

- [ ] **Step 3: Run e2e tests**

```bash
yarn test:e2e
```
Expected: all specs pass.

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git commit -m "fix: address verification findings" || echo "No changes to commit"
```

---

## Plan Self-Review

**Spec coverage:**
- Settings/title-bar conflict fixed → Task 7 removes absolute overlay; Task 2 adds back button.
- History access → Task 4 (avatar menu), Task 5 (history page), Task 7 (routing).
- `+` dropdown Chat/Code → Task 3.
- Remove NewConversation Chat/Code toggle → Task 6.
- i18n → Task 8.
- Verification → Task 10.

**Placeholder scan:**
- No TBD/TODO. All steps include concrete code or exact commands.

**Type consistency:**
- `ActiveView` includes `'history'` from Task 1; all downstream tasks use it consistently.
- `FloatingAvatarButton` gains `onOpenHistory` in Task 4 and is wired in Task 7.
- `SessionHistory` is created in Task 5 and consumed in Task 7.

No gaps identified.
