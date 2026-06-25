import type { LucideIcon } from 'lucide-react'
import { Inbox } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from './Button'

export interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  action?: {
    label: string
    onClick: () => void
  }
  className?: string
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12 text-center',
        className,
      )}
    >
      <Icon className="h-8 w-8 text-ink-tertiary" />
      <div className="mt-3 text-body font-medium text-ink">{title}</div>
      {description && (
        <div className="mt-1 max-w-xs text-meta text-ink-secondary">{description}</div>
      )}
      {action && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  )
}
