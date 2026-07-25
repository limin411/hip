/**
 * Sidebar filters for work-item tracking: smart status filters only.
 * Rendered by AppSidebar when WORK_ITEM_TRACKING && sidebarSection === 'tasks'.
 *
 * Color dots + optional recolor (status keys only; 全部 has multi-color / no recolor).
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pencil } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  DEFAULT_STATUS_COLORS,
  type WorkItemStatusColorKey,
} from '@/domain/work-items'
import { useWorkItemStore } from '@/store/workItemStore'
import { useWorkItemUiPrefsStore } from '@/store/workItemUiPrefsStore'
import { SIDEBAR_ACTIVE_RAIL } from '@/components/layout/sidebarActiveRail'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/Popover'

/** Smart filter order (design IA). */
export const WORK_ITEM_SMART_FILTERS = [
  'all',
  'todo',
  'in_progress',
  'done',
  'archived',
] as const

export type WorkItemSmartFilterId = (typeof WORK_ITEM_SMART_FILTERS)[number]

const SWATCHES = [
  '#3b82f6',
  '#0ea5e9',
  '#14b8a6',
  '#22c55e',
  '#eab308',
  '#f59e0b',
  '#f97316',
  '#ef4444',
  '#ec4899',
  '#a855f7',
  '#6366f1',
  '#94a3b8',
]

function filterColorKey(id: WorkItemSmartFilterId): WorkItemStatusColorKey | null {
  if (id === 'all') return null
  return id
}

export function WorkItemSidebarLists() {
  const { t } = useTranslation()
  const filterId = useWorkItemStore((s) => s.filterId)
  const setFilter = useWorkItemStore((s) => s.setFilter)
  const colors = useWorkItemUiPrefsStore((s) => s.statusColors)
  const setStatusColor = useWorkItemUiPrefsStore((s) => s.setStatusColor)
  const loadPrefs = useWorkItemUiPrefsStore((s) => s.load)
  const [recolorFor, setRecolorFor] = useState<WorkItemStatusColorKey | null>(null)

  useEffect(() => {
    void loadPrefs()
  }, [loadPrefs])

  return (
    <div data-testid="sidebar-work-items" className="flex flex-col gap-2">
      <ul
        className="m-0 list-none p-0"
        aria-label={t('workItems.filtersAria')}
        data-testid="sidebar-work-item-filters"
      >
        {WORK_ITEM_SMART_FILTERS.map((id) => {
          const active = filterId === id
          const colorKey = filterColorKey(id)
          return (
            <li key={id} className="group relative">
              <button
                type="button"
                data-testid={`sidebar-work-item-filter-${id}`}
                data-no-drag
                aria-current={active ? 'true' : undefined}
                onClick={() => setFilter(id)}
                className={cn(
                  'mb-0.5 flex w-full items-center gap-2 rounded-lg px-2.5 py-[var(--row-pad-y-session)] text-left transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
                  active ? SIDEBAR_ACTIVE_RAIL : 'hover:bg-state-hover',
                )}
              >
                {id === 'all' ? (
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{
                      background: `conic-gradient(${colors.todo}, ${colors.in_progress}, ${colors.done}, ${colors.archived}, ${colors.todo})`,
                    }}
                    aria-hidden
                  />
                ) : (
                  <span
                    className="size-2.5 shrink-0 rounded-full shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]"
                    style={{
                      background:
                        colors[colorKey!] ?? DEFAULT_STATUS_COLORS[colorKey!],
                    }}
                    aria-hidden
                  />
                )}
                <span className="min-w-0 flex-1 truncate text-body font-medium text-ink">
                  {t(`workItems.filters.${id}`)}
                </span>
                {colorKey ? (
                  <Popover
                    open={recolorFor === colorKey}
                    onOpenChange={(o) => setRecolorFor(o ? colorKey : null)}
                  >
                    <PopoverTrigger asChild>
                      <span
                        role="button"
                        tabIndex={0}
                        data-testid={`sidebar-work-item-recolor-${id}`}
                        data-no-drag
                        title={t('workItems.colors.recolor')}
                        aria-label={t('workItems.colors.recolorAria', {
                          status: t(`workItems.filters.${id}`),
                        })}
                        className="rounded p-0.5 text-ink-tertiary opacity-0 hover:bg-surface hover:text-ink group-hover:opacity-100 group-focus-within:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation()
                          setRecolorFor(colorKey)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            e.stopPropagation()
                            setRecolorFor(colorKey)
                          }
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
                      </span>
                    </PopoverTrigger>
                    <PopoverContent
                      className="w-40 p-2"
                      align="start"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="mb-1.5 text-caption font-medium text-ink-tertiary">
                        {t('workItems.colors.recolor')}
                      </div>
                      <div className="grid grid-cols-4 gap-1.5">
                        {SWATCHES.map((hex) => (
                          <button
                            key={hex}
                            type="button"
                            className={cn(
                              'size-7 rounded-md border-2',
                              colors[colorKey] === hex
                                ? 'border-ink'
                                : 'border-transparent',
                            )}
                            style={{ background: hex }}
                            aria-label={hex}
                            data-testid={`work-item-swatch-${hex.slice(1)}`}
                            onClick={() => {
                              void setStatusColor(colorKey, hex)
                              setRecolorFor(null)
                            }}
                          />
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                ) : null}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
