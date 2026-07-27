import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageSquare, X } from 'lucide-react'
import type {
  Automation,
  AutomationRun,
  AutomationRunStatus,
  AutomationRunTrigger,
} from '@/domain/automations'
import { sessionService } from '@/domain'
import { useAutomationStore } from '@/store/automationStore'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { cn } from '@/lib/utils'

/** UI shows a capped recent list even though store may keep up to PER_AUTO_RUNS_MAX. */
const RECENT_RUNS_UI_MAX = 20

export type AutomationRunHistoryProps = {
  automation: Automation
  onClose?: () => void
  className?: string
}

function statusVariant(
  status: AutomationRunStatus,
): 'default' | 'success' | 'warning' | 'danger' | 'accent' {
  switch (status) {
    case 'succeeded':
      return 'success'
    case 'failed':
    case 'cancelled':
      return 'danger'
    case 'running':
    case 'pending':
      return 'accent'
    case 'waiting_user':
      return 'warning'
    case 'skipped':
      return 'default'
    default:
      return 'default'
  }
}

function formatWhen(ms: number, locale: string): string {
  try {
    return new Date(ms).toLocaleString(locale, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return new Date(ms).toLocaleString()
  }
}

function triggerLabel(
  trigger: AutomationRunTrigger,
  t: (key: string) => string,
): string {
  switch (trigger) {
    case 'manual':
      return t('automation.run.triggerManual')
    case 'schedule':
      return t('automation.run.triggerSchedule')
    case 'catchup':
      return t('automation.run.triggerCatchup')
    default:
      return trigger
  }
}

function reasonCopy(
  run: AutomationRun,
  t: (key: string, opts?: { defaultValue?: string }) => string,
): string | null {
  if (!run.error) return null
  // Skip / known error codes map to i18n; free-form session errors show as-is.
  if (run.status === 'skipped' || run.status === 'failed') {
    return t(`automation.skipReasons.${run.error}`, {
      defaultValue: run.error,
    })
  }
  return run.error
}

/**
 * Recent runs for one automation (from automationStore.runs).
 * Click a run with sessionId → sessionService.selectSession (opens chat/code).
 */
export function AutomationRunHistory({
  automation,
  onClose,
  className,
}: AutomationRunHistoryProps) {
  const { t, i18n } = useTranslation()
  const runs = useAutomationStore((s) => s.runs)
  const name = automation.name.trim() || t('automation.untitled')
  const locale = i18n.language || 'en'

  const recent = useMemo(() => {
    return runs
      .filter((r) => r.automationId === automation.id)
      .slice()
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, RECENT_RUNS_UI_MAX)
  }, [runs, automation.id])

  const openSession = (sessionId: string) => {
    sessionService.selectSession(sessionId)
  }

  return (
    <aside
      className={cn(
        'flex min-h-0 w-full flex-col border-border bg-surface',
        className,
      )}
      data-testid="automation-run-history"
      aria-label={t('automation.run.history')}
    >
      <div className="flex shrink-0 items-start gap-2 border-b border-border px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-body font-semibold text-ink">
            {t('automation.run.history')}
          </h2>
          <p
            className="truncate text-meta text-ink-tertiary"
            data-testid="automation-run-history-name"
            title={name}
          >
            {name}
          </p>
        </div>
        {onClose ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            data-testid="automation-run-history-close"
            onClick={onClose}
            aria-label={t('automation.run.close')}
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
          </Button>
        ) : null}
      </div>

      {recent.length === 0 ? (
        <EmptyState
          tier="professional"
          title={t('automation.run.noRuns')}
          className="flex-1"
          data-testid="automation-run-history-empty"
        />
      ) : (
        <ul
          className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2"
          data-testid="automation-run-history-list"
        >
          {recent.map((run) => {
            const reason = reasonCopy(run, t as Parameters<typeof reasonCopy>[1])
            const hasSession = Boolean(run.sessionId)
            const interactive = hasSession

            return (
              <li key={run.id}>
                <button
                  type="button"
                  data-testid={`automation-run-row-${run.id}`}
                  data-status={run.status}
                  data-session-id={run.sessionId ?? undefined}
                  disabled={!interactive}
                  onClick={() => {
                    if (run.sessionId) openSession(run.sessionId)
                  }}
                  title={
                    hasSession
                      ? t('automation.run.openSession')
                      : reason ?? undefined
                  }
                  className={cn(
                    'flex w-full flex-col gap-1 rounded-md border border-border bg-surface-subtle px-2.5 py-2 text-left',
                    'transition-colors duration-chrome',
                    interactive
                      ? 'cursor-pointer hover:bg-state-hover/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40'
                      : 'cursor-default opacity-90',
                  )}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge
                      size="sm"
                      variant={statusVariant(run.status)}
                      data-testid={`automation-run-status-${run.id}`}
                    >
                      {t(
                        `automation.status.${run.status}` as 'automation.status.succeeded',
                      )}
                    </Badge>
                    <Badge size="sm" variant="default">
                      {triggerLabel(
                        run.trigger,
                        t as (key: string) => string,
                      )}
                    </Badge>
                    {hasSession ? (
                      <span className="ml-auto inline-flex items-center gap-1 text-meta text-ink-secondary">
                        <MessageSquare
                          className="h-3 w-3 shrink-0"
                          strokeWidth={1.75}
                          aria-hidden
                        />
                        {t('automation.run.openSession')}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-baseline gap-x-2 text-meta text-ink-tertiary">
                    <time dateTime={new Date(run.startedAt).toISOString()}>
                      {formatWhen(run.startedAt, locale)}
                    </time>
                    {run.finishedAt != null &&
                    run.finishedAt !== run.startedAt ? (
                      <span>
                        → {formatWhen(run.finishedAt, locale)}
                      </span>
                    ) : null}
                  </div>
                  {reason ? (
                    <p
                      className="text-meta text-ink-secondary"
                      data-testid={`automation-run-reason-${run.id}`}
                    >
                      {reason}
                    </p>
                  ) : null}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </aside>
  )
}
