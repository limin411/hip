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
        'flex flex-col items-center justify-center rounded-lg py-14 text-center',
        className,
      )}
    >
      {children ?? <Icon className="h-7 w-7 text-ink-tertiary" strokeWidth={1.5} />}
      <div className="mt-4 text-body font-medium tracking-tight text-ink">{title}</div>
      {description && (
        <div className="mt-1.5 max-w-xs text-meta leading-relaxed text-ink-secondary">{description}</div>
      )}
      {action && (
        <Button variant="secondary" size="sm" className="mt-5" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  )
}
