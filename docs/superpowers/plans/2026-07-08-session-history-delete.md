# SessionHistory 删除与清空实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在「历史会话」页面为每条会话增加删除按钮，并在标题旁增加「清空全部」按钮；两者均需二次确认。

**Architecture:** 复用现有 `sessionService.deleteSession(id)` 完成本地 store 清理与 sidecar 通知；前端新增两个确认弹窗组件，`SessionHistory` 负责状态管理与组合渲染。

**Tech Stack:** React 18 + TypeScript, Tailwind CSS, lucide-react, Radix UI Dialog（已有 `src/components/ui/Modal.tsx`）, vitest + @testing-library/react, i18next。

## Global Constraints

- 复用 `sessionService.deleteSession(id)`，不新增后端协议。
- 「清空全部」删除所有历史会话，不受当前搜索/筛选影响。
- 二次确认使用普通确认弹窗，不要求输入文字。
- 新增 i18n key 必须同步更新 `zh-CN.ts`、`zh-TW.ts`、`en.ts`。
- 当前激活/打开的会话允许被删除，行为由 `sessionService.deleteSession` 自动处理。

---

## File Structure

| 文件 | 职责 |
|------|------|
| `src/components/history/DeleteSessionDialog.tsx` | 新增：单条会话删除确认弹窗，接收 `title` / `onConfirm` / `onCancel`。 |
| `src/components/history/DeleteSessionDialog.test.tsx` | 新增：验证渲染与确认/取消回调。 |
| `src/components/history/ClearAllSessionsDialog.tsx` | 新增：清空全部确认弹窗，接收 `onConfirm` / `onCancel`。 |
| `src/components/history/ClearAllSessionsDialog.test.tsx` | 新增：验证渲染与确认/取消回调。 |
| `src/components/history/SessionHistory.tsx` | 修改：引入 `Trash2`、两个弹窗、`Button`；增加删除状态；调整行结构以支持独立删除按钮；标题旁增加「清空全部」按钮。 |
| `src/components/history/SessionHistory.test.tsx` | 修改：mock `sessionService.deleteSession`；补充单条删除、清空全部、确认/取消、空状态隐藏按钮等测试。 |
| `src/i18n/zh-CN.ts` | 修改：在 `history` 命名空间下新增 8 个 key。 |
| `src/i18n/zh-TW.ts` | 修改：同上。 |
| `src/i18n/en.ts` | 修改：同上。 |

---

### Task 1: 添加国际化 key

**Files:**
- Modify: `src/i18n/zh-CN.ts`
- Modify: `src/i18n/zh-TW.ts`
- Modify: `src/i18n/en.ts`

**Interfaces:**
- Consumes: 无。
- Produces: 新增 i18n key 供后续组件与测试使用。

- [ ] **Step 1: 修改 `src/i18n/zh-CN.ts`**

在 `history` 命名空间内新增：

```ts
history: {
  // ... 现有 key 不变
  delete: '删除',
  deleteSession: '删除会话',
  deleteSessionConfirmTitle: '删除会话「{{title}}」？',
  deleteSessionConfirmBody: '此操作无法撤销。',
  clearAll: '清空全部',
  clearAllConfirmTitle: '清空全部历史会话？',
  clearAllConfirmBody: '这将永久删除所有历史会话，此操作无法撤销。',
  clearAllConfirmAction: '清空',
},
```

- [ ] **Step 2: 修改 `src/i18n/zh-TW.ts`**

```ts
history: {
  // ... 现有 key 不变
  delete: '刪除',
  deleteSession: '刪除會話',
  deleteSessionConfirmTitle: '刪除會話「{{title}}」？',
  deleteSessionConfirmBody: '此操作無法復原。',
  clearAll: '清空全部',
  clearAllConfirmTitle: '清空全部歷史會話？',
  clearAllConfirmBody: '這將永久刪除所有歷史會話，此操作無法復原。',
  clearAllConfirmAction: '清空',
},
```

- [ ] **Step 3: 修改 `src/i18n/en.ts`**

```ts
history: {
  // ... 现有 key 不变
  delete: 'Delete',
  deleteSession: 'Delete conversation',
  deleteSessionConfirmTitle: 'Delete conversation "{{title}}"?',
  deleteSessionConfirmBody: 'This action cannot be undone.',
  clearAll: 'Clear all',
  clearAllConfirmTitle: 'Clear all conversations?',
  clearAllConfirmBody: 'This will permanently delete all conversations. This action cannot be undone.',
  clearAllConfirmAction: 'Clear all',
},
```

