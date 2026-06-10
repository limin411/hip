import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink transition-shadow',
        'placeholder:text-ink-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        className,
      )}
      {...props}
    />
  ),
)
Textarea.displayName = 'Textarea'
