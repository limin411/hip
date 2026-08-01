import { useMemo, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import {
  MAX_BARS_DESKTOP,
  MAX_BARS_NARROW,
  buildMonthMatrix,
  colorHexForItem,
  placeBarsForMonth,
  type DayBar,
  type WorkItem,
} from '@/domain/work-items'
import { useWorkItemUiPrefsStore } from '@/store/workItemUiPrefsStore'
import { useWorkItemViewStore } from '@/store/workItemViewStore'
import { cn } from '@/lib/utils'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/Popover'
import { DeclarativeContextMenu } from '@/components/context-menu'

const WEEKDAYS_SUN_FIRST = [0, 1, 2, 3, 4, 5, 6] as const

export function WorkItemMonthCalendar({
  items,
  todayYmd,
  year,
  monthIndex,
  narrow,
}: {
  items: readonly WorkItem[]
  todayYmd: string
  year: number
  monthIndex: number
  narrow?: boolean
}) {
  const { t, i18n } = useTranslation()
  const colors = useWorkItemUiPrefsStore((s) => s.statusColors)
  const requestCreate = useWorkItemViewStore((s) => s.requestCreate)
  const requestEdit = useWorkItemViewStore((s) => s.requestEdit)

  const cells = useMemo(() => buildMonthMatrix(year, monthIndex), [year, monthIndex])
  const barsByDate = useMemo(
    () => placeBarsForMonth(items, year, monthIndex, todayYmd),
    [items, year, monthIndex, todayYmd],
  )
  const maxBars = narrow ? MAX_BARS_NARROW : MAX_BARS_DESKTOP

  const weekdayLabels = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(i18n.language || 'zh-CN', { weekday: 'short' })
    // 2026-07-05 is a Sunday
    return WEEKDAYS_SUN_FIRST.map((off) => {
      const d = new Date(2026, 6, 5 + off)
      return fmt.format(d)
    })
  }, [i18n.language])

  return (
    <div
      className="grid min-h-0 flex-1 grid-cols-7 overflow-hidden rounded-lg border border-border bg-surface"
      role="grid"
      aria-label={t('workItems.calendar.aria')}
      data-testid="work-item-month-calendar"
    >
      {weekdayLabels.map((label, i) => (
        <div
          key={label + i}
          className="border-b border-border bg-surface-subtle px-1 py-1.5 text-center text-caption font-medium text-ink-tertiary"
          role="columnheader"
        >
          {label}
        </div>
      ))}
      {cells.map((cell) => {
        const bars = barsByDate.get(cell.ymd) ?? []
        const shown = bars.slice(0, maxBars)
        const extra = bars.length - shown.length
        const isToday = cell.ymd === todayYmd
        return (
          <div
            key={cell.ymd}
            role="gridcell"
            data-testid={`work-item-day-${cell.ymd}`}
            data-date={cell.ymd}
            className={cn(
              'group relative flex min-h-[5.5rem] flex-col border-b border-r border-border',
              cell.out && 'bg-surface-subtle/60 text-ink-tertiary',
            )}
            onDoubleClick={() =>
              requestCreate({ startOn: cell.ymd, endOn: cell.ymd })
            }
          >
            <DeclarativeContextMenu
              kind="workItemBlank"
              payload={{ startOn: cell.ymd, endOn: cell.ymd }}
              className="flex min-h-0 flex-1 flex-col gap-0.5 p-1"
            >
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    'flex h-6 w-6 items-center justify-center rounded-full text-caption font-semibold tabular-nums',
                    isToday && 'bg-accent text-on-accent',
                  )}
                >
                  {cell.d}
                </span>
                <button
                  type="button"
                  className="flex h-5 w-5 items-center justify-center rounded text-ink-tertiary opacity-0 hover:bg-state-hover hover:text-ink group-hover:opacity-100"
                  data-testid={`work-item-day-add-${cell.ymd}`}
                  aria-label={t('workItems.calendar.addOnDay', { date: cell.ymd })}
                  onClick={(e) => {
                    e.stopPropagation()
                    requestCreate({ startOn: cell.ymd, endOn: cell.ymd })
                  }}
                >
                  +
                </button>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-0.5">
                {shown.map((bar) => (
                  <BarChip
                    key={`${bar.itemId}-${bar.kind}-${cell.ymd}`}
                    bar={bar}
                    items={items}
                    colors={colors}
                    onOpen={() => requestEdit(bar.itemId)}
                  />
                ))}
                {extra > 0 ? (
                  <DayMorePopover
                    date={cell.ymd}
                    bars={bars}
                    items={items}
                    colors={colors}
                    extra={extra}
                    onOpen={(id) => requestEdit(id)}
                  />
                ) : null}
              </div>
            </DeclarativeContextMenu>
          </div>
        )
      })}
    </div>
  )
}

