import { cn } from '@/lib/utils'

/** Small inline metadata pill — tool counts, status tags ("stopped"), and the like. */
export function Badge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded bg-surface-muted px-1.5 py-0.5 text-caption text-ink-tertiary',
        className,
      )}
      {...props}
    />
  )
}