- [ ] **Step 4: 运行类型检查**

Run: `yarn tsc --noEmit`
Expected: 无新增类型错误。

- [ ] **Step 5: 提交**

```bash
git add src/i18n/zh-CN.ts src/i18n/zh-TW.ts src/i18n/en.ts
git commit -m "i18n: add delete and clear-all keys for history page

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: 创建单条删除确认弹窗

**Files:**
- Create: `src/components/history/DeleteSessionDialog.tsx`
- Create: `src/components/history/DeleteSessionDialog.test.tsx`

**Interfaces:**
- Consumes: 已有 `Modal`、`Button` 组件；Task 1 添加的 i18n key。
- Produces:
  ```ts
  interface DeleteSessionDialogProps {
    title: string
    onConfirm: () => void
    onCancel: () => void
  }
  export function DeleteSessionDialog(props: DeleteSessionDialogProps)
  ```

- [ ] **Step 1: 编写失败测试**

创建 `src/components/history/DeleteSessionDialog.test.tsx`：

```tsx
// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DeleteSessionDialog } from './DeleteSessionDialog'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (params) return `${key}:${JSON.stringify(params)}`
      return key
    },
  }),
}))

describe('DeleteSessionDialog', () => {
  it('renders title and body', () => {
    render(<DeleteSessionDialog title="Session A" onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByText('history.deleteSessionConfirmTitle:{"title":"Session A"}')).toBeInTheDocument()
    expect(screen.getByText('history.deleteSessionConfirmBody')).toBeInTheDocument()
  })

  it('calls onConfirm when delete button is clicked', () => {
    const onConfirm = vi.fn()
    render(<DeleteSessionDialog title="Session A" onConfirm={onConfirm} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByText('history.delete'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('calls onCancel when cancel button is clicked', () => {
    const onCancel = vi.fn()
    render(<DeleteSessionDialog title="Session A" onConfirm={vi.fn()} onCancel={onCancel} />)
    fireEvent.click(screen.getByText('common.cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `yarn vitest run src/components/history/DeleteSessionDialog.test.tsx`
Expected: FAIL — `DeleteSessionDialog` 未定义。

- [ ] **Step 3: 实现组件**

创建 `src/components/history/DeleteSessionDialog.tsx`：

```tsx
import { useTranslation } from 'react-i18next'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'

export interface DeleteSessionDialogProps {
  title: string
  onConfirm: () => void
  onCancel: () => void
}

export function DeleteSessionDialog({ title, onConfirm, onCancel }: DeleteSessionDialogProps) {
  const { t } = useTranslation()
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
      title={t('history.deleteSessionConfirmTitle', { title })}
      className="max-w-sm"
    >
      <div className="p-5">
        <p className="text-body text-ink-secondary">{t('history.deleteSessionConfirmBody')}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" size="sm" onClick={onConfirm}>
            {t('history.delete')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `yarn vitest run src/components/history/DeleteSessionDialog.test.tsx`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/components/history/DeleteSessionDialog.tsx src/components/history/DeleteSessionDialog.test.tsx
git commit -m "feat(history): add DeleteSessionDialog component

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: 创建清空全部确认弹窗

**Files:**
- Create: `src/components/history/ClearAllSessionsDialog.tsx`
- Create: `src/components/history/ClearAllSessionsDialog.test.tsx`

**Interfaces:**
- Consumes: 已有 `Modal`、`Button` 组件；Task 1 添加的 i18n key。
- Produces:
  ```ts
  interface ClearAllSessionsDialogProps {
    onConfirm: () => void
    onCancel: () => void
  }
  export function ClearAllSessionsDialog(props: ClearAllSessionsDialogProps)
  ```

- [ ] **Step 1: 编写失败测试**

创建 `src/components/history/ClearAllSessionsDialog.test.tsx`：

```tsx
// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ClearAllSessionsDialog } from './ClearAllSessionsDialog'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (params) return `${key}:${JSON.stringify(params)}`
      return key
    },
  }),
}))

describe('ClearAllSessionsDialog', () => {
  it('renders title and body', () => {
    render(<ClearAllSessionsDialog onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByText('history.clearAllConfirmTitle')).toBeInTheDocument()
    expect(screen.getByText('history.clearAllConfirmBody')).toBeInTheDocument()
  })

  it('calls onConfirm when clear button is clicked', () => {
    const onConfirm = vi.fn()
    render(<ClearAllSessionsDialog onConfirm={onConfirm} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByText('history.clearAllConfirmAction'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('calls onCancel when cancel button is clicked', () => {
    const onCancel = vi.fn()
    render(<ClearAllSessionsDialog onConfirm={vi.fn()} onCancel={onCancel} />)
    fireEvent.click(screen.getByText('common.cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `yarn vitest run src/components/history/ClearAllSessionsDialog.test.tsx`
Expected: FAIL — `ClearAllSessionsDialog` 未定义。

- [ ] **Step 3: 实现组件**

创建 `src/components/history/ClearAllSessionsDialog.tsx`：

```tsx
import { useTranslation } from 'react-i18next'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'

export interface ClearAllSessionsDialogProps {
  onConfirm: () => void
  onCancel: () => void
}

export function ClearAllSessionsDialog({ onConfirm, onCancel }: ClearAllSessionsDialogProps) {
  const { t } = useTranslation()
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
      title={t('history.clearAllConfirmTitle')}
      className="max-w-sm"
    >
      <div className="p-5">
        <p className="text-body text-ink-secondary">{t('history.clearAllConfirmBody')}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" size="sm" onClick={onConfirm}>
            {t('history.clearAllConfirmAction')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `yarn vitest run src/components/history/ClearAllSessionsDialog.test.tsx`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/components/history/ClearAllSessionsDialog.tsx src/components/history/ClearAllSessionsDialog.test.tsx
git commit -m "feat(history): add ClearAllSessionsDialog component

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: 集成到 SessionHistory

**Files:**
- Modify: `src/components/history/SessionHistory.tsx`
- Modify: `src/components/history/SessionHistory.test.tsx`

**Interfaces:**
- Consumes: `DeleteSessionDialog`、`ClearAllSessionsDialog`、Task 1 的 i18n key、已有 `sessionService.deleteSession`。
- Produces: `SessionHistory` 组件新增删除与清空交互。

- [ ] **Step 1: 编写失败测试**

修改 `src/components/history/SessionHistory.test.tsx`：

1. 更新 `sessionService` mock，增加 `deleteSession`：

```ts
vi.mock('@/domain', () => ({
  useSessions: () => mockSessions,
  sessionService: {
    selectSession: vi.fn(),
    deleteSession: vi.fn(),
  },
}))
```

2. 更新 `react-i18next` mock以支持参数插值：

```ts
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === 'history.pageInfo' && params) {
        return `Page ${params.page} of ${params.total}`
      }
      if (params) return `${key}:${JSON.stringify(params)}`
      return key
    },
  }),
}))
```

3. 在 `describe` 内新增测试：

```ts
  it('renders a delete button for each session', () => {
    render(<SessionHistory />)
    expect(screen.getAllByLabelText('history.deleteSession')).toHaveLength(mockSessions.length)
  })

  it('renders clear-all button when sessions exist', () => {
    render(<SessionHistory />)
    expect(screen.getByText('history.clearAll')).toBeInTheDocument()
  })

  it('hides clear-all button when there are no sessions', () => {
    mockSessions = []
    render(<SessionHistory />)
    expect(screen.queryByText('history.clearAll')).not.toBeInTheDocument()
  })

  it('deletes a session after confirming in dialog', () => {
    render(<SessionHistory />)
    fireEvent.click(screen.getAllByLabelText('history.deleteSession')[4])
    expect(screen.getByText('history.deleteSessionConfirmTitle:{"title":"Session 5"}')).toBeInTheDocument()
    fireEvent.click(screen.getByText('history.delete'))
    expect(sessionService.deleteSession).toHaveBeenCalledWith('s5')
  })

  it('does not delete a session when dialog is cancelled', () => {
    render(<SessionHistory />)
    fireEvent.click(screen.getAllByLabelText('history.deleteSession')[4])
    fireEvent.click(screen.getByText('common.cancel'))
    expect(sessionService.deleteSession).not.toHaveBeenCalled()
  })

  it('clears all sessions after confirming in dialog', () => {
    render(<SessionHistory />)
    fireEvent.click(screen.getByText('history.clearAll'))
    expect(screen.getByText('history.clearAllConfirmTitle')).toBeInTheDocument()
    fireEvent.click(screen.getByText('history.clearAllConfirmAction'))
    expect(sessionService.deleteSession).toHaveBeenCalledTimes(mockSessions.length)
    mockSessions.forEach((s) => {
      expect(sessionService.deleteSession).toHaveBeenCalledWith(s.id)
    })
  })

  it('does not clear sessions when clear-all dialog is cancelled', () => {
    render(<SessionHistory />)
    fireEvent.click(screen.getByText('history.clearAll'))
    fireEvent.click(screen.getByText('common.cancel'))
    expect(sessionService.deleteSession).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: 运行测试确认失败**

Run: `yarn vitest run src/components/history/SessionHistory.test.tsx`
Expected: FAIL — 新增测试因缺少删除按钮/清空按钮/弹窗而失败。

- [ ] **Step 3: 实现 SessionHistory 改动**

修改 `src/components/history/SessionHistory.tsx`：

1. 更新 imports：

```tsx
import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, MessageSquare, Code2, Trash2 } from 'lucide-react'
import { useSessions, sessionService } from '@/domain'
import { surfaceOf } from '@/lib/sessions'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/Tabs'
import { Pagination } from '@/components/ui/Pagination'
import { DeleteSessionDialog } from './DeleteSessionDialog'
import { ClearAllSessionsDialog } from './ClearAllSessionsDialog'
```

2. 在组件内新增状态：

```tsx
export function SessionHistory() {
  const { t } = useTranslation()
  const sessions = useSessions()
  const [query, setQuery] = useState('')
  const [surfaceFilter, setSurfaceFilter] = useState<SurfaceFilter>('all')
  const [page, setPage] = useState(1)
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null)
  const [clearAllOpen, setClearAllOpen] = useState(false)

  // ... 现有派生计算不变

  const deletingSession = useMemo(
    () => sessions.find((s) => s.id === deletingSessionId) ?? null,
    [sessions, deletingSessionId],
  )
```

3. 替换标题区，增加「清空全部」按钮：

```tsx
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-display font-semibold text-ink">{t('history.title')}</h2>
        {sessions.length > 0 && (
          <Button variant="danger" size="sm" onClick={() => setClearAllOpen(true)}>
            {t('history.clearAll')}
          </Button>
        )}
      </div>
```

4. 替换会话行结构，增加删除按钮：

```tsx
            <div
              key={session.id}
              className="flex items-center justify-between rounded-lg border border-border bg-surface p-3 text-left transition-colors hover:border-accent"
            >
              <button
                type="button"
                onClick={() => sessionService.selectSession(session.id)}
                className="flex min-w-0 flex-1 items-center justify-between text-left"
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
              <Button
                variant="ghost"
                size="icon"
                className="ml-2 shrink-0 text-ink-secondary hover:text-accent"
                title={t('history.deleteSession')}
                aria-label={t('history.deleteSession')}
                onClick={() => setDeletingSessionId(session.id)}
              >
                <Trash2 size={16} />
              </Button>
            </div>
```

5. 在 `return` 末尾、最外层 `div` 内增加弹窗：

```tsx
      {deletingSession && (
        <DeleteSessionDialog
          title={deletingSession.title}
          onConfirm={() => {
            sessionService.deleteSession(deletingSession.id)
            setDeletingSessionId(null)
          }}
          onCancel={() => setDeletingSessionId(null)}
        />
      )}
      {clearAllOpen && (
        <ClearAllSessionsDialog
          onConfirm={() => {
            sessions.forEach((s) => sessionService.deleteSession(s.id))
            setClearAllOpen(false)
          }}
          onCancel={() => setClearAllOpen(false)}
        />
      )}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `yarn vitest run src/components/history/SessionHistory.test.tsx`
Expected: PASS。

- [ ] **Step 5: 运行全量前端类型检查与相关测试**

Run: `yarn tsc --noEmit`
Expected: 无类型错误。

Run: `yarn vitest run src/components/history`
Expected: PASS（包含本计划新增与修改的所有测试）。

- [ ] **Step 6: 提交**

```bash
git add src/components/history/SessionHistory.tsx src/components/history/SessionHistory.test.tsx
git commit -m "feat(history): integrate per-session delete and clear-all into SessionHistory

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review Checklist

- [ ] Spec coverage：单条删除、清空全部、二次确认、i18n、测试均有对应任务。
- [ ] Placeholder scan：无 TBD/TODO，每步含实际代码与命令。
- [ ] Type consistency：`DeleteSessionDialogProps` / `ClearAllSessionsDialogProps` 在组件与测试中一致。
- [ ] 文件清单完整：覆盖新增弹窗、测试、集成、i18n 三文件。

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-08-session-history-delete.md`.

Two execution options:

1. **Subagent-Driven (recommended)** - Dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

Which approach?
