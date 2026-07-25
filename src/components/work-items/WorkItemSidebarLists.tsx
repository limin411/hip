/**
 * Sidebar filters for work-item tracking: smart status filters only.
 * Rendered by AppSidebar when WORK_ITEM_TRACKING && sidebarSection === 'tasks'.
 *
 * User-defined lists were removed from the product IA; catalog still keeps
 * the system inbox list for on-disk compatibility.
 */
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useWorkItemStore } from '@/store/workItemStore'
import { SIDEBAR_ACTIVE_RAIL } from '@/components/layout/sidebarActiveRail'

/** Smart filter order (design IA). */
export const WORK_ITEM_SMART_FILTERS = [
  'all',
  'todo',
  'in_progress',
  'done',
  'archived',
] as const

export type WorkItemSmartFilterId = (typeof WORK_ITEM_SMART_FILTERS)[number]

export function WorkItemSidebarLists() {
  const { t } = useTranslation()
  const filterId = useWorkItemStore((s) => s.filterId)
  const setFilter = useWorkItemStore((s) => s.setFilter)

  return (
    <div data-testid="sidebar-work-items" className="flex flex-col gap-2">
      <ul
        className="m-0 list-none p-0"
        aria-label={t('workItems.filtersAria')}
        data-testid="sidebar-work-item-filters"
      >
        {WORK_ITEM_SMART_FILTERS.map((id) => {
          const active = filterId === id
          return (
            <li key={id}>
              <button
                type="button"
                data-testid={`sidebar-work-item-filter-${id}`}
                data-no-drag
                aria-current={active ? 'true' : undefined}
                onClick={() => setFilter(id)}
                className={cn(
                  'mb-0.5 flex w-full items-start gap-2 rounded-lg px-2.5 py-[var(--row-pad-y-session)] text-left transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
                  active ? SIDEBAR_ACTIVE_RAIL : 'hover:bg-state-hover',
                )}
              >
                <span
                  className={cn(
                    'mt-1.5 size-1.5 shrink-0 rounded-full',
                    active ? 'bg-accent' : 'bg-transparent',
                  )}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate text-body font-medium text-ink">
                  {t(`workItems.filters.${id}`)}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
