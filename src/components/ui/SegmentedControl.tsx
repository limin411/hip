import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { focusChrome } from './focusClasses'

export type SegmentedOption<T extends string> = {
  value: T
  /** Visible label; may include icon + text. */
  label: ReactNode
  /** Accessible name when `label` is not plain text-only. */
  ariaLabel?: string
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = 'sm',
  'aria-label': ariaLabel,
  className,
  'data-testid': dataTestId,
}: {
  options: SegmentedOption<T>[]
  value: T
  onChange: (v: T) => void
  size?: 'sm' | 'md'
  'aria-label'?: string
  className?: string
  'data-testid'?: string
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      data-testid={dataTestId}
      className={cn(
        // Soft track only — no outer border (avoids double-box with selected segment).
        'inline-flex items-center rounded-md bg-surface-muted p-0.5',
        className,
      )}
    >
      {options.map((opt) => {
        const selected = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-label={opt.ariaLabel}
            data-mode={opt.value}
            data-testid={dataTestId ? `${dataTestId}-${opt.value}` : undefined}
            onClick={() => onChange(opt.value)}
            className={cn(
              'inline-flex items-center justify-center gap-1 rounded font-medium transition-colors duration-chrome',
              focusChrome,
              size === 'sm' ? 'h-7 px-2.5 text-meta' : 'h-8 px-3 text-body',
              selected
                ? // Elevated chip on muted track — surface only, no shadow (flat chrome rule).
                  'bg-surface text-ink'
                : 'text-ink-secondary hover:bg-state-hover/70 hover:text-ink',
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
