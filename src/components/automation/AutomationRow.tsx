import { useTranslation } from 'react-i18next'
import {
  MoreHorizontal,
  Pencil,
  Play,
  Trash2,
  MessageSquare,
  ExternalLink,
  TriangleAlert,
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
import { useSkillsStore } from '@/store/skillsStore'
import { formatAbsolute, formatRelativeTime } from '@/lib/datetime'
import { cn } from '@/lib/utils'

export type AutomationRowProps = {
  automation: Automation
  onToggle: (enabled: boolean) => void
  onRun: (opts?: { focus?: boolean }) => void
  onEdit: () => void
  onDelete: () => void
  onOpenLastSession?: () => void
  /** Select row to show detail panel. */
  onSelect?: () => void
  selected?: boolean
  running?: boolean
  /** Enabled scheduled job but tray/quit makes fire unreliable. */
  scheduleUnreliable?: boolean
}

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
  t: (
    key:
      | (typeof WEEKDAY_KEYS)[number]
      | 'automation.trigger.manual'
      | 'automation.trigger.dailyAt'
      | 'automation.trigger.weeklyAt',
    opts?: Record<string, unknown>,
  ) => string,
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

/** Skill honesty chips: missing / disabled (does not block Run). */
function SkillHonestyChips({ skillIds }: { skillIds: string[] }) {
  const { t } = useTranslation()
  const skills = useSkillsStore((s) => s.skills)
  const enabled = useSkillsStore((s) => s.enabled)

  if (skillIds.length === 0) return null

  const chips: { id: string; kind: 'missing' | 'disabled' }[] = []
  for (const id of skillIds) {
    const meta = skills.find((s) => s.id === id)
    if (!meta) {
      chips.push({ id, kind: 'missing' })
    } else if (enabled[id] === false) {
      chips.push({ id, kind: 'disabled' })
    }
  }
  if (chips.length === 0) return null

  return (
    <>
      {chips.map((c) => (
        <Badge
          key={`${c.kind}-${c.id}`}
          size="sm"
          variant="warning"
          data-testid={`automation-skill-chip-${c.kind}-${c.id}`}
          title={c.id}
        >
          {c.kind === 'missing'
            ? t('automation.skillMissing')
            : t('automation.skillDisabled')}
        </Badge>
      ))}
    </>
  )
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
        'group flex items-start gap-3 border-b border-border px-3 py-2.5 last:border-b-0',
        'transition-colors duration-chrome',
        selected ? 'bg-state-active' : 'hover:bg-state-hover/50',
        onSelect && 'cursor-pointer',
        !automation.enabled && 'opacity-90',
      )}
    >
      <div
        className="pt-0.5"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <Switch
          checked={automation.enabled}
          onCheckedChange={onToggle}
          ariaLabel={t('automation.list.enableAria', { name })}
          data-testid={`automation-enable-${automation.id}`}
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-body font-medium',
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
        </div>

        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-meta text-ink-tertiary">
          <span>{triggerLabel(automation, t as Parameters<typeof triggerLabel>[1])}</span>
          <span data-testid={`automation-next-${automation.id}`}>
            {automation.trigger.kind === 'manual'
              ? t('automation.list.nextManual')
              : t('automation.list.nextRun', {
                  when:
                    automation.nextRunAt != null
                      ? formatAbsolute(automation.nextRunAt, locale)
                      : '—',
                })}
          </span>
          {automation.lastRunAt != null ? (
            <span
              data-testid={`automation-last-${automation.id}`}
              title={formatAbsolute(automation.lastRunAt, locale)}
            >
              {t('automation.list.lastRun', {
                when: formatRelativeTime(automation.lastRunAt, locale),
              })}
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
          {automation.projectPath ? (
            <span className="max-w-[14rem] truncate" title={automation.projectPath}>
              {automation.projectPath}
            </span>
          ) : null}
          {automation.skillIds?.length ? (
            <SkillHonestyChips skillIds={automation.skillIds} />
          ) : null}
        </div>

        {errorLine ? (
          <p
            className="mt-0.5 truncate text-meta text-danger"
            title={errorLine}
            data-testid={`automation-error-${automation.id}`}
          >
            {errorLine}
          </p>
        ) : null}
      </div>

      <div
        className="flex shrink-0 items-center gap-1 pt-0.5"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
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

        <DropdownMenu>
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
  )
}
