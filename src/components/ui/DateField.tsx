import { useMemo, useRef } from 'react'
import { CalendarDays } from 'lucide-react'
import { isValidDueOn, localTodayYmd } from '@/domain/work-items'
import { cn } from '@/lib/utils'
import { focusField } from './focusClasses'
import { useTranslation } from 'react-i18next'

export type DateFieldProps = {
  value: string
  onChange: (ymd: string) => void
  min?: string
  max?: string
  disabled?: boolean
  className?: string
  'data-testid'?: string
  id?: string
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

/**
 * Date field: app-styled trigger + native `input[type=date]`.
 *
 * Uses the OS/WebView date picker via `HTMLInputElement.showPicker()` so
 * selection always works inside Radix Dialog (custom portaled calendars were
 * blocked by Dialog outside-pointer / stacking issues in Tauri WebView).
 *
 * The real date input stays in the DOM (for e2e getValue / setReactInputValue)
 * but is visually replaced by the trigger chrome.
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
  const { i18n } = useTranslation()
  const locale = i18n.language || 'zh-CN'
  const inputRef = useRef<HTMLInputElement>(null)
  const today = useMemo(() => localTodayYmd(), [])

  const openPicker = () => {
    if (disabled) return
    const el = inputRef.current
    if (!el) return
    try {
      // Chromium / WebKit (Tauri): opens the platform date UI.
      if (typeof el.showPicker === 'function') {
        el.showPicker()
        return
      }
    } catch {
      // showPicker can throw if not triggered by user gesture — fall through.
    }
    el.focus()
    el.click()
  }

  return (
    <div className={cn('relative', className)}>
      {/*
        Native date control — full hit target (invisible) so OS picker + form
        semantics work; trigger is decorative chrome underneath.
      */}
      <input
        ref={inputRef}
        id={id}
        type="date"
        data-testid={testId}
        aria-label={ariaLabel}
        disabled={disabled}
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const next = e.target.value
          onChange(next && isValidDueOn(next) ? next : today)
        }}
        className={cn(
          // Cover the chrome so direct click / keyboard still hits the input.
          'absolute inset-0 z-10 h-9 w-full cursor-pointer opacity-0',
          disabled && 'pointer-events-none',
        )}
      />

      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        aria-hidden
        data-testid={testId ? `${testId}-trigger` : undefined}
        className={cn(
          'pointer-events-none flex h-9 w-full items-center gap-2 rounded-sm border border-border bg-surface px-3 text-left text-body text-ink',
          'transition-[border-color,box-shadow,background-color] duration-chrome',
          focusField,
          disabled && 'opacity-40',
        )}
        onClick={openPicker}
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
    </div>
  )
}
