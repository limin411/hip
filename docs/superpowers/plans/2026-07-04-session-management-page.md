# Session Management Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a modal dialog to manage all sessions and limit the sidebar to the 5 most recent sessions for the current surface.

**Architecture:** Reuse the existing `SessionItem` row component inside a new `SessionsDialog`. Extract small presentational components for surface filtering and pagination. Slice the sidebar list to 5 after surface/query filtering and disable sidebar FTS.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Radix UI (Tabs, Dialog), Zustand, Vitest, react-i18next.

## Global Constraints

- Sidebar must show at most 5 sessions per surface.
- Sidebar search filters only those 5 sessions (no sidecar FTS).
- The session manager is a modal dialog opened from the sidebar footer.
- Pagination page size is 10.
- All i18n changes must be mirrored in `zh-CN.ts`, `zh-TW.ts`, and `en.ts`.
- Match existing component style, naming, and file layout.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/components/sessions/SessionFilters.tsx` | Surface filter tabs (all / chat / code). |
| `src/components/sessions/SessionPagination.tsx` | Previous / next / current page display. |
| `src/components/sessions/SessionsDialog.tsx` | Modal shell: search, filter, paginated list, total count. |
| `src/components/sessions/SessionsDialog.test.tsx` | Tests for filtering, pagination, select, rename, delete. |
| `src/components/sidebar/SearchBox.tsx` | Add optional `disableFts` prop for local-only search. |
| `src/components/sidebar/SessionSearch.tsx` | Pass `disableFts` to `SearchBox`. |
| `src/components/sidebar/SessionList.tsx` | Slice to 5 recent sessions; remove content-hits path. |
| `src/components/sidebar/SessionList.test.tsx` | Update/add tests for the 5-session limit. |
| `src/components/sidebar/Sidebar.tsx` | Add "查看全部会话" entry + `SessionsDialog`. |
| `src/components/sidebar/Sidebar.test.tsx` | Test that the entry opens the dialog. |
| `src/i18n/zh-CN.ts`, `zh-TW.ts`, `en.ts` | New translation keys. |

---

### Task 1: Add i18n keys

**Files:**
- Modify: `src/i18n/zh-CN.ts` (inside `sidebar` object)
- Modify: `src/i18n/zh-TW.ts` (inside `sidebar` object)
- Modify: `src/i18n/en.ts` (inside `sidebar` object)

**Interfaces:**
- Consumes: none
- Produces: new translation keys available to all components.

- [ ] **Step 1: Add keys to `zh-CN.ts`**

Insert into the `sidebar` object:

```ts
viewAllSessions: '查看全部会话',
allSessions: '全部会话',
sessionCount: '共 {{count}} 个会话',
filterAll: '全部',
filterChat: '办公',
filterCode: '编码',
```

- [ ] **Step 2: Add keys to `zh-TW.ts`**

```ts
viewAllSessions: '查看全部會話',
allSessions: '全部會話',
sessionCount: '共 {{count}} 個會話',
filterAll: '全部',
filterChat: '辦公',
filterCode: '編碼',
```

- [ ] **Step 3: Add keys to `en.ts`**

```ts
viewAllSessions: 'View all sessions',
allSessions: 'All Sessions',
sessionCount: '{{count}} sessions',
filterAll: 'All',
filterChat: 'Work',
filterCode: 'Code',
```

- [ ] **Step 4: Commit**

```bash
git add src/i18n/zh-CN.ts src/i18n/zh-TW.ts src/i18n/en.ts
git commit -m "i18n: add session management keys"
```

---

### Task 2: Add `disableFts` prop to `SearchBox`

**Files:**
- Modify: `src/components/sidebar/SearchBox.tsx`

**Interfaces:**
- Consumes: none
- Produces: `SearchBoxProps` gains `disableFts?: boolean`. When `true`, the debounced sidecar search is skipped.

- [ ] **Step 1: Update the interface and effect**

```tsx
interface SearchBoxProps {
  iconClassName?: string
  inputClassName?: string
  spinnerClassName?: string
  disableFts?: boolean
}

