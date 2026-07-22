import { forwardRef } from 'react'
import { cn } from '@/lib/utils'
import { focusField } from './focusClasses'

/** Canonical textarea chrome — use when a native textarea cannot use <Textarea />. */
export const textareaClassName = cn(
  'w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-body text-ink',
  'placeholder:text-ink-tertiary transition-[border-color,box-shadow] duration-chrome',
  focusField,
)

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(textareaClassName, className)} {...props} />
))
Textarea.displayName = 'Textarea'
