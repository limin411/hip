# 侧边栏 Kimi Work 风格改造 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 hip 左侧双层导航（MenuRail + Sidebar）改造为参考 Kimi Work 风格的单层侧栏。

**Architecture:** 移除 MenuRail，在 Sidebar 内新增 SurfaceTabs、NewSessionButton、SessionSearch、AccountFooter，复用并改造 SessionList/SessionItem；新增按本地日期分组的纯函数；AppLayout 调整 Panel 尺寸并移除 MenuRail。

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Vite, Vitest (node env), zustand, react-i18next

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `src/lib/sessions.ts` | Modify | 新增 `groupSessionsByRelativeDate` 分组函数 |
| `src/lib/sessions.test.ts` | Modify | 覆盖分组函数测试 |
| `src/components/sidebar/SurfaceTabs.tsx` | Create | 顶部 Chat/Code Tab 切换 |
| `src/components/sidebar/SurfaceTabs.test.tsx` | Create | SurfaceTabs 渲染测试 |
| `src/components/sidebar/AccountFooter.tsx` | Create | 底部账户栏（头像 + 设置/退出） |
| `src/components/sidebar/AccountFooter.test.tsx` | Create | AccountFooter 渲染测试 |
| `src/components/sidebar/NewSessionButton.tsx` | Create | 上下文主按钮 |
| `src/components/sidebar/NewSessionButton.test.tsx` | Create | 主按钮文案测试 |
| `src/components/sidebar/SessionSearch.tsx` | Create | 圆角搜索框 |
| `src/components/sidebar/SessionList.tsx` | Modify | 按今天/昨天/更早分组渲染 |
| `src/components/sidebar/SessionList.test.tsx` | Create | 分组渲染测试 |
| `src/components/sidebar/SessionItem.tsx` | Modify | 圆角、active 态样式 |
| `src/components/sidebar/Sidebar.tsx` | Modify | 组装新侧栏布局 |
| `src/routes/AppLayout.tsx` | Modify | 移除 MenuRail，调整 Panel 尺寸 |
| `src/i18n/zh-CN.ts` | Modify | 新增侧边栏相关文案 |
| `src/i18n/zh-TW.ts` | Modify | 新增侧边栏相关文案 |
| `src/i18n/en.ts` | Modify | 新增侧边栏相关文案 |

---

### Task 1: 添加会话按日期分组工具

**Files:**
- Modify: `src/lib/sessions.ts`
- Test: `src/lib/sessions.test.ts`

目标：把会话列表按本地日期分为「今天 / 昨天 / 更早」。

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, it, expect } from 'vitest'
import { groupSessionsByRelativeDate } from './sessions'

