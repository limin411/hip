# Session Tabs + No Sidebar Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the collapsible session-list sidebar with browser-style session tabs in the title bar, remove the left sidebar, and move settings to a floating avatar menu.

**Architecture:** Add an `openSessionIds` list to the UI store to track which sessions are open as tabs. `SessionTabBar` reads this list and renders one tab per open session. `AppLayout` drops the sidebar panels and rail; `NewConversation` gains a Chat/Code surface toggle since the rail is gone. Settings is reached through a new floating avatar button at the bottom-left.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Zustand, react-router-dom, @radix-ui/react-dropdown-menu, lucide-react, Vitest, @testing-library/react.

## Global Constraints

- Follow existing component patterns in `src/components/ui/` and `src/components/chat/`.
- Use Tailwind utility classes and CSS variables from `src/styles/tokens.css`.
- All new components must have matching `.test.tsx` files using Vitest and `@testing-library/react`.
- i18n keys must be added to `zh-CN.ts`, `zh-TW.ts`, and `en.ts`.
- Do not add new runtime dependencies.
- Keep deletions surgical; remove only components made obsolete by the new layout.
- Closing a tab removes the session from `openSessionIds` and deletes the underlying session (matching current "×" behavior in `SessionItem`).

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/store/uiStore.ts` | Add `openSessionIds`, `addOpenSession`, `removeOpenSession`, `reorderOpenSessions`. Remove sidebar collapse state. |
| `src/domain/sessionService.ts` | Add `closeSession(id)`; update `createSession` and `selectSession` to maintain `openSessionIds`. |
| `src/domain/sessionStore.ts` | Add `deleteSession(id)` reducer if missing; keep existing shape. |
| `src/components/tabs/SessionTab.tsx` | Single tab: icon, title, close button, active state. |
| `src/components/tabs/SessionTabBar.tsx` | Renders tabs from `openSessionIds` plus a "+" new-tab button. |
| `src/components/tabs/SessionTabBar.test.tsx` | Tests for tab rendering, switching, closing. |
| `src/components/tabs/SessionTab.test.tsx` | Tests for individual tab UI. |
| `src/components/account/FloatingAvatarButton.tsx` | Floating avatar button with settings/logout dropdown. |
| `src/components/account/FloatingAvatarButton.test.tsx` | Tests for menu open/close and actions. |
| `src/components/layout/TitleBar.tsx` | Host `SessionTabBar` and title-right actions; remove `SidebarToggle`. |
| `src/routes/AppLayout.tsx` | Remove sidebar/rail panels; render main content and floating avatar. |
| `src/components/chat/NewConversation.tsx` | Add Chat/Code surface toggle at top of page. |
| `src/components/chat/NewConversation.test.tsx` | Update tests for toggle behavior. |
| `src/components/rail/MenuRail.tsx` | Delete. |
| `src/components/rail/RailButton.tsx` | Delete. |
| `src/components/sidebar/*.tsx` | Delete or archive unused components. |
| `src/components/sessions/SessionsDialog.tsx` | Delete (entry point removed). |
| `src/i18n/zh-CN.ts`, `zh-TW.ts`, `en.ts` | Add/verify new keys. |

---

### Task 1: Add open-session state to `useUiStore`

**Files:**
- Modify: `src/store/uiStore.ts`
- Test: `src/store/uiStore.test.ts` (create if missing)

**Interfaces:**
- Consumes: none
- Produces: `openSessionIds: string[]`, `addOpenSession(id)`, `removeOpenSession(id)`, `reorderOpenSessions(ids)`

- [ ] **Step 1: Write the failing test**

Create `src/store/uiStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useUiStore } from './uiStore'

describe('uiStore open sessions', () => {
  beforeEach(() => {
    useUiStore.setState({ openSessionIds: [] })
  })

  it('adds and removes open session ids', () => {
    useUiStore.getState().addOpenSession('s1')
    useUiStore.getState().addOpenSession('s2')
    expect(useUiStore.getState().openSessionIds).toEqual(['s2', 's1'])

    useUiStore.getState().removeOpenSession('s1')
    expect(useUiStore.getState().openSessionIds).toEqual(['s2'])
  })

  it('reorders open session ids', () => {
    useUiStore.getState().addOpenSession('s1')
    useUiStore.getState().addOpenSession('s2')
    useUiStore.getState().reorderOpenSessions(['s2', 's1'])
    expect(useUiStore.getState().openSessionIds).toEqual(['s2', 's1'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test src/store/uiStore.test.ts`
Expected: FAIL — `addOpenSession` not defined.

- [ ] **Step 3: Add state to `useUiStore`**

In `src/store/uiStore.ts`, add to the `UiState` interface:

```ts
openSessionIds: string[]
addOpenSession: (id: string) => void
removeOpenSession: (id: string) => void
reorderOpenSessions: (ids: string[]) => void
```

Remove these obsolete interface members and their implementations (keep only `settingsNavCollapsed` if used by settings page):

```ts
collapsed: boolean
setCollapsed: (v: boolean) => void
toggleCollapsed: () => void
sidebarWidth: number
setSidebarWidth: (v: number) => void
settingsNavCollapsed: boolean  // keep if SettingsPage still uses it
setSettingsNavCollapsed: (v: boolean) => void
toggleSettingsNav: () => void
```

Add to the store body:

```ts
openSessionIds: [],
addOpenSession: (id) =>
  set((s) => (s.openSessionIds.includes(id) ? s : { openSessionIds: [id, ...s.openSessionIds] })),
removeOpenSession: (id) =>
  set((s) => ({ openSessionIds: s.openSessionIds.filter((x) => x !== id) })),
reorderOpenSessions: (ids) => set({ openSessionIds: ids }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test src/store/uiStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/uiStore.ts src/store/uiStore.test.ts
git commit -m "feat(uiStore): add openSessionIds and remove sidebar collapse state"
```

---

### Task 2: Update `sessionService` to manage open sessions

**Files:**
- Modify: `src/domain/sessionService.ts`
- Test: `src/domain/sessionService.test.ts`

**Interfaces:**
- Consumes: `useUiStore.addOpenSession`, `useUiStore.removeOpenSession`, `useDomainStore.deleteSession`
- Produces: `closeSession(id: string): void`

- [ ] **Step 1: Write the failing test**

In `src/domain/sessionService.test.ts`, add:

```ts
it('closeSession removes from open tabs and deletes session', () => {
  const svc = new SessionService(mockTransport)
  const id = svc.createSession()
  expect(useUiStore.getState().openSessionIds).toContain(id)

  svc.closeSession(id)
  expect(useUiStore.getState().openSessionIds).not.toContain(id)
  expect(useDomainStore.getState().sessions.some((s) => s.id === id)).toBe(false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test src/domain/sessionService.test.ts -t "closeSession"`
Expected: FAIL — `closeSession` not defined.

- [ ] **Step 3: Implement open-session lifecycle in `sessionService`**

In `src/domain/sessionService.ts`:

1. After `createSession` activates the new session, add it to open tabs:

```ts
createSession(config: SessionConfig = DEFAULT_CONFIG): string {
  const id = nanoid()
  const enriched: SessionConfig = { ...config, language: currentLanguage() }
  useDomainStore.getState().createSession(id, enriched)
  this.rememberActiveForSurface(id)
  useUiStore.getState().addOpenSession(id)
  this.transport.send({ type: 'session:create', id, config: enriched })
  return id
}
```

2. In `selectSession`, ensure the selected session is in open tabs:

```ts
selectSession(id: string, messageId?: string): void {
  useDomainStore.getState().selectSession(id)
  useUiStore.getState().addOpenSession(id)
  useUiStore.getState().setSelectedArtifactPath(null)
  this.rememberActiveForSurface(id)
  // ... rest unchanged
}
```

3. Add `closeSession` near `deleteSession`:

```ts
closeSession(id: string): void {
  useUiStore.getState().removeOpenSession(id)
  this.deleteSession(id)
  const remaining = useUiStore.getState().openSessionIds
  if (remaining.length > 0) {
    this.selectSession(remaining[0])
  } else {
    useDomainStore.getState().deselect()
    useUiStore.getState().setChatSessionId(null)
    useUiStore.getState().setCodeSessionId(null)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test src/domain/sessionService.test.ts -t "closeSession"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/sessionService.ts src/domain/sessionService.test.ts
git commit -m "feat(sessionService): manage open session tabs"
```

---

### Task 3: Create `SessionTab` component

**Files:**
- Create: `src/components/tabs/SessionTab.tsx`
- Test: `src/components/tabs/SessionTab.test.tsx`

**Interfaces:**
- Consumes: `SessionVM` from `@/domain`
- Produces: `SessionTab` component with props `{ session: SessionVM; active: boolean; onSelect: () => void; onClose: () => void }`

- [ ] **Step 1: Write the failing test**

Create `src/components/tabs/SessionTab.test.tsx`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SessionTab } from './SessionTab'
import type { SessionVM } from '@/domain'

const session = {
  id: 's1',
  title: 'Test Session',
  config: { surface: 'chat' },
} as unknown as SessionVM

describe('SessionTab', () => {
  it('renders title and surface icon', () => {
    render(<SessionTab session={session} active={false} onSelect={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText('Test Session')).toBeInTheDocument()
  })

  it('calls onSelect when clicked', () => {
    const onSelect = vi.fn()
    render(<SessionTab session={session} active={false} onSelect={onSelect} onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Test Session'))
    expect(onSelect).toHaveBeenCalled()
  })

  it('calls onClose when close button clicked', () => {
    const onClose = vi.fn()
    render(<SessionTab session={session} active={false} onSelect={vi.fn()} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test src/components/tabs/SessionTab.test.tsx`
Expected: FAIL — `SessionTab` not found.

- [ ] **Step 3: Implement `SessionTab`**

Create `src/components/tabs/SessionTab.tsx`:

```tsx
import { useTranslation } from 'react-i18next'
import { MessageSquare, FolderGit2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SessionVM } from '@/domain'
import { surfaceOf } from '@/lib/sessions'

interface SessionTabProps {
  session: SessionVM
  active: boolean
  onSelect: () => void
  onClose: () => void
}

const ICON = {
  chat: MessageSquare,
  code: FolderGit2,
}

export function SessionTab({ session, active, onSelect, onClose }: SessionTabProps) {
  const { t } = useTranslation()
  const surface = surfaceOf(session.config)
  const Icon = ICON[surface] ?? MessageSquare

  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseDown={(e) => e.button === 1 && onClose()}
      className={cn(
        'group flex h-[33px] min-w-[140px] max-w-[200px] items-center gap-2 rounded-t-md border border-transparent border-b-0 px-2.5 text-body transition-colors',
        active
          ? 'bg-app border-border text-ink'
          : 'text-ink-tertiary hover:bg-surface-muted hover:text-ink',
      )}
    >
      <Icon size={14} className={cn('shrink-0', active ? 'text-accent-strong' : 'text-ink-tertiary')} />
      <span className="min-w-0 flex-1 truncate text-left">{session.title}</span>
      <span
        role="button"
        tabIndex={0}
        aria-label={t('tabs.closeTab')}
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.stopPropagation()
            onClose()
          }
        }}
        className={cn(
          'flex h-4 w-4 items-center justify-center rounded opacity-0 transition-opacity',
          'group-hover:opacity-100 hover:bg-surface-muted',
        )}
      >
        <X size={12} />
      </span>
    </button>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test src/components/tabs/SessionTab.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/tabs/SessionTab.tsx src/components/tabs/SessionTab.test.tsx
git commit -m "feat(tabs): add SessionTab component"
```

---

### Task 4: Create `SessionTabBar` component

**Files:**
- Create: `src/components/tabs/SessionTabBar.tsx`
- Test: `src/components/tabs/SessionTabBar.test.tsx`

**Interfaces:**
- Consumes: `useUiStore.openSessionIds`, `useSessions`, `useActiveSessionId`, `sessionService.selectSession`, `sessionService.closeSession`
- Produces: `SessionTabBar` component

- [ ] **Step 1: Write the failing test**

Create `src/components/tabs/SessionTabBar.test.tsx`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SessionTabBar } from './SessionTabBar'
import { useUiStore } from '@/store/uiStore'

vi.mock('@/domain', () => ({
  useSessions: () => [
    { id: 's1', title: 'Chat A', config: { surface: 'chat' } },
    { id: 's2', title: 'Code B', config: { surface: 'code' } },
  ],
  useActiveSessionId: () => 's1',
  sessionService: {
    selectSession: vi.fn(),
    closeSession: vi.fn(),
  },
}))

describe('SessionTabBar', () => {
  beforeEach(() => {
    useUiStore.setState({ openSessionIds: ['s1', 's2'] })
  })

  it('renders one tab per open session', () => {
    render(<SessionTabBar onNewSession={() => {}} />)
    expect(screen.getByText('Chat A')).toBeInTheDocument()
    expect(screen.getByText('Code B')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test src/components/tabs/SessionTabBar.test.tsx`
Expected: FAIL — `SessionTabBar` not found.

- [ ] **Step 3: Implement `SessionTabBar`**

Create `src/components/tabs/SessionTabBar.tsx`:

```tsx
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { useUiStore } from '@/store/uiStore'
import { useSessions, useActiveSessionId, sessionService } from '@/domain'
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

  return (
    <div className="flex h-full flex-1 items-end gap-0.5 overflow-x-auto scrollbar-hide">
      {openSessions.map((session) => (
        <SessionTab
          key={session.id}
          session={session}
          active={session.id === activeId}
          onSelect={() => sessionService.selectSession(session.id)}
          onClose={() => sessionService.closeSession(session.id)}
        />
      ))}
      <button
        type="button"
        onClick={onNewSession}
        title={t('tabs.newSession')}
        className="mb-[3px] ml-0.5 flex h-[26px] w-[26px] items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-muted hover:text-ink"
      >
        <Plus size={14} />
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test src/components/tabs/SessionTabBar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/tabs/SessionTabBar.tsx src/components/tabs/SessionTabBar.test.tsx
git commit -m "feat(tabs): add SessionTabBar component"
```

---

### Task 5: Update `TitleBar`

**Files:**
- Modify: `src/components/layout/TitleBar.tsx`
- Test: `src/components/layout/TitleBar.test.tsx`

**Interfaces:**
- Consumes: `SessionTabBar`, connection status
- Produces: updated `TitleBar` without `SidebarToggle`

- [ ] **Step 1: Update `TitleBar.test.tsx` expectations**

If `TitleBar.test.tsx` exists, update it to assert `SessionTabBar` renders and `SidebarToggle` does not. If it doesn't exist, create it:

```ts
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TitleBar } from './TitleBar'

vi.mock('@/components/tabs/SessionTabBar', () => ({
  SessionTabBar: () => <div data-testid="session-tab-bar">TabBar</div>,
}))

describe('TitleBar', () => {
  it('renders session tab bar and no sidebar toggle', () => {
    render(<TitleBar />)
    expect(screen.getByTestId('session-tab-bar')).toBeInTheDocument()
    expect(screen.queryByTestId('sidebar-toggle')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test src/components/layout/TitleBar.test.tsx`
Expected: FAIL — `SidebarToggle` still present or `SessionTabBar` not imported.

- [ ] **Step 3: Rewrite `TitleBar`**

Replace `src/components/layout/TitleBar.tsx`:

```tsx
import { useTranslation } from 'react-i18next'
import { useUiStore } from '@/store/uiStore'
import { SessionTabBar } from '@/components/tabs/SessionTabBar'
import { ChatTitleBar } from './ChatTitleBar'

export function TitleBar() {
  const { t } = useTranslation()
  const activeView = useUiStore((s) => s.activeView)

  return (
    <header
      data-tauri-drag-region
      className="relative flex h-11 shrink-0 items-center border-b border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-xl shadow-sticky-top"
    >
      <div className="shrink-0" style={{ width: 'var(--titlebar-lights-inset, 90px)' }} aria-hidden />

      {activeView === 'settings' ? (
        <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 truncate text-body font-medium text-ink">
          {t('settings.title')}
        </span>
      ) : (
        <>
          <SessionTabBar onNewSession={() => {/* handled by AppLayout */}} />
          <ChatTitleBar />
        </>
      )}
    </header>
  )
}
```

Wait — `ChatTitleBar` currently renders status + title + panel toggle inline. With `SessionTabBar` taking the flex-1 space, `ChatTitleBar` should be constrained. Check actual layout: `SessionTabBar` has `flex-1`, so `ChatTitleBar` should be removed from TitleBar and its content moved into the title-right area or into the main chat pane.

Better approach: decompose `ChatTitleBar`:
- Connection status moves to title-right
- Session title is no longer needed in title bar (tab shows it)
- Panel toggle moves to title-right

So update `TitleBar` to render only `SessionTabBar` in the center and a compact title-right with connection status + panel toggle.

```tsx
import { useTranslation } from 'react-i18next'
import { useUiStore } from '@/store/uiStore'
import { SessionTabBar } from '@/components/tabs/SessionTabBar'
import { ConnectionStatus } from './ConnectionStatus'
import { PanelToggle } from './PanelToggle'

