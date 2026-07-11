import { forwardRef } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 border border-transparent font-medium transition active:scale-[0.985] duration-100 focus-visible:outline-none focus-visible:ring-2 disabled:opacity-40 disabled:pointer-events-none',
  {
    variants: {
      variant: {
        // Cursor-inspired solid inverse — soft monochrome (not pure ink-black), never sage paint
        primary:
          'bg-btn-primary text-on-btn-primary hover:bg-btn-primary-hover focus-visible:ring-ink/25',
        secondary:
          'bg-surface-subtle text-ink hover:bg-surface-muted focus-visible:ring-ink/20',
        ghost:
          'text-ink-secondary hover:bg-state-hover hover:text-ink focus-visible:ring-ink/20',
        outline:
          'border-border bg-transparent text-ink hover:bg-state-hover focus-visible:ring-ink/20',
        danger:
          'bg-danger text-on-accent hover:bg-danger/90 focus-visible:ring-danger/40',
        dangerSoft:
          'border-danger/30 text-danger hover:bg-danger/10 focus-visible:ring-danger/30',
      },
      size: {
        sm: 'h-7 rounded-md px-2.5 text-body',
        md: 'h-8 rounded-lg px-3 text-body',
        lg: 'h-9 rounded-lg px-3.5 text-body',
        icon: 'h-7 w-7 rounded-lg p-0 text-body',
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