function BarChip({
  bar,
  items,
  colors,
  onOpen,
}: {
  bar: DayBar
  items: readonly WorkItem[]
  colors: ReturnType<typeof useWorkItemUiPrefsStore.getState>['statusColors']
  onOpen: () => void
}) {
  const item = items.find((i) => i.id === bar.itemId)
  const hex = item ? colorHexForItem(item, colors) : colors.todo
  // Title only on start/single; mid/end still open edit so multi-day bars are always clickable.
  const showTitle = bar.kind === 'start' || bar.kind === 'single'
  const label = showTitle ? bar.title || '·' : '·'
  const className = cn(
    'block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium leading-tight',
    bar.done && 'line-through opacity-70',
    bar.archived && 'opacity-55',
    bar.kind === 'start' && 'rounded-r-none',
    bar.kind === 'mid' && 'rounded-none text-transparent',
    bar.kind === 'end' && 'rounded-l-none text-transparent',
  )
  const style = {
    ['--bar-color' as string]: hex,
    background: `color-mix(in srgb, ${hex} 22%, white)`,
    boxShadow:
      bar.kind === 'mid' || bar.kind === 'end' ? 'none' : `inset 3px 0 0 ${hex}`,
    color: '#0f172a',
  } as CSSProperties

  const itemTitle = item?.title.trim() || bar.title || ''
  return (
    <DeclarativeContextMenu
      kind="workItem"
      payload={{
        itemId: bar.itemId,
        title: itemTitle,
        status: item?.status ?? 'todo',
        archived: item?.archivedAt != null || Boolean(bar.archived),
        links: item?.links ?? {},
      }}
      className="block w-full min-w-0"
    >
      <button
        type="button"
        className={className}
        style={style}
        data-testid={`work-item-bar-${bar.itemId}`}
        title={bar.title}
        onClick={(e) => {
          e.stopPropagation()
          onOpen()
        }}
      >
        {label}
      </button>
    </DeclarativeContextMenu>
  )
}

function DayMorePopover({
  date,
  bars,
  items,
  colors,
  extra,
  onOpen,
}: {
  date: string
  bars: DayBar[]
  items: readonly WorkItem[]
  colors: ReturnType<typeof useWorkItemUiPrefsStore.getState>['statusColors']
  extra: number
  onOpen: (id: string) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  // Unique items for the day (start/single only for titles)
  const unique = useMemo(() => {
    const seen = new Set<string>()
    const out: DayBar[] = []
    for (const b of bars) {
      if (seen.has(b.itemId)) continue
      seen.add(b.itemId)
      out.push(b)
    }
    return out
  }, [bars])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="px-1 text-left text-caption text-ink-tertiary hover:text-ink"
          data-testid={`work-item-day-more-${date}`}
        >
          {t('workItems.calendar.more', { count: extra })}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="start">
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {unique.map((b) => {
            const item = items.find((i) => i.id === b.itemId)
            const hex = item ? colorHexForItem(item, colors) : colors.todo
            const title = b.title || t('workItems.untitled')
            return (
              <li key={b.itemId}>
                <DeclarativeContextMenu
                  kind="workItem"
                  payload={{
                    itemId: b.itemId,
                    title,
                    status: item?.status ?? 'todo',
                    archived: item?.archivedAt != null || Boolean(b.archived),
                    links: item?.links ?? {},
                  }}
                  data-testid={`work-item-day-more-item-${b.itemId}`}
                  className="block w-full"
                >
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body hover:bg-state-hover"
                    onClick={() => {
                      setOpen(false)
                      onOpen(b.itemId)
                    }}
                  >
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: hex }}
                    />
                    <span className="truncate">{title}</span>
                  </button>
                </DeclarativeContextMenu>
              </li>
            )
          })}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
