import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import {
  colorHexForItem,
  ensureScheduleDates,
  localTodayYmd,
  type WorkItem,
} from '@/domain/work-items'
import { useWorkItemStore } from '@/store/workItemStore'
import { useWorkItemUiPrefsStore } from '@/store/workItemUiPrefsStore'
import { useWorkItemViewStore } from '@/store/workItemViewStore'
import { EmptyState } from '@/components/ui/EmptyState'
import { Pagination } from '@/components/ui/Pagination'
import { DeclarativeContextMenu } from '@/components/context-menu'
import { cn } from '@/lib/utils'
import { workItemOptionId } from './WorkItemRow'

/** Rows per page in list mode — caps DOM nodes when catalogs grow large. */
export const WORK_ITEM_LIST_PAGE_SIZE = 30

export function paginateWorkItems<T>(
  items: readonly T[],
  page: number,
  pageSize = WORK_ITEM_LIST_PAGE_SIZE,
): T[] {
  const safePage = Math.max(1, page)
  const start = (safePage - 1) * pageSize
  return items.slice(start, start + pageSize) as T[]
}

export function workItemListTotalPages(
  count: number,
  pageSize = WORK_ITEM_LIST_PAGE_SIZE,
): number {
  return Math.max(1, Math.ceil(count / pageSize))
}

function formatRange(start: string, end: string): string {
  if (start === end) return start
  return `${start} – ${end}`
}

function priorityMetaClass(priority: WorkItem['priority']): string {
  switch (priority) {
    case 'high':
      return 'text-danger'
    case 'medium':
      return 'text-warning'
    case 'low':
      return 'text-ink-secondary'
    default:
      return 'text-ink-tertiary'
  }
}