export function SearchBox({ iconClassName, inputClassName, spinnerClassName, disableFts }: SearchBoxProps = {}) {
  // ... existing hooks ...
  useEffect(() => {
    if (disableFts) return
    clearTimeout(timer.current)
    timer.current = setTimeout(() => sessionService.search(search.trim()), 200)
    return () => clearTimeout(timer.current)
  }, [search, disableFts])
  // ... rest unchanged ...
}
```

- [ ] **Step 2: Pass `disableFts` from `SessionSearch`**

```tsx
export function SessionSearch() {
  return (
    <SearchBox
      iconClassName="left-3"
      inputClassName="rounded-lg pl-9"
      spinnerClassName="right-3"
      disableFts
    />
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/sidebar/SearchBox.tsx src/components/sidebar/SessionSearch.tsx
git commit -m "feat(sidebar): disable sidecar FTS in sidebar search"
```

---

### Task 3: Limit `SessionList` to 5 sessions

**Files:**
- Modify: `src/components/sidebar/SessionList.tsx`
- Modify: `src/components/sidebar/SessionList.test.tsx`

**Interfaces:**
- Consumes: `useSessions`, `useActiveSessionId`, `useUiStore.search`, `sessionService`.
- Produces: `SessionList` renders at most 5 recent sessions for the current surface; content hits removed.

- [ ] **Step 1: Write failing test for 5-session limit**

Append to `src/components/sidebar/SessionList.test.tsx`:

Also remove the now-unused `SearchHit` import and the `mockHits` / `useSearchHits` mock entries from the file so the test stays clean.

```ts
describe('SessionList 5-session limit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSearch = ''
    mockSessions = []
    mockActiveSessionId = null
  })

  it('renders at most 5 recent chat sessions', () => {
    mockSessions = Array.from({ length: 8 }, (_, i) => ({
      id: `s-${i}`,
      title: `Session ${i}`,
      preview: '',
      updatedAtMs: now - i * 60_000,
      config: { llmProvider: 'openai', model: 'gpt-4', tools: [], surface: 'chat' },
      loaded: true,
      messages: [],
      status: 'idle',
      error: null,
    }))

    const html = renderToStaticMarkup(<SessionList />)
    expect(html).toContain('Session 0')
    expect(html).toContain('Session 4')
    expect(html).not.toContain('Session 5')
  })
})
```

Run:

```bash
yarn vitest run src/components/sidebar/SessionList.test.tsx
```

Expected: FAIL — `Session 5` is rendered.

- [ ] **Step 2: Implement the limit in `SessionList.tsx`**

Replace the content-hits block and update usages of `local`:

```tsx
export function SessionList() {
  const { t } = useTranslation()
  const activeView = useUiStore((s) => s.activeView)
  const surface: Surface = activeView === 'code' ? 'code' : 'chat'
  const sessions = filterBySurface(useSessions(), surface)
  const search = useUiStore((s) => s.search)
  const activeSessionId = useActiveSessionId()

  const q = search.trim()
  const local = filterSessions(sessions, q).slice(0, 5)

  if (local.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center">
        <SearchX size={20} className="text-ink-tertiary" />
        <div className="flex flex-col gap-1">
          <p className="text-meta text-ink-secondary">{t('sidebar.noMatches')}</p>
          {q && (
            <button
              onClick={() => useUiStore.getState().setSearch('')}
              className="rounded text-meta text-accent hover:text-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              {t('sidebar.clearSearch')}
            </button>
          )}
        </div>
      </div>
    )
  }

  if (q) {
    return (
      <div className="flex flex-col gap-1">
        <div className="px-2.5 text-caption uppercase tracking-wider text-ink-tertiary">
          {t('sidebar.searchResults')}
        </div>
        <div className="flex flex-col gap-0.5">
          {local.map((session) => (
            <SessionItem
              key={session.id}
              session={session}
              active={session.id === activeSessionId}
              onSelect={() => sessionService.selectSession(session.id)}
              onDelete={() => sessionService.deleteSession(session.id)}
            />
          ))}
        </div>
      </div>
    )
  }

  const grouped = groupSessionsByRelativeDate(local)

  return (
    <div className="flex flex-col gap-4">
      {grouped.map(({ key, sessions: groupSessions }) => (
        <div key={key} className="flex flex-col gap-1">
          <div className="px-2.5 text-caption uppercase tracking-wider text-ink-tertiary">
            {t(`sidebar.dateGroup.${key}`)}
          </div>
          <div className="flex flex-col gap-0.5">
            {groupSessions.map((session) => (
              <SessionItem
                key={session.id}
                session={session}
                active={session.id === activeSessionId}
                onSelect={() => sessionService.selectSession(session.id)}
                onDelete={() => sessionService.deleteSession(session.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
```

Remove the now-unused `useSearchHits` import and the `hits` / `contentHits` logic.

- [ ] **Step 3: Run tests**

```bash
yarn vitest run src/components/sidebar/SessionList.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/sidebar/SessionList.tsx src/components/sidebar/SessionList.test.tsx
git commit -m "feat(sidebar): limit session list to 5 recent sessions"
```

---

### Task 4: Create `SessionFilters` component

**Files:**
- Create: `src/components/sessions/SessionFilters.tsx`
- Create: `src/components/sessions/SessionFilters.test.tsx`

**Interfaces:**
- Consumes: `Tabs`, `TabsList`, `TabsTrigger` from `@/components/ui/Tabs`; `useTranslation`.
- Produces: `SessionFilter` type and `SessionFilters` component.

- [ ] **Step 1: Write failing test**

Create `src/components/sessions/SessionFilters.test.tsx`:

```tsx
// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SessionFilters } from './SessionFilters'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

describe('SessionFilters', () => {
  it('renders all three filter tabs', () => {
    render(<SessionFilters value="all" onChange={vi.fn()} />)
    expect(screen.getByText('sidebar.filterAll')).toBeInTheDocument()
    expect(screen.getByText('sidebar.filterChat')).toBeInTheDocument()
    expect(screen.getByText('sidebar.filterCode')).toBeInTheDocument()
  })

  it('calls onChange when a different tab is clicked', () => {
    const onChange = vi.fn()
    render(<SessionFilters value="all" onChange={onChange} />)
    fireEvent.click(screen.getByText('sidebar.filterCode'))
    expect(onChange).toHaveBeenCalledWith('code')
  })
})
```

Run:

```bash
yarn vitest run src/components/sessions/SessionFilters.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 2: Implement `SessionFilters.tsx`**

```tsx
import { useTranslation } from 'react-i18next'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/Tabs'

export type SessionFilter = 'all' | 'chat' | 'code'

interface SessionFiltersProps {
  value: SessionFilter
  onChange: (value: SessionFilter) => void
}

export function SessionFilters({ value, onChange }: SessionFiltersProps) {
  const { t } = useTranslation()
  return (
    <Tabs value={value} onValueChange={(v) => onChange(v as SessionFilter)}>
      <TabsList>
        <TabsTrigger value="all">{t('sidebar.filterAll')}</TabsTrigger>
        <TabsTrigger value="chat">{t('sidebar.filterChat')}</TabsTrigger>
        <TabsTrigger value="code">{t('sidebar.filterCode')}</TabsTrigger>
      </TabsList>
    </Tabs>
  )
}
```

- [ ] **Step 3: Run tests**

```bash
yarn vitest run src/components/sessions/SessionFilters.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/sessions/SessionFilters.tsx src/components/sessions/SessionFilters.test.tsx
git commit -m "feat(sessions): add surface filter tabs"
```

---

### Task 5: Create `SessionPagination` component

**Files:**
- Create: `src/components/sessions/SessionPagination.tsx`
- Create: `src/components/sessions/SessionPagination.test.tsx`

**Interfaces:**
- Consumes: none
- Produces: `SessionPagination` component.

- [ ] **Step 1: Write failing test**

Create `src/components/sessions/SessionPagination.test.tsx`:

```tsx
// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SessionPagination } from './SessionPagination'

describe('SessionPagination', () => {
  it('renders nothing when there is only one page', () => {
    const { container } = render(<SessionPagination page={1} totalPages={1} onChange={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders page info and buttons', () => {
    render(<SessionPagination page={2} totalPages={3} onChange={vi.fn()} />)
    expect(screen.getByText('2 / 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /previous/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument()
  })

  it('disables previous on first page', () => {
    render(<SessionPagination page={1} totalPages={3} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled()
  })

  it('calls onChange with next page', () => {
    const onChange = vi.fn()
    render(<SessionPagination page={1} totalPages={3} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(onChange).toHaveBeenCalledWith(2)
  })
})
```

Run:

```bash
yarn vitest run src/components/sessions/SessionPagination.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 2: Implement `SessionPagination.tsx`**

```tsx
interface SessionPaginationProps {
  page: number
  totalPages: number
  onChange: (page: number) => void
}

export function SessionPagination({ page, totalPages, onChange }: SessionPaginationProps) {
  if (totalPages <= 1) return null

  return (
    <div className="flex items-center justify-center gap-2 text-body text-ink-secondary">
      <button
        type="button"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        className="rounded-md px-2 py-1 transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
      >
        Previous
      </button>
      <span className="min-w-[3ch] text-center text-caption">
        {page} / {totalPages}
      </span>
      <button
        type="button"
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
        className="rounded-md px-2 py-1 transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
      >
        Next
      </button>
    </div>
  )
}
```

- [ ] **Step 3: Run tests**

```bash
yarn vitest run src/components/sessions/SessionPagination.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/sessions/SessionPagination.tsx src/components/sessions/SessionPagination.test.tsx
git commit -m "feat(sessions): add pagination controls"
```

---

### Task 6: Create `SessionsDialog` component

**Files:**
- Create: `src/components/sessions/SessionsDialog.tsx`
- Create: `src/components/sessions/SessionsDialog.test.tsx`

**Interfaces:**
- Consumes: `useSessions`, `useActiveSessionId`, `sessionService`, `filterSessions`, `filterBySurface`, `Modal`, `SessionItem`, `SessionFilters`, `SessionPagination`.
- Produces: `SessionsDialog` component with `open` / `onOpenChange` props.

- [ ] **Step 1: Write failing test**

Create `src/components/sessions/SessionsDialog.test.tsx`:

```tsx
// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SessionsDialog } from './SessionsDialog'
import type { SessionVM } from '@/domain/sessionStore'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { resolvedLanguage: 'en', language: 'en' } }),
}))

let mockSessions: SessionVM[] = []
let mockActiveSessionId: string | null = null

vi.mock('@/domain', () => ({
  useSessions: () => mockSessions,
  useActiveSessionId: () => mockActiveSessionId,
  sessionService: {
    selectSession: vi.fn(),
    deleteSession: vi.fn(),
  },
}))

const baseSession = (id: string, surface: 'chat' | 'code', updatedAtMs: number): SessionVM => ({
  id,
  title: id,
  preview: '',
  updatedAtMs,
  config: { llmProvider: 'openai', model: 'gpt-4', tools: [], surface },
  loaded: true,
  messages: [],
  status: 'idle',
  error: null,
})

describe('SessionsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSessions = []
    mockActiveSessionId = null
  })

  it('filters by surface', () => {
    mockSessions = [
      baseSession('chat-1', 'chat', Date.now()),
      baseSession('code-1', 'code', Date.now()),
    ]
    render(<SessionsDialog open onOpenChange={vi.fn()} />)
    fireEvent.click(screen.getByText('sidebar.filterCode'))
    expect(screen.queryByText('chat-1')).not.toBeInTheDocument()
    expect(screen.getByText('code-1')).toBeInTheDocument()
  })

  it('paginates results', () => {
    mockSessions = Array.from({ length: 25 }, (_, i) => baseSession(`s-${i}`, 'chat', Date.now() - i))
    render(<SessionsDialog open onOpenChange={vi.fn()} />)
    expect(screen.getByText('s-0')).toBeInTheDocument()
    expect(screen.getByText('s-19')).toBeInTheDocument()
    expect(screen.queryByText('s-20')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByText('s-20')).toBeInTheDocument()
  })

  it('selects a session and closes', () => {
    const onOpenChange = vi.fn()
    mockSessions = [baseSession('chat-1', 'chat', Date.now())]
    render(<SessionsDialog open onOpenChange={onOpenChange} />)
    fireEvent.click(screen.getByText('chat-1'))
    expect(sessionService.selectSession).toHaveBeenCalledWith('chat-1')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
```

Run:

```bash
yarn vitest run src/components/sessions/SessionsDialog.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 2: Implement `SessionsDialog.tsx`**

```tsx
import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { SessionItem } from '@/components/sidebar/SessionItem'
import { useSessions, useActiveSessionId, sessionService } from '@/domain'
import { filterSessions, filterBySurface } from '@/lib/sessions'
import { cn } from '@/lib/utils'
import { SessionFilters, type SessionFilter } from './SessionFilters'
import { SessionPagination } from './SessionPagination'

const PAGE_SIZE = 10

interface SessionsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SessionsDialog({ open, onOpenChange }: SessionsDialogProps) {
  const { t } = useTranslation()
  const sessions = useSessions()
  const activeSessionId = useActiveSessionId()
  const [filter, setFilter] = useState<SessionFilter>('all')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)

  const filtered = useMemo(() => {
    let list = sessions
    if (filter !== 'all') {
      list = filterBySurface(list, filter)
    }
    list = filterSessions(list, query)
    return list.sort((a, b) => b.updatedAtMs - a.updatedAtMs)
  }, [sessions, filter, query])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageSessions = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const handleSelect = (id: string) => {
    sessionService.selectSession(id)
    onOpenChange(false)
  }

  const handleFilterChange = (value: SessionFilter) => {
    setFilter(value)
    setPage(1)
  }

  const handleQueryChange = (value: string) => {
    setQuery(value)
    setPage(1)
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('sidebar.allSessions')}
      className="max-w-2xl"
      footer={<SessionPagination page={page} totalPages={totalPages} onChange={setPage} />}
    >
      <div className="flex h-full flex-col gap-3 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <SessionFilters value={filter} onChange={handleFilterChange} />
          <div className="relative flex-1">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-tertiary"
            />
            <input
              data-testid="sessions-dialog-search"
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              placeholder={t('sidebar.search')}
              className={cn(
                'h-9 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-body text-ink placeholder:text-ink-tertiary',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
              )}
            />
          </div>
        </div>
        <div className="text-caption text-ink-tertiary">
          {t('sidebar.sessionCount', { count: filtered.length })}
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="flex flex-col gap-0.5">
            {pageSessions.map((session) => (
              <SessionItem
                key={session.id}
                session={session}
                active={session.id === activeSessionId}
                onSelect={() => handleSelect(session.id)}
                onDelete={() => sessionService.deleteSession(session.id)}
              />
            ))}
          </div>
          {pageSessions.length === 0 && (
            <div className="py-8 text-center text-meta text-ink-secondary">
              {t('sidebar.noMatches')}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
```

- [ ] **Step 3: Run tests**

```bash
yarn vitest run src/components/sessions/SessionsDialog.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/sessions/SessionsDialog.tsx src/components/sessions/SessionsDialog.test.tsx
git commit -m "feat(sessions): add all-sessions dialog"
```

---

### Task 7: Wire dialog into `Sidebar`

**Files:**
- Modify: `src/components/sidebar/Sidebar.tsx`
- Modify: `src/components/sidebar/Sidebar.test.tsx`

**Interfaces:**
- Consumes: `SessionsDialog`.
- Produces: `Sidebar` shows a "View all sessions" entry that opens the dialog.

- [ ] **Step 1: Write failing test**

Update `src/components/sidebar/Sidebar.test.tsx` to mock `SessionsDialog` as a visible child, then add:

```tsx
vi.mock('@/components/sessions/SessionsDialog', () => ({
  SessionsDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="sessions-dialog">sidebar.allSessions</div> : null),
}))
```

Then add:

```tsx
import { fireEvent, screen } from '@testing-library/react'
// ... existing imports ...

describe('Sidebar session manager entry', () => {
  it('opens the sessions dialog when "查看全部会话" is clicked', () => {
    render(<Sidebar />)
    fireEvent.click(screen.getByText('sidebar.viewAllSessions'))
    expect(screen.getByTestId('sessions-dialog')).toBeInTheDocument()
  })
})
```

Run:

```bash
yarn vitest run src/components/sidebar/Sidebar.test.tsx
```

Expected: FAIL — button not found.

- [ ] **Step 2: Implement `Sidebar.tsx`**

```tsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useUiStore, type Surface } from '@/store/uiStore'
import { sessionService } from '@/domain'
import { SurfaceTabs } from './SurfaceTabs'
import { NewSessionButton } from './NewSessionButton'
import { SessionSearch } from './SessionSearch'
import { SessionList } from './SessionList'
import { AccountFooter } from './AccountFooter'
import { SessionsDialog } from '@/components/sessions/SessionsDialog'

export function Sidebar() {
  const { t } = useTranslation()
  const [dialogOpen, setDialogOpen] = useState(false)
  const activeView = useUiStore((s) => s.activeView)
  const surface: Surface = activeView === 'code' ? 'code' : 'chat'

  return (
    <div data-testid="sidebar-root" className="flex h-full flex-col bg-[var(--glass-bg)] backdrop-blur-xl border-r border-[var(--glass-border)]">
      <div className="flex flex-col gap-2.5 p-3">
        <SurfaceTabs active={surface} onChange={(v) => sessionService.setSurface(v)} />
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <SessionSearch />
          </div>
          <NewSessionButton surface={surface} iconOnly />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3">
        <SessionList />
      </div>
      <div className="flex flex-col gap-1 px-3 pb-3">
        <button
          type="button"
          data-testid="view-all-sessions"
          onClick={() => setDialogOpen(true)}
          className="w-full rounded-md px-2.5 py-2 text-left text-body text-ink-secondary transition-colors hover:bg-surface-muted"
        >
          {t('sidebar.viewAllSessions')}
        </button>
        <AccountFooter />
      </div>
      <SessionsDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  )
}
```

- [ ] **Step 3: Run tests**

```bash
yarn vitest run src/components/sidebar/Sidebar.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/sidebar/Sidebar.tsx src/components/sidebar/Sidebar.test.tsx
git commit -m "feat(sidebar): add entry to all-sessions dialog"
```

---

## Verification

- [ ] Run the full frontend test suite:

```bash
yarn test
```

Expected: all tests pass.

- [ ] Run TypeScript type check:

```bash
yarn type-check
```

Expected: no errors.

---

## Plan Self-Review

- **Spec coverage:**
  - Modal dialog for all sessions → Task 6.
  - Sidebar 5-session limit → Task 3.
  - Surface filter + search + pagination → Tasks 4, 5, 6.
  - Rename/delete via existing `SessionItem` → Task 6 reuses `SessionItem`.
  - i18n updates → Task 1.
  - Tests → every task includes tests.
- **Placeholder scan:** no TBD/TODO; every step has concrete code or commands.
- **Type consistency:** `SessionFilter` is defined in Task 4 and imported in Task 6. `SessionsDialogProps` uses `open: boolean` and `onOpenChange: (open: boolean) => void` consistently.
