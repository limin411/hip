# SessionHistory 分页与场景筛选实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `SessionHistory` 页面增加前端内存分页与按 `surface`（办公/编码）筛选的能力，并抽出一个可复用的 `Pagination` UI 组件。

**Architecture:** 所有会话已一次性加载到 Zustand 内存，因此分页和筛选完全在 `SessionHistory` 组件内通过 `useMemo` 派生完成；新增 `src/components/ui/Pagination.tsx` 负责纯展示页码器，与业务解耦。

**Tech Stack:** React 18 + TypeScript, Tailwind CSS, Radix UI Tabs（已有 `src/components/ui/Tabs.tsx`）, lucide-react, vitest + @testing-library/react, i18next。

## Global Constraints

- 每页固定 20 条，不可切换。
- 筛选维度仅为 `surface`（`'chat'` 办公 / `'code'` 编码）。
- 分页与筛选均为前端内存实现，不修改 `session:list` 后端协议。
- 保留现有按标题/预览文本搜索能力。
- 搜索词或场景切换时，页码重置为 1。
- 新增 i18n key 必须同步更新 `zh-CN.ts`、`zh-TW.ts`、`en.ts`。

---

## File Structure

| 文件 | 职责 |
|------|------|
| `src/components/ui/Pagination.tsx` | 新增：通用页码器组件，接收 `currentPage` / `totalPages` / `onChange`，显示上一页/页码/下一页及省略号。 |
| `src/components/ui/Pagination.test.tsx` | 新增：`Pagination` 组件的单元测试。 |
| `src/components/history/SessionHistory.tsx` | 修改：增加 `surfaceFilter` 与 `page` 状态，组合搜索+场景过滤，切片当前页数据，渲染 Tabs 与分页器。 |
| `src/components/history/SessionHistory.test.tsx` | 修改：补充场景筛选、分页、组合过滤、页码重置、空状态测试。 |
| `src/i18n/zh-CN.ts` | 修改：在 `history` 命名空间下新增 6 个 key。 |
| `src/i18n/zh-TW.ts` | 修改：同上。 |
| `src/i18n/en.ts` | 修改：同上。 |

---

### Task 1: Pagination UI 组件

**Files:**
- Create: `src/components/ui/Pagination.tsx`
- Create: `src/components/ui/Pagination.test.tsx`

**Interfaces:**
- Consumes: 无（纯展示组件）。
- Produces: `Pagination` 组件，props 为：
  ```ts
  interface PaginationProps {
    currentPage: number
    totalPages: number
    onChange: (page: number) => void
    className?: string
    previousLabel?: string
    nextLabel?: string
  }
  ```

- [ ] **Step 1: 编写失败测试**

创建 `src/components/ui/Pagination.test.tsx`：

```tsx
// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Pagination } from './Pagination'

describe('Pagination', () => {
  it('renders page numbers', () => {
    render(<Pagination currentPage={1} totalPages={5} onChange={vi.fn()} />)
    for (let i = 1; i <= 5; i++) {
      expect(screen.getByText(String(i))).toBeInTheDocument()
    }
  })

  it('calls onChange when a page is clicked', () => {
    const onChange = vi.fn()
    render(<Pagination currentPage={1} totalPages={5} onChange={onChange} />)
    fireEvent.click(screen.getByText('3'))
    expect(onChange).toHaveBeenCalledWith(3)
  })

  it('disables previous button on the first page', () => {
    render(<Pagination currentPage={1} totalPages={5} onChange={vi.fn()} />)
    expect(screen.getByLabelText('Previous page')).toBeDisabled()
    expect(screen.getByLabelText('Next page')).not.toBeDisabled()
  })

  it('disables next button on the last page', () => {
    render(<Pagination currentPage={5} totalPages={5} onChange={vi.fn()} />)
    expect(screen.getByLabelText('Previous page')).not.toBeDisabled()
    expect(screen.getByLabelText('Next page')).toBeDisabled()
  })

  it('shows ellipsis for many pages', () => {
    render(<Pagination currentPage={5} totalPages={10} onChange={vi.fn()} />)
    expect(screen.getAllByText('…')).toHaveLength(2)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
yarn vitest run src/components/ui/Pagination.test.tsx
```

