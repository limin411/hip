import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import {
  buildMonthMatrix,
  formatMonthLabel,
  isValidDueOn,
  localTodayYmd,
} from '@/domain/work-items'
import { cn } from '@/lib/utils'
import { focusField } from './focusClasses'

const WEEKDAYS_SUN_FIRST = [0, 1, 2, 3, 4, 5, 6] as const
const PANEL_WIDTH = 280

export type DateFieldProps = {
  value: string
  onChange: (ymd: string) => void
  min?: string
  max?: string
  disabled?: boolean
  className?: string
  'data-testid'?: string
  id?: string
  /** Accessible name for the trigger button */
  'aria-label'?: string
}

function parseYmd(ymd: string): { y: number; m: number; d: number } | null {
  if (!isValidDueOn(ymd)) return null
  return {
    y: Number(ymd.slice(0, 4)),
    m: Number(ymd.slice(5, 7)) - 1,
    d: Number(ymd.slice(8, 10)),
  }
}

function formatDisplay(ymd: string, locale: string): string {
  const p = parseYmd(ymd)
  if (!p) return ymd
  try {
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(new Date(p.y, p.m, p.d))
  } catch {
    return ymd
  }
}

type PanelPos = { top: number; left: number }

/**
 * App-styled date field: trigger + portaled fixed month grid.
 * Portal uses fixed coords (not Radix Popover) so:
 * - not clipped by Modal overflow
 * - sits above dialog (z-index 70)
 * - day / “今天” clicks are not swallowed by full-screen dialog chrome
 */
