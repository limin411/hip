import { forwardRef } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-md font-medium transition active:scale-[0.97] duration-100 focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50 disabled:pointer-events-none',
  {
    variants: {
      variant: {
        // Neutral elevated CTA (login design D) — no sage fill + light text
        primary:
          'border border-ink bg-surface text-ink font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.06)] hover:bg-surface-subtle focus-visible:ring-ink/25',
        secondary:
          'border border-border bg-surface-subtle text-ink hover:bg-surface-muted focus-visible:ring-ink/20',
        ghost:
          'text-ink-secondary hover:bg-state-hover hover:text-ink focus-visible:ring-ink/20',
        outline:
          'border border-border bg-surface text-ink hover:bg-surface-muted focus-visible:ring-ink/20',
        danger:
          'bg-danger text-on-accent hover:bg-danger/90 focus-visible:ring-danger/40',
      },
      size: {
        sm: 'h-8 px-3 text-body',
        md: 'h-9 px-4 text-body',
        lg: 'h-10 px-5 text-body',
        icon: 'h-8 w-8 p-0 text-body',
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
