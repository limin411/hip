import { useTranslation } from 'react-i18next'
import {
  CalendarClock,
  Clock,
  FolderGit2,
  Hand,
  MoreHorizontal,
  Pencil,
  Play,
  Trash2,
  MessageSquare,
  ExternalLink,
  TriangleAlert,
  Zap,
} from 'lucide-react'
import type { Automation, AutomationRunStatus } from '@/domain/automations'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Switch } from '@/components/ui/Switch'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu'
import { formatAbsolute, formatRelativeTime } from '@/lib/datetime'
import { cn } from '@/lib/utils'

export type AutomationRowProps = {
  automation: Automation
  onToggle: (enabled: boolean) => void
  onRun: (opts?: { focus?: boolean }) => void
  onEdit: () => void
  onDelete: () => void
  onOpenLastSession?: () => void
  /** Select card to show detail panel. */
  onSelect?: () => void
  selected?: boolean
  running?: boolean
  /** Enabled scheduled job but tray/quit makes fire unreliable. */
  scheduleUnreliable?: boolean
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

function statusVariant(
  status: AutomationRunStatus | null | undefined,
  running?: boolean,
): 'default' | 'success' | 'warning' | 'danger' | 'accent' {
  if (running) return 'accent'
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

function TriggerIcon({ kind }: { kind: Automation['trigger']['kind'] }) {
  const className = 'h-4 w-4'
  if (kind === 'daily') return <Clock className={className} strokeWidth={1.75} aria-hidden />
  if (kind === 'weekly') return <CalendarClock className={className} strokeWidth={1.75} aria-hidden />
  return <Hand className={className} strokeWidth={1.75} aria-hidden />
}

export function AutomationRow({
  automation,
  onToggle,
  onRun,
  onEdit,
  onDelete,
  onOpenLastSession,
  onSelect,
  selected,
  running,
  scheduleUnreliable = false,
}: AutomationRowProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language || 'en'
  const name = automation.name.trim() || t('automation.untitled')
  const status = automation.lastStatus
  const errorLine =
    (status === 'failed' || status === 'skipped') && automation.lastError
      ? t(
          `automation.skipReasons.${automation.lastError}` as 'automation.skipReasons.missed_over_6h',
          { defaultValue: automation.lastError },
        )
      : null

  const showScheduleWarn =
    scheduleUnreliable &&
    automation.enabled &&
    automation.trigger.kind !== 'manual'

  const statusLabel = running
    ? t('automation.status.running')
    : status
      ? t(`automation.status.${status}` as 'automation.status.succeeded')
      : null

  const scheduleLine = triggerLabel(
    automation,
    t as (key: string, opts?: Record<string, unknown>) => string,
  )

  const nextLine =
    automation.nextRunAt != null && automation.trigger.kind !== 'manual'
      ? t('automation.list.nextRun', {
          when: formatAbsolute(automation.nextRunAt, locale),
        })
      : automation.trigger.kind === 'manual'
        ? t('automation.list.nextManual')
        : null

  const lastLine =
    automation.lastRunAt != null
      ? t('automation.list.lastRun', {
          when: formatRelativeTime(automation.lastRunAt, locale),
        })
      : null

  const promptPreview = automation.prompt.trim()

  return (
    <div
      data-testid={`automation-row-${automation.id}`}
      data-selected={selected ? 'true' : undefined}
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onClick={onSelect}
      onKeyDown={
        onSelect
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelect()
              }
            }
          : undefined
      }
      className={cn(
        'group relative flex min-h-[168px] flex-col gap-3 rounded-lg border bg-surface p-4',
        'transition-[border-color,background-color,box-shadow] duration-chrome',
        selected
          ? 'border-ink bg-state-active'
          : 'border-border hover:border-border-strong hover:bg-surface-subtle',
        onSelect && 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
        running && !selected && 'border-accent/40',
        !automation.enabled && 'opacity-80',
      )}
    >
      {/* Top: icon + name + status */}
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
            running
              ? 'bg-accent/10 text-accent'
              : automation.enabled
                ? 'bg-surface-subtle text-ink-secondary'
                : 'bg-surface-muted text-ink-tertiary',
          )}
        >
          {running ? (
            <Zap className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          ) : (
            <TriggerIcon kind={automation.trigger.kind} />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start gap-2">
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-body font-semibold leading-snug',
                automation.enabled ? 'text-ink' : 'text-ink-secondary',
              )}
              data-testid={`automation-name-${automation.id}`}
              title={name}
            >
              {name}
            </span>
            {showScheduleWarn ? (
              <span
                className="shrink-0 text-warning"
                title={t('automation.banner.needTray')}
                data-testid={`automation-schedule-warn-${automation.id}`}
                aria-label={t('automation.banner.needTray')}
              >
                <TriangleAlert className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
              </span>
            ) : null}
            {statusLabel ? (
              <Badge
                size="sm"
                variant={statusVariant(status, running)}
                title={errorLine ?? automation.lastError ?? undefined}
                data-testid={`automation-status-${automation.id}`}
                className="shrink-0"
              >
                {statusLabel}
              </Badge>
            ) : null}
          </div>

          <p className="mt-1 truncate text-meta text-ink-tertiary" title={scheduleLine}>
            {scheduleLine}
            {nextLine ? ` · ${nextLine}` : null}
          </p>
        </div>
      </div>

      {/* Body: prompt + meta */}
      <div className="flex min-h-0 flex-1 flex-col gap-1.5">
        {promptPreview ? (
          <p className="line-clamp-2 text-meta leading-relaxed text-ink-secondary">
            {promptPreview}
          </p>
        ) : (
          <p className="text-meta italic text-ink-tertiary">
            {t('automation.editor.promptPlaceholder')}
          </p>
        )}

        {automation.projectPath ? (
          <p
            className="flex items-center gap-1 truncate text-caption text-ink-tertiary"
            title={automation.projectPath}
          >
            <FolderGit2 className="h-3 w-3 shrink-0" strokeWidth={1.75} aria-hidden />
            <span className="truncate">{automation.projectPath}</span>
          </p>
        ) : null}

        {lastLine ? (
          <p
            className="truncate text-caption text-ink-tertiary"
            title={
              automation.lastRunAt != null
                ? formatAbsolute(automation.lastRunAt, locale)
                : undefined
            }
          >
            {lastLine}
          </p>
        ) : null}

        {errorLine ? (
          <p
            className="truncate text-meta text-danger"
            title={errorLine}
            data-testid={`automation-error-${automation.id}`}
          >
            {errorLine}
          </p>
        ) : null}
      </div>

      {/* Footer: enable + actions */}
      <div
        className="mt-auto flex items-center justify-between gap-2 border-t border-border/60 pt-3"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <Switch
          checked={automation.enabled}
          onCheckedChange={onToggle}
          ariaLabel={t('automation.list.enableAria', { name })}
          data-testid={`automation-enable-${automation.id}`}
        />

        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            data-testid="automation-run-btn"
            disabled={running}
            onClick={() => onRun({ focus: false })}
            aria-label={t('automation.list.runNow')}
          >
            <Play className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            {t('automation.list.runNow')}
          </Button>

          {/* modal={false}: Delete opens a Dialog; stacking modal menu + dialog locks body. */}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                data-testid={`automation-more-${automation.id}`}
                aria-label={t('automation.list.moreAria', { name })}
              >
                <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" data-testid={`automation-menu-${automation.id}`}>
              <DropdownMenuItem
                data-testid={`automation-edit-${automation.id}`}
                onSelect={() => onEdit()}
              >
                <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
                {t('automation.list.edit')}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={running}
                data-testid={`automation-run-open-${automation.id}`}
                onSelect={() => onRun({ focus: true })}
              >
                <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
                {t('automation.list.runAndOpen')}
              </DropdownMenuItem>
              {automation.lastSessionId && onOpenLastSession ? (
                <DropdownMenuItem
                  data-testid={`automation-open-session-${automation.id}`}
                  onSelect={() => onOpenLastSession()}
                >
                  <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
                  {t('automation.run.openSession')}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-danger focus:text-danger"
                data-testid={`automation-delete-${automation.id}`}
                onSelect={() => onDelete()}
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
                {t('automation.list.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  )
}
