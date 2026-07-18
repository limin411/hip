import type { LucideIcon } from 'lucide-react'
import { Inbox } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from './Button'

export type EmptyStateTier = 'friendly' | 'professional'

export interface EmptyStateProps {
  icon?: LucideIcon
  /** Visual personality ladder. Default `professional` (quiet, no dashed chrome). */
  tier?: EmptyStateTier
  title: string
  description?: string
  action?: {
    label: string
    onClick: () => void
  }
  /**
   * Call-site brand media (e.g. `<HipLogo size={32} decorative />`).
   * ui/ never imports login/ — compose via children only.
   */
  children?: React.ReactNode
  className?: string
}

export function EmptyState({
  icon: Icon = Inbox,
  tier = 'professional',
  title,
  description,
  action,
  children,
  className,
}: EmptyStateProps) {
  return (
    <div
      data-tier={tier}
      className={cn(
        'flex flex-col items-center justify-center rounded-lg py-12 text-center',
        className,
      )}
    >
      {children ?? <Icon className="h-8 w-8 text-ink-tertiary" />}
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
