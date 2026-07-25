import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'
import {
  filterItems,
  localTodayYmd,
  sortWorkItems,
  type WorkItem,
} from '@/domain/work-items'
import { useWorkItemStore } from '@/store/workItemStore'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { WorkItemRow, workItemOptionId } from './WorkItemRow'

export interface WorkItemListPaneProps {
  searchInputRef?: React.RefObject<HTMLInputElement | null>
  onRequestTitleFocus?: () => void
  className?: string
}

function filterLabelKey(filterId: string): string {
  if (filterId.startsWith('list:')) return 'workItems.listFilter'
  switch (filterId) {
    case 'open':
    case 'today':
    case 'overdue':
    case 'in_progress':
    case 'done':
    case 'cancelled':
    case 'archived':
      return `workItems.filters.${filterId}`
    default:
      return 'workItems.filters.open'
  }
}

export function WorkItemListPane({
  searchInputRef,
  onRequestTitleFocus,
  className,
}: WorkItemListPaneProps) {
  const { t } = useTranslation()
  const items = useWorkItemStore((s) => s.items)
  const filterId = useWorkItemStore((s) => s.filterId)
  const search = useWorkItemStore((s) => s.search)
  const selectedId = useWorkItemStore((s) => s.selectedId)
  const setSearch = useWorkItemStore((s) => s.setSearch)
  const setFilter = useWorkItemStore((s) => s.setFilter)
  const select = useWorkItemStore((s) => s.select)
  const complete = useWorkItemStore((s) => s.complete)
  const reopen = useWorkItemStore((s) => s.reopen)
  const createItem = useWorkItemStore((s) => s.createItem)
  const localSearchRef = useRef<HTMLInputElement>(null)
  const inputRef = searchInputRef ?? localSearchRef

  const today = useMemo(() => localTodayYmd(), [])
  const visible = useMemo(
    () => sortWorkItems(filterItems(items, filterId, today, search)),
    [items, filterId, today, search],
  )

  const catalogEmpty = items.length === 0
  const filterEmpty = !catalogEmpty && visible.length === 0

  const chipLabel = filterId.startsWith('list:')
    ? t('workItems.listFilter')
    : t(filterLabelKey(filterId) as 'workItems.filters.open')

  const handleCreate = async () => {
    await createItem()
    onRequestTitleFocus?.()
  }

  const toggleComplete = (item: WorkItem) => {
    if (item.status === 'done') void reopen(item.id)
    else void complete(item.id)
  }

  // Keep the active option in view for j/k and keyboard selection.
  useEffect(() => {
    if (!selectedId) return
    const el = document.getElementById(workItemOptionId(selectedId))
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedId, visible])

  const activeDescendant =
    selectedId && visible.some((i) => i.id === selectedId)
      ? workItemOptionId(selectedId)
      : undefined

  return (
    <div className={className} data-testid="work-item-list-pane">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-tertiary"
            strokeWidth={1.75}
          />
          <Input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            data-testid="work-item-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('workItems.searchPlaceholder')}
            className="h-8 pl-8 text-body"
            aria-label={t('workItems.searchPlaceholder')}
          />
        </div>
        <span
          data-testid="work-item-filter-chip"
          className="shrink-0 rounded-full border border-border bg-surface-muted px-2 py-0.5 text-meta text-ink-secondary"
        >
          {chipLabel}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
        {catalogEmpty ? (
          <EmptyState
            tier="professional"
            title={t('workItems.emptyTitle')}
            description={t('workItems.emptyHint')}
            action={{ label: t('workItems.newItem'), onClick: () => void handleCreate() }}
            className="py-10"
            data-testid="work-item-empty-catalog"
          />
        ) : filterEmpty ? (
          <EmptyState
            tier="professional"
            title={t('workItems.emptyFilterTitle')}
            description={t('workItems.emptyFilterHint')}
            action={{
              label: t('workItems.viewOpen'),
              onClick: () => setFilter('open'),
            }}
            className="py-10"
            data-testid="work-item-empty-filter"
          />
        ) : (
          <div
            role="listbox"
            aria-label={t('workItems.title')}
            aria-activedescendant={activeDescendant}
            data-testid="work-item-listbox"
            className="flex flex-col gap-0.5"
          >
            {visible.map((item) => (
              <WorkItemRow
                key={item.id}
                item={item}
                selected={item.id === selectedId}
                onSelect={() => select(item.id)}
                onToggleComplete={() => toggleComplete(item)}
              />
            ))}
          </div>
        )}
      </div>

      {!catalogEmpty ? (
        <div className="shrink-0 border-t border-border px-3 py-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            data-testid="work-item-new-in-list"
            onClick={() => void handleCreate()}
          >
            {t('workItems.newItem')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
