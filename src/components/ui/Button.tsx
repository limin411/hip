import { forwardRef } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import { focusChrome } from './focusClasses'

export const buttonVariants = cva(
  cn(
    'inline-flex items-center justify-center gap-1.5 border border-transparent font-medium transition-[background-color,color,border-color,opacity,box-shadow] duration-chrome ease-out disabled:opacity-40 disabled:pointer-events-none',
    focusChrome,
  ),
  {
    variants: {
      variant: {
        // Solid inverse CTA — soft monochrome (not pure ink-black), never brand accent paint
        primary: 'bg-btn-primary text-on-btn-primary hover:bg-btn-primary-hover',
        secondary: 'bg-surface-subtle text-ink hover:bg-state-hover',
        ghost: 'text-ink-secondary hover:bg-state-hover hover:text-ink',
        outline: 'border-border bg-transparent text-ink hover:bg-state-hover',
        danger:
          'bg-danger text-on-accent hover:bg-danger/90 focus-visible:ring-danger/40',
        dangerSoft:
          'border-danger/30 text-danger hover:bg-danger/10 focus-visible:ring-danger/30',
      },
      size: {
        sm: 'h-7 rounded-md px-2.5 text-body',
        md: 'h-8 rounded-md px-3 text-body',
        lg: 'h-9 rounded-lg px-3.5 text-body',
        icon: 'h-7 w-7 rounded-md p-0 text-body',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
)
Button.displayName = 'Button'
