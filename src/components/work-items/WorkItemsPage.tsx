import { useEffect, useMemo, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarDays, CheckSquare, List } from 'lucide-react'
import {
  filterItems,
  formatMonthLabel,
  localTodayYmd,
  sortWorkItems,
} from '@/domain/work-items'
import { useUiStore } from '@/store/uiStore'
import { useWorkItemStore } from '@/store/workItemStore'
import { useWorkItemViewStore } from '@/store/workItemViewStore'
import { useWorkItemUiPrefsStore } from '@/store/workItemUiPrefsStore'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { cn } from '@/lib/utils'
import { WorkItemMonthCalendar } from './WorkItemMonthCalendar'
import { WorkItemListView } from './WorkItemListView'
import { WorkItemEditorModal } from './WorkItemEditorModal'

const NARROW_MQ = '(max-width: 719px)'

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (target.isContentEditable) return true
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

/**
 * Calendar-first work item surface (flag-gated from AppLayout).
 * Loads catalog + color prefs on mount; keyboard shortcuts when activeView is tasks.
 */
export function WorkItemsPage() {
  const { t, i18n } = useTranslation()
  const activeView = useUiStore((s) => s.activeView)
  const loaded = useWorkItemStore((s) => s.loaded)
  const loading = useWorkItemStore((s) => s.loading)
  const error = useWorkItemStore((s) => s.error)
  const items = useWorkItemStore((s) => s.items)
  const filterId = useWorkItemStore((s) => s.filterId)
  const search = useWorkItemStore((s) => s.search)
  const complete = useWorkItemStore((s) => s.complete)
  const reopen = useWorkItemStore((s) => s.reopen)

  const viewMode = useWorkItemViewStore((s) => s.viewMode)
  const setViewMode = useWorkItemViewStore((s) => s.setViewMode)
  const calendarCursor = useWorkItemViewStore((s) => s.calendarCursor)
  const shiftCalendarMonth = useWorkItemViewStore((s) => s.shiftCalendarMonth)
  const setCalendarCursor = useWorkItemViewStore((s) => s.setCalendarCursor)
  const highlightId = useWorkItemViewStore((s) => s.highlightId)
  const setHighlightId = useWorkItemViewStore((s) => s.setHighlightId)
  const requestCreate = useWorkItemViewStore((s) => s.requestCreate)
  const requestEdit = useWorkItemViewStore((s) => s.requestEdit)
  const modal = useWorkItemViewStore((s) => s.modal)

  const loadPrefs = useWorkItemUiPrefsStore((s) => s.load)
  const colors = useWorkItemUiPrefsStore((s) => s.statusColors)

  useEffect(() => {
    if (!useWorkItemStore.getState().loaded) {
      void useWorkItemStore.getState().load()
    }
    void loadPrefs()
  }, [loadPrefs])

  const today = useMemo(() => localTodayYmd(), [])
  // Calendar ignores search; list applies search via filterItems.
  const calendarItems = useMemo(
    () => sortWorkItems(filterItems(items, filterId, today, '')),
    [items, filterId, today],
  )
  const listItems = useMemo(
    () => sortWorkItems(filterItems(items, filterId, today, search)),
    [items, filterId, today, search],
  )
  const visible = viewMode === 'list' ? listItems : calendarItems

  const filterTitle = t(`workItems.filters.${filterId}` as 'workItems.filters.all', {
    defaultValue: filterId,
  })

  const narrow =
    typeof window !== 'undefined' ? window.matchMedia(NARROW_MQ).matches : false

  useEffect(() => {
    if (activeView !== 'tasks') return

    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      if (modal.mode !== 'closed') return
      if (isEditableTarget(e.target)) {
        if (e.key === 'Escape' && e.target instanceof HTMLElement) {
          e.target.blur()
          e.preventDefault()
        }
        return
      }

      const key = e.key
      if (key === 'n' || key === 'N') {
        e.preventDefault()
        requestCreate()
        return
      }
      if (key === 'Escape') {
        e.preventDefault()
        setHighlightId(null)
        return
      }
      if (key === 'Enter') {
        if (!highlightId) {
          if (visible.length === 0) return
          e.preventDefault()
          requestEdit(visible[0]!.id)
          return
        }
        e.preventDefault()
        requestEdit(highlightId)
        return
      }
      if (key === 'j' || key === 'ArrowDown' || key === 'k' || key === 'ArrowUp') {
        if (viewMode !== 'list' || visible.length === 0) return
        e.preventDefault()
        const idx = highlightId ? visible.findIndex((i) => i.id === highlightId) : -1
        const delta = key === 'j' || key === 'ArrowDown' ? 1 : -1
        const next =
          idx < 0
            ? delta > 0
              ? 0
              : visible.length - 1
            : Math.max(0, Math.min(visible.length - 1, idx + delta))
        setHighlightId(visible[next]!.id)
        return
      }
      if (key === ' ' || key === 'c' || key === 'C') {
        if (!highlightId) return
        e.preventDefault()
        const item = items.find((i) => i.id === highlightId)
        if (!item) return
        if (item.status === 'done') void reopen(item.id)
        else void complete(item.id)
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    activeView,
    complete,
    highlightId,
    items,
    modal.mode,
    reopen,
    requestCreate,
    requestEdit,
    setHighlightId,
    viewMode,
    visible,
  ])

  if (!loaded && loading) {
    return (
      <div
        className="flex h-full min-h-0 flex-1 flex-col"
        data-testid="work-items-page"
      >
        <EmptyState
          icon={CheckSquare}
          tier="professional"
          title={t('workItems.loading')}
          className="flex-1"
        />
      </div>
    )
  }

  const monthLabel = formatMonthLabel(
    calendarCursor.year,
    calendarCursor.monthIndex,
    i18n.language || 'zh-CN',
  )

  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col"
      data-testid="work-items-page"
      style={
        {
          ['--wi-c-todo' as string]: colors.todo,
          ['--wi-c-in_progress' as string]: colors.in_progress,
          ['--wi-c-done' as string]: colors.done,
          ['--wi-c-archived' as string]: colors.archived,
        } as CSSProperties
      }
    >
      {error ? (
        <div
          className="shrink-0 border-b border-danger/30 bg-danger/10 px-4 py-2 text-meta text-danger"
          data-testid="work-item-error"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <div className="min-w-0">
          <h1 className="truncate text-body font-semibold text-ink" data-testid="work-item-view-title">
            {filterTitle}
          </h1>
          <p className="text-meta text-ink-tertiary">
            {viewMode === 'calendar'
              ? t('workItems.view.calendarHint')
              : t('workItems.view.listHint')}
          </p>
        </div>
        <div className="flex-1" />
        <SegmentedControl
          data-testid="work-item-view-mode"
          aria-label={t('workItems.view.modeAria')}
          value={viewMode}
          onChange={setViewMode}
          options={[
            {
              value: 'calendar',
              ariaLabel: t('workItems.view.calendar'),
              label: (
                <span className="inline-flex items-center gap-1">
                  <CalendarDays className="h-3.5 w-3.5" strokeWidth={1.75} />
                  {t('workItems.view.calendar')}
                </span>
              ),
            },
            {
              value: 'list',
              ariaLabel: t('workItems.view.list'),
              label: (
                <span className="inline-flex items-center gap-1">
                  <List className="h-3.5 w-3.5" strokeWidth={1.75} />
                  {t('workItems.view.list')}
                </span>
              ),
            },
          ]}
        />
        {viewMode === 'calendar' ? (
          <div className="flex items-center gap-1" data-testid="work-item-month-nav">
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={t('workItems.calendar.prevMonth')}
              data-testid="work-item-month-prev"
              onClick={() => shiftCalendarMonth(-1)}
            >
              ‹
            </Button>
            <span className="min-w-[6.5rem] text-center text-body font-semibold tabular-nums">
              {monthLabel}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={t('workItems.calendar.nextMonth')}
              data-testid="work-item-month-next"
              onClick={() => shiftCalendarMonth(1)}
            >
              ›
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="work-item-month-today"
              onClick={() => {
                const d = new Date()
                setCalendarCursor(d.getFullYear(), d.getMonth())
              }}
            >
              {t('workItems.calendar.today')}
            </Button>
          </div>
        ) : null}
        <Button
          type="button"
          size="sm"
          data-testid="work-item-new"
          onClick={() => requestCreate()}
        >
          {t('workItems.newItem')}
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
        <div
          className="flex flex-wrap gap-3 px-0.5 text-caption text-ink-secondary"
          data-testid="work-item-color-legend"
        >
          {(['todo', 'in_progress', 'done', 'archived'] as const).map((k) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <i
                className="inline-block size-2.5 rounded-sm"
                style={{ background: colors[k] }}
                aria-hidden
              />
              {t(`workItems.filters.${k === 'todo' ? 'todo' : k === 'in_progress' ? 'in_progress' : k === 'done' ? 'done' : 'archived'}`)}
            </span>
          ))}
        </div>

        {viewMode === 'calendar' ? (
          <WorkItemMonthCalendar
            items={calendarItems}
            todayYmd={today}
            year={calendarCursor.year}
            monthIndex={calendarCursor.monthIndex}
            narrow={narrow}
          />
        ) : (
          <WorkItemListView items={listItems} className={cn('min-h-0 flex-1')} />
        )}
      </div>

      <WorkItemEditorModal />
    </div>
  )
}
