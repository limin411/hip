import { cn } from '@/lib/utils'

export type SegmentedOption<T extends string> = {
  value: T
  label: string
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
        'inline-flex items-center gap-0.5 rounded-lg border border-border bg-surface-muted p-0.5',
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
            data-mode={opt.value}
            data-testid={dataTestId ? `${dataTestId}-${opt.value}` : undefined}
            onClick={() => onChange(opt.value)}
            className={cn(
              'rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
              size === 'sm' ? 'h-6 px-2 text-caption' : 'h-7 px-2.5 text-body',
              selected
                ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(0,0,0,0.06)] ring-1 ring-border'
                : 'text-ink-tertiary hover:text-ink',
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