export function TitleBar() {
  const { t } = useTranslation()
  const activeView = useUiStore((s) => s.activeView)

  return (
    <header
      data-tauri-drag-region
      className="relative flex h-11 shrink-0 items-center border-b border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-xl shadow-sticky-top"
    >
      <div className="shrink-0" style={{ width: 'var(--titlebar-lights-inset, 90px)' }} aria-hidden />

      {activeView === 'settings' ? (
        <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 truncate text-body font-medium text-ink">
          {t('settings.title')}
        </span>
      ) : (
        <>
          <SessionTabBar onNewSession={() => {}} />
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

- [ ] **Step 4: Extract `ConnectionStatus` and `PanelToggle` with tests**

Create tests first in `src/components/layout/ConnectionStatus.test.tsx`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ConnectionStatus } from './ConnectionStatus'

vi.mock('@/domain', () => ({
  useConnectionStatus: () => 'connected',
  useHasApiKey: () => true,
  sessionService: { reconnect: vi.fn() },
}))

describe('ConnectionStatus', () => {
  it('renders connected status', () => {
    render(<ConnectionStatus />)
    expect(screen.getByText('已连接')).toBeInTheDocument()
  })
})
```

Create `src/components/layout/PanelToggle.test.tsx`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PanelToggle } from './PanelToggle'

vi.mock('@/store/uiStore', () => ({
  useUiStore: () => ({
    activeView: 'chat',
    toggleChatPanel: vi.fn(),
    togglePanel: vi.fn(),
  }),
}))

describe('PanelToggle', () => {
  it('renders toggle button', () => {
    render(<PanelToggle />)
    expect(screen.getByTestId('toggle-panel')).toBeInTheDocument()
  })
})
```

Create `src/components/layout/ConnectionStatus.tsx` from the left portion of `ChatTitleBar`:

```tsx
import { useTranslation } from 'react-i18next'
import { useConnectionStatus, useHasApiKey, sessionService } from '@/domain'

const DOT: Record<string, string> = {
  connected: 'bg-success',
  connecting: 'bg-warning animate-pulse',
  disconnected: 'bg-ink-tertiary',
  error: 'bg-danger',
}

export function ConnectionStatus() {
  const { t } = useTranslation()
  const status = useConnectionStatus()
  const hasApiKey = useHasApiKey()

  return (
    <div className="flex items-center gap-2 pl-2" data-tauri-drag-region="false">
      {status === 'connected' && !hasApiKey ? (
        <>
          <span className="h-2 w-2 rounded-full bg-warning" />
          <span className="text-caption text-warning">{t('chat.noApiKey')}</span>
        </>
      ) : (
        <>
          <span className={`h-2 w-2 rounded-full transition-colors ${DOT[status] ?? DOT.disconnected}`} />
          <span className="text-caption text-ink-tertiary">
            {{
              connecting: t('chat.connectionConnecting'),
              connected: t('chat.connectionConnected'),
              disconnected: t('chat.connectionDisconnected'),
              error: t('chat.connectionError'),
            }[status] ?? t('chat.connectionDisconnected')}
          </span>
          {(status === 'error' || status === 'disconnected') && (
            <button
              onClick={() => sessionService.reconnect()}
              className="text-caption text-accent-strong transition-colors hover:text-accent-hover hover:underline"
            >
              {t('chat.connectionRetry')}
            </button>
          )}
        </>
      )}
    </div>
  )
}
```

Create `src/components/layout/PanelToggle.tsx` from the right portion of `ChatTitleBar`:

```tsx
import { PanelRight } from 'lucide-react'
import { useUiStore } from '@/store/uiStore'
import { Button } from '@/components/ui/Button'

export function PanelToggle() {
  const { t } = useTranslation()
  const activeView = useUiStore((s) => s.activeView)
  const togglePanel = useUiStore((s) => s.togglePanel)
  const toggleChatPanel = useUiStore((s) => s.toggleChatPanel)
  const onToggle = activeView === 'code' ? togglePanel : toggleChatPanel

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onToggle}
      title={t('chat.togglePanel')}
      data-tauri-drag-region="false"
      data-testid="toggle-panel"
    >
      <PanelRight size={17} />
    </Button>
  )
}
```

- [ ] **Step 5: Delete or deprecate `ChatTitleBar.tsx`**

If nothing else uses `ChatTitleBar`, delete `src/components/layout/ChatTitleBar.tsx` and its test. If other tests import it, update them.

- [ ] **Step 6: Run tests**

Run: `yarn test src/components/layout/TitleBar.test.tsx src/components/layout/ConnectionStatus.test.tsx src/components/layout/PanelToggle.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/layout/
git commit -m "feat(layout): TitleBar hosts SessionTabBar and title-right actions"
```

---

### Task 6: Create `FloatingAvatarButton`

**Files:**
- Create: `src/components/account/FloatingAvatarButton.tsx`
- Test: `src/components/account/FloatingAvatarButton.test.tsx`

**Interfaces:**
- Consumes: `useUiStore.setActiveView`, `useAuthStore.logout`, avatar data
- Produces: `FloatingAvatarButton` component

- [ ] **Step 1: Write the failing test**

Create `src/components/account/FloatingAvatarButton.test.tsx`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FloatingAvatarButton } from './FloatingAvatarButton'

vi.mock('@/store/uiStore', () => ({
  useUiStore: () => ({ activeView: 'chat' }),
}))

vi.mock('@/store/authStore', () => ({
  useAuthStore: () => ({ logout: vi.fn() }),
}))

describe('FloatingAvatarButton', () => {
  it('opens menu on click and shows settings', () => {
    render(<FloatingAvatarButton onOpenSettings={vi.fn()} onLogout={vi.fn()} />)
    fireEvent.click(screen.getByText('U'))
    expect(screen.getByText('设置')).toBeInTheDocument()
    expect(screen.getByText('退出登录')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test src/components/account/FloatingAvatarButton.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement `FloatingAvatarButton`**

Create `src/components/account/FloatingAvatarButton.tsx`:

```tsx
import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Settings, LogOut } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'

interface FloatingAvatarButtonProps {
  onOpenSettings: () => void
  onLogout: () => void
}

export function FloatingAvatarButton({ onOpenSettings, onLogout }: FloatingAvatarButtonProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div ref={ref} className="absolute bottom-4 left-4 z-50">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-subtle text-accent-strong ring-1 ring-transparent transition-all hover:scale-105 hover:ring-border"
        aria-label={t('account.menu')}
      >
        <Avatar name="User" size={32} />
      </button>

      {open && (
        <div className="absolute bottom-11 left-0 w-44 rounded-xl border border-border bg-app p-1.5 shadow-menu animate-menu-in">
          <button
            type="button"
            onClick={() => { setOpen(false); onOpenSettings() }}
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-body text-ink transition-colors hover:bg-surface-muted"
          >
            <Settings size={14} className="text-ink-secondary" />
            {t('nav.settings')}
          </button>
          <div className="my-1 h-px bg-border" />
          <button
            type="button"
            onClick={() => { setOpen(false); onLogout() }}
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-body text-danger transition-colors hover:bg-danger/10"
          >
            <LogOut size={14} />
            {t('common.logout')}
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test src/components/account/FloatingAvatarButton.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/account/FloatingAvatarButton.tsx src/components/account/FloatingAvatarButton.test.tsx
git commit -m "feat(account): add floating avatar menu"
```

---

### Task 7: Update `AppLayout`

**Files:**
- Modify: `src/routes/AppLayout.tsx`
- Test: `src/routes/AppLayout.test.tsx`

**Interfaces:**
- Consumes: `SessionTabBar` (via `TitleBar`), `FloatingAvatarButton`, `NewConversation`, `SettingsPage`
- Produces: simplified layout without sidebar/rail

- [ ] **Step 1: Update `AppLayout.test.tsx`**

Update existing test or create one asserting no sidebar and presence of `FloatingAvatarButton`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AppLayout } from './AppLayout'

vi.mock('@/components/layout/TitleBar', () => ({ TitleBar: () => <div data-testid="title-bar" /> }))
vi.mock('@/components/account/FloatingAvatarButton', () => ({
  FloatingAvatarButton: () => <div data-testid="floating-avatar" />,
}))
vi.mock('@/components/chat/NewConversation', () => ({ NewConversation: () => <div data-testid="new-conversation" /> }))
vi.mock('@/components/chat/ChatPane', () => ({ ChatPane: () => <div data-testid="chat-pane" /> }))
vi.mock('@/components/chat/InputBar', () => ({ InputBar: () => <div data-testid="input-bar" /> }))
vi.mock('@/components/account/SettingsPage', () => ({ SettingsPage: () => <div data-testid="settings-page" /> }))

describe('AppLayout', () => {
  it('renders without sidebar', () => {
    render(<AppLayout />)
    expect(screen.getByTestId('title-bar')).toBeInTheDocument()
    expect(screen.getByTestId('floating-avatar')).toBeInTheDocument()
    expect(screen.queryByTestId('sidebar-root')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test src/routes/AppLayout.test.tsx`
Expected: FAIL — sidebar still present or avatar missing.

- [ ] **Step 3: Rewrite `AppLayout`**

Replace `src/routes/AppLayout.tsx`:

```tsx
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
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
import { FloatingAvatarButton } from '@/components/account/FloatingAvatarButton'

export function AppLayout() {
  const navigate = useNavigate()
  const activeSessionId = useActiveSessionId()
  const activeView = useUiStore((s) => s.activeView)
  const setActiveView = useUiStore((s) => s.setActiveView)
  const logout = useAuthStore((s) => s.logout)
  const panelOpen = useUiStore((s) => s.panelOpen)
  const chatPanelOpen = useUiStore((s) => s.chatPanelOpen)

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

  return (
    <div className="flex h-dvh w-screen flex-col overflow-hidden bg-surface">
      <TitleBar />
      <div className="relative flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {activeSessionId == null ? (
            <NewConversation />
          ) : (
            <>
              <ChatPane />
              <InputBar />
            </>
          )}
        </div>

        {(codeOpen || chatOpen) && (
          <>
            <div className="group relative z-10 w-2 -mx-1 bg-transparent">
              <div className="mx-auto h-full w-px bg-border transition-colors group-hover:bg-accent" />
            </div>
            <div className="w-[320px] shrink-0">
              {codeOpen ? <ArtifactPanel /> : <PreviewPanel />}
            </div>
          </>
        )}

        <FloatingAvatarButton
          onOpenSettings={() => setActiveView('settings')}
          onLogout={() => {
            logout()
            navigate('/login')
          }}
        />
      </div>

      {activeView === 'settings' && (
        <div className="absolute inset-0 z-20 bg-surface">
          <SettingsPage />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests**

Run: `yarn test src/routes/AppLayout.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/AppLayout.tsx src/routes/AppLayout.test.tsx
git commit -m "feat(layout): AppLayout without sidebar, with floating avatar"
```

---

### Task 8: Rework `NewConversation` with surface toggle

**Files:**
- Modify: `src/components/chat/NewConversation.tsx`
- Test: `src/components/chat/NewConversation.test.tsx`

**Interfaces:**
- Consumes: `useUiStore.activeView`, `sessionService.setSurface`
- Produces: surface toggle UI above existing composer

- [ ] **Step 1: Update failing test expectations**

Update `src/components/chat/NewConversation.test.tsx` to assert the surface toggle renders and switches surface:

```ts
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { NewConversation } from './NewConversation'

vi.mock('@/domain', () => ({
  ...vi.importActual('@/domain'),
  sessionService: {
    setSurface: vi.fn(),
    sendMessage: vi.fn(),
  },
  useActiveSessionId: () => null,
}))

describe('NewConversation surface toggle', () => {
  it('renders Chat and Code toggle', () => {
    render(<NewConversation />)
    expect(screen.getByRole('button', { name: /chat/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /code/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test src/components/chat/NewConversation.test.tsx -t "surface toggle"`
Expected: FAIL — toggle not found.

- [ ] **Step 3: Add surface toggle to `NewConversation`**

In `src/components/chat/NewConversation.tsx`, import `SurfaceTabs` (or create a local toggle) and render it above the composer:

```tsx
import { SurfaceTabs } from '@/components/sidebar/SurfaceTabs'
```

Then in the JSX, after the greeting and before the composer:

```tsx
<div className="mb-6 flex justify-center">
  <SurfaceTabs active={surface} onChange={(v) => sessionService.setSurface(v)} />
</div>
```

If `SurfaceTabs` is deleted in Task 9, create a local `SurfaceToggle` component first. To avoid ordering issues, create `src/components/chat/SurfaceToggle.tsx` in this task:

```tsx
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { Surface } from '@/store/uiStore'

interface SurfaceToggleProps {
  active: Surface
  onChange: (surface: Surface) => void
}

export function SurfaceToggle({ active, onChange }: SurfaceToggleProps) {
  const { t } = useTranslation()
  return (
    <div className="inline-flex w-[200px] gap-0.5 rounded-lg bg-surface-subtle p-0.5">
      {(['chat', 'code'] as const).map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onChange(s)}
          className={cn(
            'flex-1 rounded-md py-1.5 text-sm font-medium transition-all',
            active === s
              ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(0,0,0,0.06)]'
              : 'text-ink-tertiary hover:text-ink',
          )}
        >
          {t(`nav.${s}`)}
        </button>
      ))}
    </div>
  )
}
```

Then use `SurfaceToggle` in `NewConversation`.

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test src/components/chat/NewConversation.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/NewConversation.tsx src/components/chat/NewConversation.test.tsx src/components/chat/SurfaceToggle.tsx
git commit -m "feat(new-conversation): add Chat/Code surface toggle"
```

---

### Task 9: Remove obsolete sidebar and rail components

**Files:**
- Delete: `src/components/rail/MenuRail.tsx`
- Delete: `src/components/rail/RailButton.tsx`
- Delete: `src/components/sidebar/Sidebar.tsx`
- Delete: `src/components/sidebar/SidebarPeek.tsx`
- Delete: `src/components/sidebar/SessionList.tsx`
- Delete: `src/components/sidebar/SessionSearch.tsx`
- Delete: `src/components/sidebar/SurfaceTabs.tsx` (only if `SurfaceToggle` created in Task 8)
- Delete: `src/components/sidebar/NewSessionButton.tsx`
- Delete: `src/components/sidebar/AccountFooter.tsx`
- Delete: `src/components/sessions/SessionsDialog.tsx`
- Delete: `src/components/layout/SidebarToggle.tsx`
- Delete: `src/components/layout/ChatTitleBar.tsx`

- [ ] **Step 1: Delete files**

```bash
rm src/components/rail/MenuRail.tsx
rm src/components/rail/RailButton.tsx
rm src/components/sidebar/Sidebar.tsx
rm src/components/sidebar/SidebarPeek.tsx
rm src/components/sidebar/SessionList.tsx
rm src/components/sidebar/SessionSearch.tsx
rm src/components/sidebar/SurfaceTabs.tsx
rm src/components/sidebar/NewSessionButton.tsx
rm src/components/sidebar/AccountFooter.tsx
rm src/components/sessions/SessionsDialog.tsx
rm src/components/layout/SidebarToggle.tsx
rm src/components/layout/ChatTitleBar.tsx
```

Also delete their `.test.tsx` files if they only test deleted behavior.

- [ ] **Step 2: Fix any remaining imports**

Run: `yarn type-check`
Expected: errors for missing imports.

Fix all broken imports. Most will be resolved by previous tasks.

- [ ] **Step 3: Run tests**

Run: `yarn test`
Expected: all tests pass or only tests for deleted files fail (delete those tests).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(layout): remove obsolete sidebar, rail, and session dialog components"
```

---

### Task 10: Update i18n

**Files:**
- Modify: `src/i18n/zh-CN.ts`, `src/i18n/zh-TW.ts`, `src/i18n/en.ts`

**Interfaces:**
- Consumes: none
- Produces: new translation keys

- [ ] **Step 1: Add keys**

Add under `chat` and `tabs` namespaces in all three files:

```ts
tabs: {
  newSession: '新建会话',
  closeTab: '关闭标签页',
},
account: {
  menu: '账户菜单',
},
```

Verify `nav.chat`, `nav.code`, `nav.settings`, `common.logout` already exist.

- [ ] **Step 2: Add TypeScript declaration**

In `src/i18n/i18next.d.ts`, ensure `tabs` and `account` namespaces are typed if using strict typing. If the project uses a single `translation` namespace, add the keys under `translation` instead.

- [ ] **Step 3: Run tests**

Run: `yarn test src/i18n`
Expected: PASS (or no i18n-specific tests).

- [ ] **Step 4: Commit**

```bash
git add src/i18n/
git commit -m "i18n: add tabs and account menu keys"
```

---

### Task 11: Run full test suite and fix regressions

**Files:**
- Various

- [ ] **Step 1: Run type check**

Run: `yarn type-check`
Expected: no errors.

- [ ] **Step 2: Run unit tests**

Run: `yarn test`
Expected: all pass.

- [ ] **Step 3: Fix failures**

For each failure, update the test or implementation. Common issues:
- Tests looking for `Sidebar` or `MenuRail` should be removed/updated.
- `AppLayout` tests may need new mock for `FloatingAvatarButton`.
- Tests depending on `ChatTitleBar` content need to target `ConnectionStatus` or `PanelToggle`.

- [ ] **Step 4: Run e2e smoke if available**

Run: `yarn test:e2e --spec e2e/specs/smoke.spec.ts` (or equivalent)
Expected: basic app launch and new-session flow pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: fix regressions from layout redesign"
```

---

## Self-Review

**1. Spec coverage:**

| Spec requirement | Implementing task |
|------------------|-------------------|
| Tabs in title bar | Task 4 + Task 5 |
| No left sidebar | Task 7 + Task 9 |
| Floating avatar menu | Task 6 + Task 7 |
| Settings via avatar, full-screen overlay | Task 6 |
| New Conversation surface toggle | Task 8 |
| Code mode folder/permission in composer | Existing `NewConversation` + Task 8 toggle |
| Right-side panel preserved | Task 7 (uses existing ArtifactPanel/PreviewPanel) |
| Delete scheduled tasks | Not implemented (out of scope) |

**2. Placeholder scan:**

No TBD/TODO placeholders. All steps include concrete file paths, code, and commands.

**3. Type consistency:**

- `openSessionIds` is `string[]` throughout.
- `SessionTab` receives `SessionVM` consistently.
- `surfaceOf(session.config)` is used to derive `chat`/`code`.

**Known open decision:** Closing a tab currently deletes the session (per spec). If product decides to keep closed sessions in history, replace `sessionService.closeSession` call with remove-from-open-tabs only and add a history manager later.
