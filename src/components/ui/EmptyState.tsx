import type { LucideIcon } from 'lucide-react'
import { Inbox } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from './Button'
import { viewEnterMotion } from './motionClasses'

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
    'data-testid'?: string
  }
  /** Optional second CTA under the primary action (e.g. New Whiteboard). */
  secondaryAction?: {
    label: string
    onClick: () => void
    'data-testid'?: string
  }
  /**
   * Call-site brand media (e.g. `<HipLogo size={32} decorative />`).
   * ui/ never imports login/ — compose via children only.
   */
  children?: React.ReactNode
  className?: string
  'data-testid'?: string
}

export function EmptyState({
  icon: Icon = Inbox,
  tier = 'professional',
  title,
  description,
  action,
  secondaryAction,
  children,
  className,
  'data-testid': testId,
}: EmptyStateProps) {
  return (
    <div
      data-tier={tier}
      data-testid={testId}
      className={cn(
        'flex flex-col items-center justify-center rounded-lg py-14 text-center',
        viewEnterMotion,
        className,
      )}
    >
      {children ?? <Icon className="h-7 w-7 text-ink-tertiary" strokeWidth={1.5} />}
      <div className="mt-4 text-body font-medium tracking-tight text-ink">{title}</div>
      {description && (
        <div className="mt-1.5 max-w-xs text-meta leading-relaxed text-ink-secondary">{description}</div>
      )}
      {(action || secondaryAction) && (
        <div className="mt-5 flex flex-col items-center gap-2">
          {action && (
            <Button
              variant="secondary"
              size="sm"
              onClick={action.onClick}
              data-testid={action['data-testid']}
            >
              {action.label}
            </Button>
          )}
          {secondaryAction && (
            <Button
              variant="ghost"
              size="sm"
              onClick={secondaryAction.onClick}
              data-testid={secondaryAction['data-testid']}
            >
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
