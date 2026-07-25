/**
 * Sidebar list pane for work-item tracking: smart filters + user lists.
 * Rendered by AppSidebar when WORK_ITEM_TRACKING && sidebarSection === 'tasks'.
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Inbox, List, Plus } from 'lucide-react'
import { INBOX_LIST_ID, type WorkItemList } from '@/domain/work-items'
import { cn } from '@/lib/utils'
import { useWorkItemStore } from '@/store/workItemStore'
import { SIDEBAR_ACTIVE_RAIL } from '@/components/layout/sidebarActiveRail'

/** Smart filter order (design IA). */
export const WORK_ITEM_SMART_FILTERS = [
  'open',
  'today',
  'overdue',
  'in_progress',
  'done',
  'cancelled',
  'archived',
] as const

export type WorkItemSmartFilterId = (typeof WORK_ITEM_SMART_FILTERS)[number]

function isInboxList(list: WorkItemList): boolean {
  return list.id === INBOX_LIST_ID || list.system === 'inbox'
}

/** Inbox first, then user lists by sortOrder ascending. */
export function orderListsForSidebar(lists: WorkItemList[]): WorkItemList[] {
  const inbox = lists.filter(isInboxList)
  const rest = lists
    .filter((l) => !isInboxList(l))
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
  // Prefer single inbox row; if missing from store, still show nothing extra.
  return [...inbox, ...rest]
}

export function WorkItemSidebarLists() {
  const { t } = useTranslation()
  const filterId = useWorkItemStore((s) => s.filterId)
  const lists = useWorkItemStore((s) => s.lists)
  const setFilter = useWorkItemStore((s) => s.setFilter)
  const createList = useWorkItemStore((s) => s.createList)
  const renameList = useWorkItemStore((s) => s.renameList)
  const deleteList = useWorkItemStore((s) => s.deleteList)

  const orderedLists = useMemo(() => orderListsForSidebar(lists), [lists])

  const promptNewList = () => {
    const name = window.prompt(t('workItems.newListPrompt'))
    if (name == null) return
    const trimmed = name.trim()
    if (!trimmed) return
    void createList(trimmed).then((id) => {
      setFilter(`list:${id}`)
    })
  }

  const promptRenameList = (list: WorkItemList) => {
    if (isInboxList(list)) return
    const name = window.prompt(t('workItems.renameListPrompt'), list.name)
    if (name == null) return
    const trimmed = name.trim()
    if (!trimmed || trimmed === list.name) return
    void renameList(list.id, trimmed)
  }

  const confirmDeleteList = (list: WorkItemList) => {
    if (isInboxList(list)) return
    const ok = window.confirm(t('workItems.deleteListConfirm', { name: list.name }))
    if (!ok) return
    void deleteList(list.id)
  }

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

      <div className="mt-1 flex items-center justify-between px-2">
        <span
          className="text-caption font-medium text-ink-tertiary"
          id="sidebar-work-item-lists-heading"
        >
          {t('workItems.listsHeading')}
        </span>
        <button
          type="button"
          data-testid="sidebar-new-work-item-list"
          data-no-drag
          title={t('workItems.newList')}
          aria-label={t('workItems.newList')}
          onClick={promptNewList}
          className="rounded-md p-0.5 text-ink-tertiary transition-colors duration-chrome hover:bg-state-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
        >
          <Plus size={14} strokeWidth={1.75} aria-hidden />
        </button>
      </div>

      <ul
        className="m-0 list-none p-0"
        aria-labelledby="sidebar-work-item-lists-heading"
        data-testid="sidebar-work-item-lists"
      >
        {orderedLists.map((list) => {
          const listFilter = `list:${list.id}`
          const active = filterId === listFilter
          const inbox = isInboxList(list)
          const label = inbox ? t('workItems.inbox') : list.name
          return (
            <li key={list.id}>
              <button
                type="button"
                data-testid={`sidebar-work-item-list-${list.id}`}
                data-no-drag
                aria-current={active ? 'true' : undefined}
                title={
                  inbox
                    ? label
                    : t('workItems.listRowHint', { name: list.name })
                }
                onClick={() => setFilter(listFilter)}
                onDoubleClick={() => promptRenameList(list)}
                onContextMenu={(e) => {
                  if (inbox) return
                  e.preventDefault()
                  confirmDeleteList(list)
                }}
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
                {inbox ? (
                  <Inbox
                    size={14}
                    className="mt-0.5 shrink-0 text-ink-tertiary"
                    aria-hidden
                  />
                ) : (
                  <List
                    size={14}
                    className="mt-0.5 shrink-0 text-ink-tertiary"
                    aria-hidden
                  />
                )}
                <span className="min-w-0 flex-1 truncate text-body font-medium text-ink">
                  {label}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