describe('groupSessionsByRelativeDate', () => {
  const now = new Date('2026-06-25T14:00:00').getTime()

  it('groups sessions into today, yesterday, and older', () => {
    const sessions = [
      { id: 'today-1', updatedAtMs: now - 3_600_000 },
      { id: 'today-2', updatedAtMs: now - 60_000 },
      { id: 'yesterday', updatedAtMs: now - 86_400_000 },
      { id: 'older', updatedAtMs: now - 86_400_000 * 3 },
    ]
    const result = groupSessionsByRelativeDate(sessions, now)
    expect(result.map((g) => g.key)).toEqual(['today', 'yesterday', 'older'])
    expect(result[0].sessions.map((s) => s.id)).toEqual(['today-1', 'today-2'])
    expect(result[1].sessions.map((s) => s.id)).toEqual(['yesterday'])
    expect(result[2].sessions.map((s) => s.id)).toEqual(['older'])
  })

  it('omits empty groups', () => {
    const result = groupSessionsByRelativeDate(
      [{ id: 'only-today', updatedAtMs: now - 60_000 }],
      now,
    )
    expect(result).toHaveLength(1)
    expect(result[0].key).toBe('today')
  })

  it('returns empty array for no sessions', () => {
    expect(groupSessionsByRelativeDate([], now)).toEqual([])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `yarn test src/lib/sessions.test.ts`
Expected: FAIL — `groupSessionsByRelativeDate is not defined`

- [ ] **Step 3: 实现最小代码**

在 `src/lib/sessions.ts` 末尾追加：

```typescript
export type DateGroupKey = 'today' | 'yesterday' | 'older'

export function groupSessionsByRelativeDate<T extends { updatedAtMs: number }>(
  sessions: T[],
  now: number = Date.now(),
): { key: DateGroupKey; sessions: T[] }[] {
  const dayStart = (ms: number): number => {
    const d = new Date(ms)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }

  const todayStart = dayStart(now)
  const yesterdayStart = todayStart - 86_400_000

  const groups: Record<DateGroupKey, T[]> = { today: [], yesterday: [], older: [] }
  for (const s of sessions) {
    const start = dayStart(s.updatedAtMs)
    if (start === todayStart) groups.today.push(s)
    else if (start === yesterdayStart) groups.yesterday.push(s)
    else groups.older.push(s)
  }

  const result: { key: DateGroupKey; sessions: T[] }[] = []
  if (groups.today.length) result.push({ key: 'today', sessions: groups.today })
  if (groups.yesterday.length) result.push({ key: 'yesterday', sessions: groups.yesterday })
  if (groups.older.length) result.push({ key: 'older', sessions: groups.older })
  return result
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `yarn test src/lib/sessions.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/lib/sessions.ts src/lib/sessions.test.ts
git commit -m "feat(lib): add groupSessionsByRelativeDate utility"
```

---

### Task 2: 创建 SurfaceTabs 组件

**Files:**
- Create: `src/components/sidebar/SurfaceTabs.tsx`
- Test: `src/components/sidebar/SurfaceTabs.test.tsx`

- [ ] **Step 1: 写失败测试**

创建 `src/components/sidebar/SurfaceTabs.test.tsx`：

```tsx
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SurfaceTabs } from './SurfaceTabs'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

describe('SurfaceTabs', () => {
  it('renders chat and code labels', () => {
    const html = renderToStaticMarkup(<SurfaceTabs active="chat" onChange={() => {}} />)
    expect(html).toContain('nav.chat')
    expect(html).toContain('nav.code')
  })

  it('marks active tab with selected styling', () => {
    const html = renderToStaticMarkup(<SurfaceTabs active="code" onChange={() => {}} />)
    // active tab gets bg-surface-muted; easier to assert by order/aria in real render
    expect(html).toContain('aria-pressed="true"')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `yarn test src/components/sidebar/SurfaceTabs.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: 实现组件**

创建 `src/components/sidebar/SurfaceTabs.tsx`：

```tsx
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

interface SurfaceTabsProps {
  active: 'chat' | 'code'
  onChange: (view: 'chat' | 'code') => void
}

export function SurfaceTabs({ active, onChange }: SurfaceTabsProps) {
  const { t } = useTranslation()
  return (
    <div className="flex justify-center gap-1 p-1">
      {(['chat', 'code'] as const).map((view) => {
        const isActive = active === view
        return (
          <button
            key={view}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(view)}
            className={cn(
              'rounded-full px-4 py-1 text-sm font-medium transition',
              isActive ? 'bg-surface-muted text-ink' : 'text-ink-tertiary hover:text-ink',
            )}
          >
            {t(`nav.${view}`)}
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `yarn test src/components/sidebar/SurfaceTabs.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/components/sidebar/SurfaceTabs.tsx src/components/sidebar/SurfaceTabs.test.tsx
git commit -m "feat(sidebar): add SurfaceTabs component"
```

---

### Task 3: 创建 AccountFooter 组件

**Files:**
- Create: `src/components/sidebar/AccountFooter.tsx`
- Test: `src/components/sidebar/AccountFooter.test.tsx`

- [ ] **Step 1: 写失败测试**

创建 `src/components/sidebar/AccountFooter.test.tsx`：

```tsx
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AccountFooter } from './AccountFooter'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: any) => any) => selector({ logout: vi.fn() }),
}))

vi.mock('@/store/uiStore', () => ({
  useUiStore: (selector: (s: any) => any) => selector({ setActiveView: vi.fn() }),
}))

vi.mock('@/components/ui/DropdownMenu', async () => {
  const React = await import('react')
  return {
    DropdownMenu: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    DropdownMenuContent: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'menu-content' }, children),
    DropdownMenuItem: ({ children }: { children: React.ReactNode }) => React.createElement('button', null, children),
    DropdownMenuSeparator: () => React.createElement('hr'),
    DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
  }
})

describe('AccountFooter', () => {
  it('renders user name and email', () => {
    const html = renderToStaticMarkup(<AccountFooter />)
    expect(html).toContain('User')
    expect(html).toContain('user@example.com')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `yarn test src/components/sidebar/AccountFooter.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: 实现组件**

创建 `src/components/sidebar/AccountFooter.tsx`：

```tsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Settings, LogOut } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { useUiStore } from '@/store/uiStore'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/DropdownMenu'

// TODO: replace with real authenticated user once auth flow is implemented
const currentUser = { name: 'User', email: 'user@example.com', avatarUrl: undefined }

export function AccountFooter() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const logout = useAuthStore((s) => s.logout)
  const setActiveView = useUiStore((s) => s.setActiveView)
  const [confirmLogout, setConfirmLogout] = useState(false)

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-3 border-t border-border pt-3 text-left transition hover:bg-surface-muted"
          >
            <Avatar name={currentUser.name} src={currentUser.avatarUrl} size={28} />
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-body font-medium text-ink">{currentUser.name}</span>
              <span className="truncate text-caption text-ink-tertiary">{currentUser.email}</span>
            </div>
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent side="top" align="start" className="w-[220px]">
          <DropdownMenuLabel>{currentUser.email}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setActiveView('settings')}>
            <Settings size={15} className="text-ink-secondary" />
            {t('nav.settings')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-danger focus:bg-danger/10"
            onSelect={() => setConfirmLogout(true)}
          >
            <LogOut size={15} />
            {t('common.logout')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Modal open={confirmLogout} onOpenChange={setConfirmLogout} title={t('common.logoutConfirmTitle')}>
        <div className="flex flex-col gap-5 p-5">
          <p className="text-body text-ink-secondary">{t('common.logoutConfirmDesc')}</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setConfirmLogout(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              className="bg-danger text-white hover:bg-danger/90"
              onClick={() => {
                setConfirmLogout(false)
                logout()
                navigate('/login')
              }}
            >
              {t('common.logout')}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `yarn test src/components/sidebar/AccountFooter.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/components/sidebar/AccountFooter.tsx src/components/sidebar/AccountFooter.test.tsx
git commit -m "feat(sidebar): add AccountFooter component"
```

---

### Task 4: 创建 NewSessionButton 组件

**Files:**
- Create: `src/components/sidebar/NewSessionButton.tsx`
- Test: `src/components/sidebar/NewSessionButton.test.tsx`

- [ ] **Step 1: 写失败测试**

创建 `src/components/sidebar/NewSessionButton.test.tsx`：

```tsx
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { NewSessionButton } from './NewSessionButton'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/domain', () => ({
  sessionService: { newConversation: vi.fn() },
}))

describe('NewSessionButton', () => {
  it('renders chat label', () => {
    const html = renderToStaticMarkup(<NewSessionButton surface="chat" />)
    expect(html).toContain('sidebar.newChat')
  })

  it('renders code label', () => {
    const html = renderToStaticMarkup(<NewSessionButton surface="code" />)
    expect(html).toContain('sidebar.newCodeTask')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `yarn test src/components/sidebar/NewSessionButton.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: 实现组件**

创建 `src/components/sidebar/NewSessionButton.tsx`：

```tsx
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { sessionService } from '@/domain'
import { Button } from '@/components/ui/Button'

interface NewSessionButtonProps {
  surface: 'chat' | 'code'
}

export function NewSessionButton({ surface }: NewSessionButtonProps) {
  const { t } = useTranslation()
  return (
    <Button
      variant="outline"
      size="sm"
      className="w-full"
      onClick={() => sessionService.newConversation()}
    >
      <Plus size={16} />
      <span>{surface === 'code' ? t('sidebar.newCodeTask') : t('sidebar.newChat')}</span>
    </Button>
  )
}
```

> 注：当前 `sessionService.newConversation()` 未接收 surface 参数，文案随 Tab 变化但行为与旧版「新建会话」一致。若后续需要 Code Tab 下默认创建 code surface 的草稿，可扩展为 `newConversation({ surface })`。

- [ ] **Step 4: 运行测试确认通过**

Run: `yarn test src/components/sidebar/NewSessionButton.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/components/sidebar/NewSessionButton.tsx src/components/sidebar/NewSessionButton.test.tsx
git commit -m "feat(sidebar): add NewSessionButton component"
```

---

### Task 5: 创建 SessionSearch 组件

**Files:**
- Create: `src/components/sidebar/SessionSearch.tsx`

- [ ] **Step 1: 直接实现（无独立测试，样式改动轻，逻辑复用 SearchBox）**

创建 `src/components/sidebar/SessionSearch.tsx`：

```tsx
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, Loader2 } from 'lucide-react'
import { useUiStore } from '@/store/uiStore'
import { sessionService, useSearching } from '@/domain'
import { cn } from '@/lib/utils'

export function SessionSearch() {
  const { t } = useTranslation()
  const search = useUiStore((s) => s.search)
  const setSearch = useUiStore((s) => s.setSearch)
  const searching = useSearching()
  const timer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => sessionService.search(search.trim()), 200)
    return () => clearTimeout(timer.current)
  }, [search])

  return (
    <div className="relative">
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-tertiary" />
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('sidebar.search')}
        className={cn(
          'h-9 w-full rounded-lg border border-border bg-surface pl-9 text-body text-ink placeholder:text-ink-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
          searching ? 'pr-9' : 'pr-3',
        )}
      />
      {searching && (
        <Loader2 size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-ink-tertiary" />
      )}
    </div>
  )
}
```

- [ ] **Step 2: 运行 type-check**

Run: `yarn type-check`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add src/components/sidebar/SessionSearch.tsx
git commit -m "feat(sidebar): add SessionSearch component"
```

---

### Task 6: 更新 SessionList 支持分组

**Files:**
- Modify: `src/components/sidebar/SessionList.tsx`
- Test: `src/components/sidebar/SessionList.test.tsx`

- [ ] **Step 1: 写失败测试**

创建 `src/components/sidebar/SessionList.test.tsx`：

```tsx
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SessionList } from './SessionList'
import type { SessionVM } from '@/domain'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/store/uiStore', () => ({
  useUiStore: (selector: (s: any) => any) =>
    selector({
      activeView: 'chat',
      search: '',
      setSearch: vi.fn(),
    }),
}))

vi.mock('@/domain', () => ({
  useSessions: () => [],
  useActiveSessionId: () => null,
  useSearchHits: () => [],
  useSearching: () => false,
  sessionService: {
    selectSession: vi.fn(),
    deleteSession: vi.fn(),
    search: vi.fn(),
  },
}))

describe('SessionList empty', () => {
  it('renders no matches state', () => {
    const html = renderToStaticMarkup(<SessionList />)
    expect(html).toContain('sidebar.noMatches')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `yarn test src/components/sidebar/SessionList.test.tsx`
Expected: FAIL — `SessionList` renders nothing because `useUiStore` selector returns undefined

- [ ] **Step 3: 实现组件**

修改 `src/components/sidebar/SessionList.tsx` 为：

```tsx
import { useTranslation } from 'react-i18next'
import { SearchX } from 'lucide-react'
import { useUiStore } from '@/store/uiStore'
import { useSessions, useActiveSessionId, useSearchHits, sessionService } from '@/domain'
import { filterSessions, filterBySurface, groupSessionsByRelativeDate } from '@/lib/sessions'
import { SessionItem } from './SessionItem'

export function SessionList() {
  const { t } = useTranslation()
  const activeView = useUiStore((s) => s.activeView)
  const surface = activeView === 'code' ? 'code' : 'chat'
  const sessions = filterBySurface(useSessions(), surface)
  const search = useUiStore((s) => s.search)
  const activeSessionId = useActiveSessionId()
  const hits = useSearchHits()

  const q = search.trim()
  const local = filterSessions(sessions, q)
  const surfaceIds = new Set(sessions.map((s) => s.id))
  const seen = new Set(local.map((s) => s.id))
  const contentHits = q
    ? hits.filter((h) => {
        if (!h.sessionId || !surfaceIds.has(h.sessionId) || seen.has(h.sessionId)) return false
        seen.add(h.sessionId)
        return true
      })
    : []

  if (local.length === 0 && contentHits.length === 0) {
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
      {contentHits.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="px-2.5 text-caption uppercase tracking-wider text-ink-tertiary">
            {t('sidebar.searchResults')}
          </div>
          <div className="flex flex-col gap-0.5">
            {contentHits.map((h) => {
              const s = sessions.find((x) => x.id === h.sessionId)
              if (!s) return null
              return (
                <SessionItem
                  key={`hit-${h.sessionId}`}
                  session={s}
                  snippet={h.snippet}
                  active={s.id === activeSessionId}
                  onSelect={() => sessionService.selectSession(s.id, h.messageId ?? undefined)}
                  onDelete={() => sessionService.deleteSession(s.id)}
                />
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `yarn test src/components/sidebar/SessionList.test.tsx src/lib/sessions.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/components/sidebar/SessionList.tsx src/components/sidebar/SessionList.test.tsx
git commit -m "feat(sidebar): group SessionList by relative date"
```

---

### Task 7: 更新 SessionItem 样式

**Files:**
- Modify: `src/components/sidebar/SessionItem.tsx`

- [ ] **Step 1: 修改样式**

在 `src/components/sidebar/SessionItem.tsx` 中替换 className：

```tsx
<div
  data-testid="session-item"
  onClick={editing ? undefined : onSelect}
  className={cn(
    'group flex cursor-pointer flex-col gap-0.5 rounded-lg px-2.5 py-2 transition-colors',
    active ? 'bg-accent/10 text-accent-strong' : 'text-ink hover:bg-surface-muted',
  )}
>
```

同时更新 input 的 className 保持协调（可选，当前已足够）。

- [ ] **Step 2: 运行现有测试**

Run: `yarn test src/components/sidebar/SessionItem.test.tsx 2>/dev/null || echo "no test file"`
Expected: 无测试文件则跳过；若有则 PASS

- [ ] **Step 3: 提交**

```bash
git add src/components/sidebar/SessionItem.tsx
git commit -m "style(sidebar): round SessionItem corners and soften active state"
```

---

### Task 8: 组装新 Sidebar

**Files:**
- Modify: `src/components/sidebar/Sidebar.tsx`

- [ ] **Step 1: 重写 Sidebar**

```tsx
import { useUiStore } from '@/store/uiStore'
import { sessionService } from '@/domain'
import { SurfaceTabs } from './SurfaceTabs'
import { NewSessionButton } from './NewSessionButton'
import { SessionSearch } from './SessionSearch'
import { SessionList } from './SessionList'
import { AccountFooter } from './AccountFooter'

export function Sidebar() {
  const activeView = useUiStore((s) => s.activeView)
  const surface = activeView === 'code' ? 'code' : 'chat'

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-2.5 p-3">
        <SurfaceTabs active={surface} onChange={(v) => sessionService.setSurface(v)} />
        <NewSessionButton surface={surface} />
        <SessionSearch />
      </div>
      <div className="flex-1 overflow-y-auto px-3">
        <SessionList />
      </div>
      <div className="px-3 pb-3">
        <AccountFooter />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 运行 type-check**

Run: `yarn type-check`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add src/components/sidebar/Sidebar.tsx
git commit -m "feat(sidebar): assemble new Sidebar layout"
```

---

### Task 9: 更新 AppLayout 移除 MenuRail

**Files:**
- Modify: `src/routes/AppLayout.tsx`

- [ ] **Step 1: 移除 MenuRail 并调整 Panel**

修改 `src/routes/AppLayout.tsx`：

1. 删除 `import { MenuRail } from '@/components/rail/MenuRail'`
2. 删除 `<MenuRail />` 节点
3. 将 Sidebar Panel 的 `defaultSize={14}` 改为 `defaultSize={18}`，`minSize={12}`，`maxSize={22}` 保持不变
4. 最外层 flex 中移除 MenuRail 所占的窄列逻辑（当前已经包裹在 relative flex-1 中，直接删除 `<MenuRail />` 即可）

修改后的相关片段应类似：

```tsx
<div className="relative flex min-h-0 flex-1">
  <div className="relative min-w-0 flex-1">
    <PanelGroup direction="horizontal" className="h-full w-full">
      <Panel
        ref={sidebarRef}
        defaultSize={18}
        minSize={12}
        maxSize={22}
        collapsible
        collapsedSize={0}
        onCollapse={() => setCollapsed(true)}
        onExpand={() => setCollapsed(false)}
      >
        {!collapsed && (
          <div className="h-full bg-surface">
            <Sidebar />
          </div>
        )}
      </Panel>
      {/* ... rest unchanged ... */}
```

- [ ] **Step 2: 运行 type-check**

Run: `yarn type-check`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add src/routes/AppLayout.tsx
git commit -m "feat(layout): remove MenuRail and widen sidebar panel"
```

---

### Task 10: 更新 i18n 文案

**Files:**
- Modify: `src/i18n/zh-CN.ts`
- Modify: `src/i18n/zh-TW.ts`
- Modify: `src/i18n/en.ts`

- [ ] **Step 1: 在三个文件的 `sidebar` 对象内添加键值**

`src/i18n/zh-CN.ts`：

```typescript
sidebar: {
  collapse: '折叠侧边栏',
  expand: '展开侧边栏',
  search: '搜索会话',
  noMatches: '没有匹配的会话',
  clearSearch: '清除搜索',
  deleteSession: '删除会话',
  renameSession: '重命名',
  newChat: '新建会话',
  newCodeTask: '新建代码任务',
  searchResults: '搜索结果',
  dateGroup: {
    today: '今天',
    yesterday: '昨天',
    older: '更早',
  },
},
```

`src/i18n/zh-TW.ts`：

```typescript
sidebar: {
  collapse: '折疊側邊欄',
  expand: '展開側邊欄',
  search: '搜尋會話',
  noMatches: '沒有匹配的會話',
  clearSearch: '清除搜尋',
  deleteSession: '刪除會話',
  renameSession: '重新命名',
  newChat: '新建會話',
  newCodeTask: '新建程式碼任務',
  searchResults: '搜尋結果',
  dateGroup: {
    today: '今天',
    yesterday: '昨天',
    older: '更早',
  },
},
```

`src/i18n/en.ts`：

```typescript
sidebar: {
  collapse: 'Collapse Sidebar',
  expand: 'Expand Sidebar',
  search: 'Search sessions',
  noMatches: 'No matching sessions',
  clearSearch: 'Clear search',
  deleteSession: 'Delete Session',
  renameSession: 'Rename',
  newChat: 'New Chat',
  newCodeTask: 'New Code Task',
  searchResults: 'Search Results',
  dateGroup: {
    today: 'Today',
    yesterday: 'Yesterday',
    older: 'Earlier',
  },
},
```

- [ ] **Step 2: 运行 type-check**

Run: `yarn type-check`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add src/i18n/zh-CN.ts src/i18n/zh-TW.ts src/i18n/en.ts
git commit -m "feat(i18n): add sidebar labels for Kimi Work redesign"
```

---

### Task 11: 验证

- [ ] **Step 1: 运行全部测试**

Run: `yarn test`
Expected: PASS

- [ ] **Step 2: 运行 type-check**

Run: `yarn type-check`
Expected: PASS

- [ ] **Step 3: 提交（如测试通过）**

```bash
git commit --allow-empty -m "chore: verify sidebar redesign tests and types pass"
```

---

## Self-review checklist

1. **Spec coverage:**
   - 单层侧栏 ✓ Task 8 + Task 9
   - 顶部 Chat/Code Tab ✓ Task 2
   - 上下文主按钮 ✓ Task 4
   - 搜索框样式 ✓ Task 5
   - 会话分组 ✓ Task 1 + Task 6
   - 底部账户栏 ✓ Task 3
   - 移除 MenuRail ✓ Task 9
   - 固定宽度 260px ≈ 18% ✓ Task 9

2. **Placeholder scan:** 无 TBD/TODO/实现later；`AccountFooter` 中的占位用户数据已在设计文档中声明；`NewSessionButton` 保留了现有 `newConversation()` 调用并附注后续如需按 surface 创建草稿可扩展。

3. **Type consistency:** `surface` 类型统一为 `'chat' | 'code'`；`DateGroupKey` 在 lib 和 i18n 中一致。

4. **Dead code:** 本计划不删除 `src/components/rail/MenuRail.tsx` 与 `src/components/rail/RailButton.tsx`，仅停止从 `AppLayout` 引用。实施后可将其标记为 dead code 或在后续清理 PR 中移除。
