import { useMemo } from 'react'
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
import { cn } from '@/lib/utils'
import { workItemOptionId } from './WorkItemRow'

function formatRange(start: string, end: string): string {
  if (start === end) return start
  return `${start} – ${end}`
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
  const complete = useWorkItemStore((s) => s.complete)
  const reopen = useWorkItemStore((s) => s.reopen)
  const colors = useWorkItemUiPrefsStore((s) => s.statusColors)
  const highlightId = useWorkItemViewStore((s) => s.highlightId)
  const requestEdit = useWorkItemViewStore((s) => s.requestEdit)
  const requestCreate = useWorkItemViewStore((s) => s.requestCreate)
  const today = useMemo(() => localTodayYmd(), [])

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

  return (
    <div
      className={cn(
        'flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-surface',
        className,
      )}
      data-testid="work-item-list-view"
    >
      <div className="flex items-center gap-2 border-b border-border bg-surface-subtle px-3 py-2">
        <span className="text-meta text-ink-secondary">
          {t('workItems.list.count', { count: items.length })}
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
        {items.map((item) => {
          const schedule = ensureScheduleDates(item, today)
          const hex = colorHexForItem(item, colors)
          const done = item.status === 'done'
          const cancelled = item.status === 'cancelled'
          const selected = highlightId === item.id
          const title = item.title.trim() || t('workItems.untitled')
          return (
            <li key={item.id} className="border-b border-border last:border-b-0">
              <div
                id={workItemOptionId(item.id)}
                role="option"
                aria-selected={selected}
                data-testid={`work-item-row-${item.id}`}
                data-selected={selected ? 'true' : undefined}
                className={cn(
                  'grid w-full cursor-pointer grid-cols-[14px_minmax(0,1fr)_auto_auto] items-center gap-2 px-3 py-2.5 text-left transition-colors',
                  selected ? 'bg-state-active' : 'hover:bg-state-hover',
                )}
                onClick={() => requestEdit(item.id)}
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
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
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
                </div>
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
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
