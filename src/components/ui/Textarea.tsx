import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-body text-ink transition-[border-color,box-shadow] duration-chrome',
        'placeholder:text-ink-tertiary focus-visible:outline-none focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-accent/10',
        className,
      )}
      {...props}
    />
  ),
)
Textarea.displayName = 'Textarea'
