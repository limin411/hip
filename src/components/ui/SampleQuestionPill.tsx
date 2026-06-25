import { cn } from '@/lib/utils'

export interface SampleQuestionPillProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode
}

export function SampleQuestionPill({ className, children, ...props }: SampleQuestionPillProps) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center rounded-full border border-border bg-surface-muted px-3 py-1.5 text-body text-ink-secondary transition hover:bg-surface-subtle hover:text-ink active:scale-[0.97]',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}
