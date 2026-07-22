import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-md transition-colors duration-chrome active:scale-[0.97]',
  {
    variants: {
      variant: {
        default: 'bg-surface-muted text-ink-tertiary hover:bg-state-hover hover:text-ink-secondary',
        accent: 'bg-accent/10 text-accent hover:bg-accent/15',
        success: 'bg-success/10 text-success hover:bg-success/15',
        warning: 'bg-warning/10 text-warning hover:bg-warning/15',
        danger: 'bg-danger/10 text-danger hover:bg-danger/15',
      },
      size: {
        sm: 'px-1 py-0 text-meta',
        default: 'px-1.5 py-0.5 text-caption',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, size, ...props }: BadgeProps) {
  return (
    <span
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    />
  )
}