Expected: 失败，提示 `Pagination` 未定义或找不到模块。

- [ ] **Step 3: 实现 Pagination 组件**

创建 `src/components/ui/Pagination.tsx`：

```tsx
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'

export interface PaginationProps {
  currentPage: number
  totalPages: number
  onChange: (page: number) => void
  className?: string
  previousLabel?: string
  nextLabel?: string
}

function generatePageItems(current: number, total: number): (number | 'ellipsis')[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1)
  }
  if (current <= 4) {
    return [1, 2, 3, 4, 5, 'ellipsis', total]
  }
  if (current >= total - 3) {
    return [1, 'ellipsis', total - 4, total - 3, total - 2, total - 1, total]
  }
  return [1, 'ellipsis', current - 1, current, current + 1, 'ellipsis', total]
}

export function Pagination({
  currentPage,
  totalPages,
  onChange,
  className,
  previousLabel = 'Previous page',
  nextLabel = 'Next page',
}: PaginationProps) {
  const items = generatePageItems(currentPage, totalPages)

  return (
    <div className={cn('flex items-center gap-1', className)} role="navigation" aria-label="Pagination">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => onChange(currentPage - 1)}
        disabled={currentPage <= 1}
        aria-label={previousLabel}
      >
        <ChevronLeft size={16} />
      </Button>

      {items.map((item, index) =>
        item === 'ellipsis' ? (
          <span key={`ellipsis-${index}`} className="px-2 text-ink-tertiary">
            …
          </span>
        ) : (
          <Button
            key={item}
            variant={item === currentPage ? 'secondary' : 'ghost'}
            size="icon"
            onClick={() => onChange(item)}
            aria-label={`Page ${item}`}
            aria-current={item === currentPage ? 'page' : undefined}
          >
            {item}
          </Button>
        ),
      )}

      <Button
        variant="ghost"
        size="icon"
        onClick={() => onChange(currentPage + 1)}
        disabled={currentPage >= totalPages}
        aria-label={nextLabel}
      >
        <ChevronRight size={16} />
      </Button>
    </div>
  )
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
yarn vitest run src/components/ui/Pagination.test.tsx
```

Expected: 全部通过。

- [ ] **Step 5: 提交**

```bash
git add src/components/ui/Pagination.tsx src/components/ui/Pagination.test.tsx
git commit -m "feat(ui): add reusable Pagination component

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: SessionHistory 筛选与分页

**Files:**
- Modify: `src/components/history/SessionHistory.tsx`
- Modify: `src/components/history/SessionHistory.test.tsx`
- Modify: `src/i18n/zh-CN.ts`
- Modify: `src/i18n/zh-TW.ts`
- Modify: `src/i18n/en.ts`

**Interfaces:**
- Consumes: `Pagination`（来自 Task 1），`Tabs` / `TabsList` / `TabsTrigger`（已有）。
- Produces: `SessionHistory` 组件新增 `surfaceFilter` 和 `page` 状态，并渲染筛选 Tabs 与分页器。

- [ ] **Step 1: 更新失败测试**

将 `src/components/history/SessionHistory.test.tsx` 替换为以下内容：

```tsx
// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SessionHistory } from './SessionHistory'
import { sessionService } from '@/domain'

const mockSessions = Array.from({ length: 25 }, (_, i) => ({
  id: `s${i + 1}`,
  title: `Session ${i + 1}`,
  preview: `Preview ${i + 1}`,
  updatedAtMs: (25 - i) * 1000,
  config: { surface: i < 12 ? 'chat' : 'code' },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === 'history.pageInfo' && params) {
        return `Page ${params.page} of ${params.total}`
      }
      return key
    },
  }),
}))

vi.mock('@/domain', () => ({
  useSessions: () => mockSessions,
  sessionService: {
    selectSession: vi.fn(),
  },
}))

