import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

interface ComposerChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Highlights the chip in the accent color (e.g. thinking on, a style selected). */
  active?: boolean
  /** `sm` — compact chip for the composer footer status strip. Default `md`. */
  size?: 'md' | 'sm'
}

/**
 * Toggle chip in the composer footer (thinking mode, style picker). Renders as a
 * plain `<button>`, or — via Radix `asChild` — as a dropdown/menu trigger.
 */
export const ComposerChip = forwardRef<HTMLButtonElement, ComposerChipProps>(
  function ComposerChip({ active, size = 'md', className, type = 'button', ...props }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          'inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-meta font-medium transition-colors duration-chrome',
          size === 'sm' && 'h-5 gap-1 px-1 text-caption',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
          'disabled:cursor-not-allowed disabled:opacity-50',
          active
            ? 'bg-state-active text-ink'
            : 'text-ink-tertiary hover:bg-state-hover hover:text-ink-secondary',
          className,
        )}
        {...props}
      />
    )
  },
)
