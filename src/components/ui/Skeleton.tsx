import { cn } from '@/lib/utils'

/** Pulsing muted block for loading placeholders. */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-md bg-surface-muted',
        className,
      )}
      data-testid="skeleton"
      aria-hidden
      {...props}
    />
  )
}

/** Stack of skeleton text lines (title + body rhythm). */
export function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number
  className?: string
}) {
  return (
    <div className={cn('space-y-2', className)} data-testid="skeleton-text">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          className={cn(
            'h-3',
            i === 0 ? 'w-40' : i === lines - 1 ? 'w-64 max-w-full' : 'w-full',
          )}
        />
      ))}
    </div>
  )
}