export function DateField({
  value,
  onChange,
  min,
  max,
  disabled,
  className,
  id,
  'data-testid': testId,
  'aria-label': ariaLabel,
}: DateFieldProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language || 'zh-CN'
  const today = useMemo(() => localTodayYmd(), [])
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<PanelPos>({ top: 0, left: 0 })
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const [cursor, setCursor] = useState(() => {
    const p = parseYmd(value)
    if (p) return { year: p.y, monthIndex: p.m }
    const n = new Date()
    return { year: n.getFullYear(), monthIndex: n.getMonth() }
  })

  useEffect(() => {
    if (open) return
    const p = parseYmd(value)
    if (p) setCursor({ year: p.y, monthIndex: p.m })
  }, [value, open])

  const updatePos = () => {
    const trig = triggerRef.current
    if (!trig) return
    const r = trig.getBoundingClientRect()
    const gap = 4
    let top = r.bottom + gap
    let left = r.left
    // Prefer below; flip above if near bottom of viewport
    const approxPanelH = 320
    if (top + approxPanelH > window.innerHeight - 8 && r.top > approxPanelH) {
      top = r.top - approxPanelH - gap
    }
    // Keep in horizontal viewport
    left = Math.min(left, window.innerWidth - PANEL_WIDTH - 8)
    left = Math.max(8, left)
    setPos({ top, left })
  }

  useLayoutEffect(() => {
    if (!open) return
    updatePos()
    const onScroll = () => updatePos()
    window.addEventListener('resize', onScroll)
    // capture scroll from modal body too
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('resize', onScroll)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      const t = e.target
      if (!(t instanceof Node)) return
      if (rootRef.current?.contains(t)) return
      if (panelRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointer, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onPointer, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const cells = useMemo(
    () => buildMonthMatrix(cursor.year, cursor.monthIndex),
    [cursor.year, cursor.monthIndex],
  )

  const weekdayLabels = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { weekday: 'narrow' })
    return WEEKDAYS_SUN_FIRST.map((off) => {
      const d = new Date(2026, 6, 5 + off)
      return fmt.format(d)
    })
  }, [locale])

  const monthLabel = formatMonthLabel(cursor.year, cursor.monthIndex, locale)

  const isDisabledDay = (ymd: string) => {
    if (min && ymd < min) return true
    if (max && ymd > max) return true
    return false
  }

  const pick = (ymd: string) => {
    if (isDisabledDay(ymd)) return
    onChange(ymd)
    setOpen(false)
  }

  const handleToday = () => {
    const p = parseYmd(today)
    if (p) setCursor({ year: p.y, monthIndex: p.m })
    if (!isDisabledDay(today)) {
      onChange(today)
      setOpen(false)
    }
  }

  const shiftMonth = (delta: number) => {
    setCursor((c) => {
      const d = new Date(c.year, c.monthIndex + delta, 1)
      return { year: d.getFullYear(), monthIndex: d.getMonth() }
    })
  }

  const handleHiddenChange = (raw: string) => {
    if (!raw) {
      onChange(today)
      return
    }
    if (isValidDueOn(raw)) onChange(raw)
  }

  const panel =
    open && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={ariaLabel}
            data-testid={testId ? `${testId}-panel` : 'date-field-panel'}
            data-date-field-panel=""
            className="fixed z-[70] rounded-lg border border-border bg-surface p-3 shadow-menu"
            style={{ top: pos.top, left: pos.left, width: PANEL_WIDTH }}
          >
            <div className="mb-2 flex items-center gap-1" data-testid="date-field-month-nav">
              <button
                type="button"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-secondary hover:bg-state-hover hover:text-ink"
                aria-label={t('workItems.calendar.prevMonth')}
                data-testid="date-field-prev-month"
                onClick={() => shiftMonth(-1)}
              >
                <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
              </button>
              <span className="min-w-0 flex-1 text-center text-body font-semibold text-ink">
                {monthLabel}
              </span>
              <button
                type="button"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-secondary hover:bg-state-hover hover:text-ink"
                aria-label={t('workItems.calendar.nextMonth')}
                data-testid="date-field-next-month"
                onClick={() => shiftMonth(1)}
              >
                <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>

            <div className="mb-1 grid grid-cols-7 gap-0.5">
              {weekdayLabels.map((label, i) => (
                <div
                  key={`${label}-${i}`}
                  className="py-0.5 text-center text-caption font-medium text-ink-tertiary"
                >
                  {label}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-0.5" role="grid">
              {cells.map((cell) => {
                const selectedDay = cell.ymd === value
                const isToday = cell.ymd === today
                const out = cell.out
                const blocked = isDisabledDay(cell.ymd)
                return (
                  <button
                    key={cell.ymd}
                    type="button"
                    role="gridcell"
                    disabled={blocked}
                    aria-selected={selectedDay}
                    data-testid={`date-field-day-${cell.ymd}`}
                    onClick={() => pick(cell.ymd)}
                    className={cn(
                      'relative flex h-8 items-center justify-center rounded-md text-caption tabular-nums transition-colors duration-chrome',
                      blocked && 'cursor-not-allowed opacity-30',
                      !blocked && !selectedDay && 'hover:bg-state-hover',
                      out && !selectedDay && 'text-ink-tertiary',
                      !out && !selectedDay && 'text-ink',
                      selectedDay &&
                        'bg-btn-primary font-semibold text-on-btn-primary hover:bg-btn-primary-hover',
                      isToday &&
                        !selectedDay &&
                        'font-semibold text-accent ring-1 ring-inset ring-accent/35',
                    )}
                  >
                    {cell.d}
                  </button>
                )
              })}
            </div>

            <div className="mt-2 flex justify-end border-t border-border pt-2">
              <button
                type="button"
                className="rounded-md px-2 py-1 text-caption font-medium text-ink-secondary hover:bg-state-hover hover:text-ink"
                data-testid="date-field-today"
                onClick={() => handleToday()}
              >
                {t('workItems.calendar.today')}
              </button>
            </div>
          </div>,
          document.body,
        )
      : null

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <input
        id={id}
        type="text"
        inputMode="none"
        data-testid={testId}
        tabIndex={-1}
        aria-hidden
        className="pointer-events-none absolute h-px w-px overflow-hidden opacity-0"
        value={value}
        onChange={(e) => handleHiddenChange(e.target.value)}
      />

      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-testid={testId ? `${testId}-trigger` : undefined}
        className={cn(
          'flex h-9 w-full items-center gap-2 rounded-md border border-border bg-surface px-3 text-left text-body text-ink',
          'transition-[border-color,box-shadow,background-color] duration-chrome',
          'hover:bg-state-hover/40 disabled:pointer-events-none disabled:opacity-40',
          focusField,
          open && 'border-accent ring-[3px] ring-accent/10',
        )}
        onClick={() => {
          if (disabled) return
          setOpen((o) => !o)
        }}
      >
        <CalendarDays
          className="h-3.5 w-3.5 shrink-0 text-ink-tertiary"
          strokeWidth={1.75}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate tabular-nums">
          {formatDisplay(value, locale)}
        </span>
      </button>

      {panel}
    </div>
  )
}