export function WorkItemListView({
  items,
  className,
}: {
  items: readonly WorkItem[]
  className?: string
}) {
  const { t } = useTranslation()
  const search = useWorkItemStore((s) => s.search)
  const setSearch = useWorkItemStore((s) => s.setSearch)
  const filterId = useWorkItemStore((s) => s.filterId)
  const complete = useWorkItemStore((s) => s.complete)
  const reopen = useWorkItemStore((s) => s.reopen)
  const colors = useWorkItemUiPrefsStore((s) => s.statusColors)
  const highlightId = useWorkItemViewStore((s) => s.highlightId)
  const listPage = useWorkItemViewStore((s) => s.listPage)
  const setListPage = useWorkItemViewStore((s) => s.setListPage)
  const setHighlightId = useWorkItemViewStore((s) => s.setHighlightId)
  const requestEdit = useWorkItemViewStore((s) => s.requestEdit)
  const requestCreate = useWorkItemViewStore((s) => s.requestCreate)
  const today = useMemo(() => localTodayYmd(), [])

  const totalPages = workItemListTotalPages(items.length)
  const safePage = Math.min(listPage, totalPages)
  const pagedItems = useMemo(
    () => paginateWorkItems(items, safePage),
    [items, safePage],
  )

  // Filter / search changes: first page (and drop stale keyboard highlight).
  useEffect(() => {
    setListPage(1)
    setHighlightId(null)
  }, [filterId, search, setListPage, setHighlightId])

  // Clamp when the filtered set shrinks below the current page.
  useEffect(() => {
    if (listPage > totalPages) setListPage(totalPages)
  }, [listPage, totalPages, setListPage])

  // Keyboard highlight may land off-page; follow it.
  useEffect(() => {
    if (!highlightId) return
    const idx = items.findIndex((i) => i.id === highlightId)
    if (idx < 0) return
    const target = Math.floor(idx / WORK_ITEM_LIST_PAGE_SIZE) + 1
    if (target !== listPage) setListPage(target)
  }, [highlightId, items, listPage, setListPage])

  if (items.length === 0) {
    return (
      <div
        className={cn('flex min-h-0 flex-1 flex-col', className)}
        data-testid="work-item-list-view"
      >
        <EmptyState
          tier="professional"
          title={
            search.trim()
              ? t('workItems.emptyFilterTitle')
              : t('workItems.emptyTitle')
          }
          description={
            search.trim()
              ? t('workItems.emptyFilterHint')
              : t('workItems.emptyHint')
          }
          className="flex-1"
          action={{
            label: t('workItems.newItem'),
            onClick: () => requestCreate(),
          }}
        />
      </div>
    )
  }

  const rangeStart = (safePage - 1) * WORK_ITEM_LIST_PAGE_SIZE + 1
  const rangeEnd = Math.min(items.length, safePage * WORK_ITEM_LIST_PAGE_SIZE)

  return (
    <div
      className={cn(
        'flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-surface',
        className,
      )}
      data-testid="work-item-list-view"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-subtle px-3 py-2">
        <span className="text-meta text-ink-secondary" data-testid="work-item-list-count">
          {t('workItems.list.count', { count: items.length })}
          {totalPages > 1
            ? ` · ${t('workItems.list.range', { start: rangeStart, end: rangeEnd })}`
            : null}
        </span>
        <input
          type="search"
          data-testid="work-item-search"
          className="ml-auto h-7 w-48 max-w-[40vw] rounded-md border border-border bg-surface px-2 text-body text-ink placeholder:text-ink-tertiary"
          placeholder={t('workItems.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <ul
        className="m-0 min-h-0 flex-1 list-none overflow-y-auto p-0"
        role="listbox"
        aria-label={t('workItems.title')}
        data-testid="work-item-list"
      >
        {pagedItems.map((item) => {
          const schedule = ensureScheduleDates(item, today)
          const hex = colorHexForItem(item, colors)
          const done = item.status === 'done'
          const cancelled = item.status === 'cancelled'
          const selected = highlightId === item.id
          const title = item.title.trim() || t('workItems.untitled')
          const tags = item.tags
          return (
            <li key={item.id} className="border-b border-border last:border-b-0">
              <div
                id={workItemOptionId(item.id)}
                role="option"
                aria-selected={selected}
                data-testid={`work-item-row-${item.id}`}
                data-selected={selected ? 'true' : undefined}
                className={cn(selected ? 'bg-state-active' : 'hover:bg-state-hover')}
                onClick={() => requestEdit(item.id)}
              >
                <DeclarativeContextMenu
                  kind="workItem"
                  payload={{
                    itemId: item.id,
                    title,
                    status: item.status,
                    archived: item.archivedAt != null,
                    links: item.links ?? {},
                  }}
                  className="grid w-full cursor-pointer grid-cols-[14px_minmax(0,1fr)_auto_auto_auto_auto] items-center gap-2 px-3 py-2.5 text-left transition-colors"
                >
                  <button
                    type="button"
                    data-testid={`work-item-complete-${item.id}`}
                    aria-label={
                      done ? t('workItems.actions.reopen') : t('workItems.actions.complete')
                    }
                    aria-pressed={done}
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                      done
                        ? 'border-success bg-success text-on-accent'
                        : 'border-border bg-surface text-transparent hover:border-ink-tertiary',
                    )}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (done) void reopen(item.id)
                      else void complete(item.id)
                    }}
                  >
                    <Check className="h-3 w-3" strokeWidth={2.5} />
                  </button>
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: hex }}
                      aria-hidden
                    />
                    <span
                      className={cn(
                        'truncate text-body text-ink',
                        (done || cancelled) && 'text-ink-tertiary line-through',
                      )}
                    >
                      {title}
                    </span>
                  </div>
                  <div
                    className="flex max-w-[14rem] items-center justify-end gap-1"
                    data-testid={`work-item-row-tags-${item.id}`}
                  >
                    {tags.map((tag) => (
                      <span
                        key={tag}
                        className="max-w-[5.5rem] truncate rounded-full bg-surface-muted px-2 py-0.5 text-caption text-ink-secondary"
                        title={tag}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                  <span
                    data-testid={`work-item-priority-${item.id}`}
                    className={cn(
                      'min-w-[2rem] text-right text-caption font-medium',
                      item.priority === 'none'
                        ? 'text-ink-tertiary'
                        : priorityMetaClass(item.priority),
                    )}
                  >
                    {item.priority === 'none'
                      ? ''
                      : t(`workItems.priority.${item.priority}`)}
                  </span>
                  <span
                    className="rounded-full px-2 py-0.5 text-caption font-medium"
                    style={{
                      background: `color-mix(in srgb, ${hex} 16%, white)`,
                      color: `color-mix(in srgb, ${hex} 70%, #0f172a)`,
                    }}
                  >
                    {item.archivedAt != null
                      ? t('workItems.filters.archived')
                      : t(`workItems.status.${item.status}`)}
                  </span>
                  <span className="text-meta tabular-nums text-ink-secondary">
                    {formatRange(schedule.startOn, schedule.endOn)}
                  </span>
                </DeclarativeContextMenu>
              </div>
            </li>
          )
        })}
      </ul>
      {totalPages > 1 ? (
        <div
          className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border bg-surface-subtle px-3 py-2"
          data-testid="work-item-list-pagination"
        >
          <span className="text-caption text-ink-secondary">
            {t('workItems.list.pageInfo', { page: safePage, total: totalPages })}
          </span>
          <Pagination
            currentPage={safePage}
            totalPages={totalPages}
            onChange={(page) => {
              setHighlightId(null)
              setListPage(page)
            }}
            previousLabel={t('workItems.list.previous')}
            nextLabel={t('workItems.list.next')}
          />
        </div>
      ) : null}
    </div>
  )
}
