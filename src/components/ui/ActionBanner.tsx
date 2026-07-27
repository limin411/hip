import type { LucideIcon } from 'lucide-react'
import { AlertTriangle, Info, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ActionBannerTone = 'warning' | 'danger' | 'info'

const TONE: Record<
  ActionBannerTone,
  { shell: string; icon: string; Icon: LucideIcon }
> = {
  warning: {
    shell: 'border-b border-warning/30 bg-warning/10',
    icon: 'text-warning',
    Icon: AlertTriangle,
  },
  danger: {
    shell: 'border-b border-danger/30 bg-danger/10',
    icon: 'text-danger',
    Icon: XCircle,
  },
  info: {
    shell: 'border-b border-border bg-surface-muted/60',
    icon: 'text-ink-secondary',
    Icon: Info,
  },
}

export interface ActionBannerProps {
  tone?: ActionBannerTone
  title: string
  description?: React.ReactNode
  /** Extra lines under description (e.g. MCP status). */
  meta?: React.ReactNode
  actions?: React.ReactNode
  icon?: LucideIcon
  className?: string
  role?: 'alert' | 'status'
  'data-testid'?: string
  /** Extra data-* for call sites (e.g. data-reason). */
  'data-reason'?: string
}

/**
 * Shared sticky action strip above the composer / main content.
 * Title + optional description + right-aligned actions.
 */
export function ActionBanner({
  tone = 'warning',
  title,
  description,
  meta,
  actions,
  icon,
  className,
  role = 'status',
  'data-testid': testId,
  'data-reason': dataReason,
}: ActionBannerProps) {
  const t = TONE[tone]
  const Icon = icon ?? t.Icon
  return (
    <div
      className={cn(
        'flex shrink-0 items-start gap-3 px-4 py-2.5 animate-view-enter',
        t.shell,
        className,
      )}
      data-testid={testId}
      data-reason={dataReason}
      data-tone={tone}
      role={role}
    >
      <Icon size={16} className={cn('mt-0.5 shrink-0', t.icon)} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="text-meta font-medium text-ink">{title}</div>
        {description != null && description !== '' && (
          <div className="mt-0.5 text-caption text-ink-secondary">{description}</div>
        )}
        {meta != null && meta !== '' && (
          <div className="mt-0.5 text-caption text-ink-tertiary">{meta}</div>
        )}
      </div>
      {actions != null && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  )
}
