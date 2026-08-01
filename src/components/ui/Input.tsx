import { forwardRef } from 'react'
import { cn } from '@/lib/utils'
import { focusField } from './focusClasses'

/** Canonical field chrome — use on native inputs that cannot use <Input />. */
export const inputClassName = cn(
  'h-9 w-full rounded-sm border border-border bg-surface px-3 text-body text-ink',
  'placeholder:text-ink-tertiary transition-[border-color,box-shadow,background-color] duration-chrome ease-out',
  focusField,
)

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(inputClassName, className)} {...props} />
  ),
)
Input.displayName = 'Input'
