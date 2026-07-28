import { useTranslation } from 'react-i18next'
import { MessageSquare, Pencil, Play, X } from 'lucide-react'
import type { Automation } from '@/domain/automations'
import { sessionService } from '@/domain'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { formatAbsolute, formatRelativeTime } from '@/lib/datetime'
import { cn } from '@/lib/utils'
import { AutomationRunHistory } from './AutomationRunHistory'

export type AutomationDetailPanelProps = {
  automation: Automation
  running?: boolean
  onClose: () => void
  onRun: (opts?: { focus?: boolean }) => void
  onEdit: () => void
  className?: string
}

const WEEKDAY_KEYS = [
  'automation.weekday.0',
  'automation.weekday.1',
  'automation.weekday.2',
  'automation.weekday.3',
  'automation.weekday.4',
  'automation.weekday.5',
  'automation.weekday.6',
] as const

function triggerLabel(
  a: Automation,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const tr = a.trigger
  if (tr.kind === 'manual') return t('automation.trigger.manual')
  const time = `${String(tr.hour).padStart(2, '0')}:${String(tr.minute).padStart(2, '0')}`
  if (tr.kind === 'daily') {
    return t('automation.trigger.dailyAt', { time })
  }
  const wd = ((tr.weekday % 7) + 7) % 7
  return t('automation.trigger.weeklyAt', {
    weekday: t(WEEKDAY_KEYS[wd]!),
    time,
  })
}

/**
 * Selected automation: summary + actions + recent run history.
 */
export function AutomationDetailPanel({
  automation,
  running,
  onClose,
  onRun,
  onEdit,
  className,
}: AutomationDetailPanelProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language || 'en'
  const name = automation.name.trim() || t('automation.untitled')
  const status = automation.lastStatus
  const errorLine =
    (status === 'failed' || status === 'skipped') && automation.lastError
      ? t(`automation.skipReasons.${automation.lastError}` as 'automation.skipReasons.missed_over_6h', {
          defaultValue: automation.lastError,
        })
      : null

  const openLastSession = () => {
    if (automation.lastSessionId) {
      sessionService.selectSession(automation.lastSessionId)
    }
  }

  return (
    <aside
      className={cn(
        'flex min-h-0 w-full flex-col border-border bg-surface',
        className,
      )}
      data-testid="automation-detail-panel"
      aria-label={name}
    >
      <div className="flex shrink-0 flex-col gap-2 border-b border-border px-3 py-2.5">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2
              className="truncate text-body font-semibold text-ink"
              data-testid="automation-detail-name"
              title={name}
            >
              {name}
            </h2>
            <p className="mt-0.5 text-meta text-ink-tertiary">
              {triggerLabel(
                automation,
                t as (key: string, opts?: Record<string, unknown>) => string,
              )}
              {!automation.enabled
                ? ` · ${t('automation.list.filterDisabled')}`
                : null}
            </p>
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            data-testid="automation-detail-close"
            onClick={onClose}
            aria-label={t('automation.run.close')}
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-meta text-ink-tertiary">
          {status ? (
            <Badge
              size="sm"
              variant={
                status === 'succeeded'
                  ? 'success'
                  : status === 'failed' || status === 'cancelled'
                    ? 'danger'
                    : status === 'waiting_user'
                      ? 'warning'
                      : status === 'running' || status === 'pending' || running
                        ? 'accent'
                        : 'default'
              }
            >
              {running && (status === 'running' || status === 'pending' || !status)
                ? t('automation.status.running')
                : t(`automation.status.${status}` as 'automation.status.succeeded')}
            </Badge>
          ) : running ? (
            <Badge size="sm" variant="accent">
              {t('automation.status.running')}
            </Badge>
          ) : null}
          {automation.nextRunAt != null && automation.trigger.kind !== 'manual' ? (
            <span title={formatAbsolute(automation.nextRunAt, locale)}>
              {t('automation.list.nextRun', {
                when: formatAbsolute(automation.nextRunAt, locale),
              })}
            </span>
          ) : (
            <span>{t('automation.list.nextManual')}</span>
          )}
          {automation.lastRunAt != null ? (
            <span title={formatAbsolute(automation.lastRunAt, locale)}>
              {t('automation.list.lastRun', {
                when: formatRelativeTime(automation.lastRunAt, locale),
              })}
            </span>
          ) : null}
        </div>

        {automation.projectPath ? (
          <p
            className="truncate text-meta text-ink-tertiary"
            title={automation.projectPath}
          >
            {automation.projectPath}
          </p>
        ) : null}

        {errorLine ? (
          <p className="text-meta text-danger" title={errorLine}>
            {errorLine}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={running}
            data-testid="automation-detail-run"
            onClick={() => onRun({ focus: false })}
          >
            <Play className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            {t('automation.list.runNow')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={running}
            data-testid="automation-detail-run-open"
            onClick={() => onRun({ focus: true })}
          >
            {t('automation.list.runAndOpen')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            data-testid="automation-detail-edit"
            onClick={onEdit}
          >
            <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
            {t('automation.list.edit')}
          </Button>
          {automation.lastSessionId ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              data-testid="automation-detail-open-session"
              onClick={openLastSession}
            >
              <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
              {t('automation.run.openSession')}
            </Button>
          ) : null}
        </div>
      </div>

      <AutomationRunHistory
        automation={automation}
        className="min-h-0 flex-1 border-0"
        hideHeader
      />
    </aside>
  )
}
