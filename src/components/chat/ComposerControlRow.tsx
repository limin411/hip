import { cn } from '@/lib/utils'

/**
 * Composer toolbar: primary controls always full weight; secondary slightly quieter.
 * All controls stay visible (MVP density) — hierarchy without hiding e2e-critical pickers.
 */
export function ComposerControlRow({
  primary,
  secondary,
  className,
}: {
  primary: React.ReactNode
  secondary?: React.ReactNode
  className?: string
}) {
  const hasSecondary = secondary != null && secondary !== false
  return (
    <div
      className={cn('flex min-w-0 flex-wrap items-center gap-x-0.5 gap-y-1', className)}
      data-testid="composer-control-row"
    >
      <div className="flex flex-wrap items-center gap-0.5" data-testid="composer-controls-primary">
        {primary}
      </div>
      {hasSecondary && (
        <div
          className="flex flex-wrap items-center gap-0.5 text-ink-secondary opacity-90"
          data-testid="composer-controls-secondary"
        >
          {secondary}
        </div>
      )}
    </div>
  )
}
