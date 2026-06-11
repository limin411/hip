import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

interface ComposerChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Highlights the chip in the accent color (e.g. thinking on, a style selected). */
  active?: boolean
}

/**
 * Toggle chip in the composer footer (thinking mode, style picker). Renders as a
 * plain `<button>`, or — via Radix `asChild` — as a dropdown/menu trigger.
 */
export const ComposerChip = forwardRef<HTMLButtonElement, ComposerChipProps>(
  function ComposerChip({ active, className, type = 'button', ...props }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          'flex items-center gap-1.5 px-2 py-1 text-meta transition-colors disabled:cursor-not-allowed disabled:opacity-50',
          active ? 'text-accent-strong' : 'text-ink-tertiary hover:text-ink-secondary',
          className,
        )}
        {...props}
      />
    )
  },
)