describe('SessionHistory', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders first page of sessions', () => {
    render(<SessionHistory />)
    expect(screen.getByText('Session 1')).toBeInTheDocument()
    expect(screen.getByText('Session 20')).toBeInTheDocument()
    expect(screen.queryByText('Session 21')).not.toBeInTheDocument()
  })

  it('filters sessions by search query', () => {
    render(<SessionHistory />)
    fireEvent.change(screen.getByPlaceholderText('history.searchPlaceholder'), {
      target: { value: 'Session 25' },
    })
    expect(screen.getByText('Session 25')).toBeInTheDocument()
    expect(screen.queryByText('Session 1')).not.toBeInTheDocument()
  })

  it('filters sessions by surface tab', () => {
    render(<SessionHistory />)
    fireEvent.click(screen.getByText('history.filterCode'))
    expect(screen.queryByText('Session 1')).not.toBeInTheDocument()
    expect(screen.getByText('Session 13')).toBeInTheDocument()
  })

  it('combines search and surface filter', () => {
    render(<SessionHistory />)
    fireEvent.click(screen.getByText('history.filterCode'))
    fireEvent.change(screen.getByPlaceholderText('history.searchPlaceholder'), {
      target: { value: 'Session 25' },
    })
    expect(screen.getByText('Session 25')).toBeInTheDocument()
    expect(screen.queryByText('Session 13')).not.toBeInTheDocument()
  })

  it('paginates to the next page', () => {
    render(<SessionHistory />)
    expect(screen.queryByText('Session 21')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('2'))
    expect(screen.getByText('Session 21')).toBeInTheDocument()
    expect(screen.queryByText('Session 1')).not.toBeInTheDocument()
  })

  it('resets to page 1 when filter changes', () => {
    render(<SessionHistory />)
    fireEvent.click(screen.getByText('2'))
    expect(screen.getByText('Session 21')).toBeInTheDocument()
    fireEvent.click(screen.getByText('history.filterCode'))
    expect(screen.queryByText('Session 21')).not.toBeInTheDocument()
    expect(screen.getByText('Session 13')).toBeInTheDocument()
  })

  it('opens session on click', () => {
    render(<SessionHistory />)
    fireEvent.click(screen.getByText('Session 5'))
    expect(sessionService.selectSession).toHaveBeenCalledWith('s5')
  })

  it('shows empty state when filtered results are empty', () => {
    render(<SessionHistory />)
    fireEvent.change(screen.getByPlaceholderText('history.searchPlaceholder'), {
      target: { value: 'nonexistent' },
    })
    expect(screen.getByText('history.empty')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
yarn vitest run src/components/history/SessionHistory.test.tsx
```

Expected: 失败，因为组件尚未引入 `Pagination` / `Tabs`，也没有 `surfaceFilter` / `page` 相关逻辑。

- [ ] **Step 3: 添加 i18n key**

在 `src/i18n/zh-CN.ts` 的 `history` 块中新增：

```ts
history: {
  title: '历史会话',
  searchPlaceholder: '搜索会话…',
  empty: '暂无历史会话',
  filterAll: '全部',
  filterChat: '办公',
  filterCode: '编码',
  previous: '上一页',
  next: '下一页',
  pageInfo: '第 {{page}} 页 / 共 {{total}} 页',
},
```

在 `src/i18n/zh-TW.ts` 的 `history` 块中新增：

```ts
history: {
  title: '歷史會話',
  searchPlaceholder: '搜尋會話…',
  empty: '暫無歷史會話',
  filterAll: '全部',
  filterChat: '辦公',
  filterCode: '編碼',
  previous: '上一頁',
  next: '下一頁',
  pageInfo: '第 {{page}} 頁 / 共 {{total}} 頁',
},
```

在 `src/i18n/en.ts` 的 `history` 块中新增：

```ts
history: {
  title: 'History',
  searchPlaceholder: 'Search conversations…',
  empty: 'No conversations yet',
  filterAll: 'All',
  filterChat: 'Work',
  filterCode: 'Coding',
  previous: 'Previous',
  next: 'Next',
  pageInfo: 'Page {{page}} of {{total}}',
},
```

- [ ] **Step 4: 修改 SessionHistory 组件**

将 `src/components/history/SessionHistory.tsx` 替换为：

```tsx
import { useState, useMemo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, MessageSquare, Code2 } from 'lucide-react'
import { useSessions, sessionService } from '@/domain'
import { surfaceOf } from '@/lib/sessions'
import { cn } from '@/lib/utils'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/Tabs'
import { Pagination } from '@/components/ui/Pagination'

const PAGE_SIZE = 20

type SurfaceFilter = 'all' | 'chat' | 'code'

export function SessionHistory() {
  const { t } = useTranslation()
  const sessions = useSessions()
  const [query, setQuery] = useState('')
  const [surfaceFilter, setSurfaceFilter] = useState<SurfaceFilter>('all')
  const [page, setPage] = useState(1)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = [...sessions].sort((a, b) => b.updatedAtMs - a.updatedAtMs)
    let result = list
    if (q) {
      result = result.filter(
        (s) => s.title.toLowerCase().includes(q) || s.preview.toLowerCase().includes(q),
      )
    }
    if (surfaceFilter !== 'all') {
      result = result.filter((s) => surfaceOf(s.config) === surfaceFilter)
    }
    return result
  }, [sessions, query, surfaceFilter])

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)),
    [filtered.length],
  )

  // If the underlying list shrinks (e.g. a session was deleted), clamp the page.
  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  const handleQueryChange = (value: string) => {
    setQuery(value)
    setPage(1)
  }

  const handleSurfaceChange = (value: SurfaceFilter) => {
    setSurfaceFilter(value)
    setPage(1)
  }

  const paged = useMemo(() => {
    const safePage = Math.min(page, totalPages)
    return filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  }, [filtered, page, totalPages])

  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-6 py-5" data-testid="session-history">
      <h2 className="mb-4 text-display font-semibold text-ink">{t('history.title')}</h2>
      <div className="relative mb-4 max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-tertiary" />
        <input
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder={t('history.searchPlaceholder')}
          className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-body text-ink placeholder:text-ink-tertiary focus:border-accent focus:outline-none"
        />
      </div>

      <Tabs
        value={surfaceFilter}
        onValueChange={(v) => handleSurfaceChange(v as SurfaceFilter)}
        className="mb-4"
      >
        <TabsList>
          <TabsTrigger value="all">{t('history.filterAll')}</TabsTrigger>
          <TabsTrigger value="chat">{t('history.filterChat')}</TabsTrigger>
          <TabsTrigger value="code">{t('history.filterCode')}</TabsTrigger>
        </TabsList>
      </Tabs>

      {filtered.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center text-ink-secondary">
          <span className="text-body">{t('history.empty')}</span>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {paged.map((session) => {
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
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <Pagination
                currentPage={page}
                totalPages={totalPages}
                onChange={setPage}
                previousLabel={t('history.previous')}
                nextLabel={t('history.next')}
              />
              <span className="text-caption text-ink-secondary">
                {t('history.pageInfo', { page, total: totalPages })}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 5: 运行测试确认通过**

```bash
yarn vitest run src/components/history/SessionHistory.test.tsx
```

Expected: 全部通过。

- [ ] **Step 6: 类型检查**

```bash
yarn tsc
```

Expected: 无类型错误。

- [ ] **Step 7: 提交**

```bash
git add src/components/history/SessionHistory.tsx \
        src/components/history/SessionHistory.test.tsx \
        src/i18n/zh-CN.ts \
        src/i18n/zh-TW.ts \
        src/i18n/en.ts
git commit -m "feat(history): add surface filter and pagination to SessionHistory

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- 前端分页：Task 2 通过 `useMemo` + `slice` 实现。
- 场景筛选：Task 2 通过 `surfaceFilter` + Tabs 实现。
- 每页 20 条：`PAGE_SIZE = 20` 常量。
- 页码重置：Task 2 的 `handleQueryChange` / `handleSurfaceChange` 在变更时调用 `setPage(1)`。
- 空状态：Task 2 保留现有 `history.empty` 渲染。
- i18n：Task 2 Step 3 更新三语文件。
- 测试：Task 1 / Task 2 均包含测试。

**Placeholder scan：** 无 TBD/TODO/含糊描述；所有步骤均含具体代码与命令。

**类型一致性：** `PaginationProps` 在 Task 1 中定义；`SessionHistory` 中按相同接口传入。`SurfaceFilter` 类型在组件内定义并与 `Tabs` value 对齐。

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-08-session-history-pagination-filter.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** - Execute tasks in this session using `executing-plans`, batch execution with checkpoints.

**Which approach?**
