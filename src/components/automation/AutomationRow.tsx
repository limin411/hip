import { useTranslation } from 'react-i18next'
import { Play, Pencil, Trash2 } from 'lucide-react'
import type { Automation, AutomationRunStatus } from '@/domain/automations'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Switch } from '@/components/ui/Switch'
import { useSkillsStore } from '@/store/skillsStore'
import { cn } from '@/lib/utils'

export type AutomationRowProps = {
  automation: Automation
  onToggle: (enabled: boolean) => void
  onRun: () => void
  onEdit: () => void
  onDelete: () => void
  /** Select row to show run history panel. */
  onSelect?: () => void
  selected?: boolean
  running?: boolean
}

function statusVariant(
  status: AutomationRunStatus | null | undefined,
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

function formatNextRun(ms: number | null | undefined, locale: string): string {
  if (ms == null) return '—'
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
  onSelect,
  selected,
  running,
}: AutomationRowProps) {
  const { t, i18n } = useTranslation()
  const name = automation.name.trim() || t('automation.untitled')
  const status = automation.lastStatus
  const skipReason =
    status === 'skipped' && automation.lastError
      ? t(
          `automation.skipReasons.${automation.lastError}` as 'automation.skipReasons.missed_over_6h',
          { defaultValue: automation.lastError },
        )
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
        'group flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5',
        'transition-colors duration-chrome hover:bg-state-hover/40',
        selected && 'border-accent/50 bg-accent/5 ring-1 ring-accent/30',
        !automation.enabled && 'opacity-70',
        onSelect && 'cursor-pointer',
      )}
    >
      <div
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
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="truncate text-left text-body font-medium text-ink hover:underline"
            onClick={(e) => {
              e.stopPropagation()
              onEdit()
            }}
            onKeyDown={(e) => e.stopPropagation()}
            data-testid={`automation-name-${automation.id}`}
          >
            {name}
          </button>
          <Badge size="sm" variant="default">
            {triggerLabel(automation, t as Parameters<typeof triggerLabel>[1])}
          </Badge>
          {status ? (
            <Badge
              size="sm"
              variant={statusVariant(status)}
              title={skipReason ?? automation.lastError ?? undefined}
              data-testid={`automation-status-${automation.id}`}
            >
              {t(`automation.status.${status}` as 'automation.status.succeeded')}
            </Badge>
          ) : null}
          {automation.skillIds?.length ? (
            <SkillHonestyChips skillIds={automation.skillIds} />
          ) : null}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-meta text-ink-tertiary">
          <span data-testid={`automation-next-${automation.id}`}>
            {automation.trigger.kind === 'manual'
              ? t('automation.list.nextManual')
              : t('automation.list.nextRun', {
                  when: formatNextRun(automation.nextRunAt, i18n.language || 'en'),
                })}
          </span>
          {automation.projectPath ? (
            <span className="truncate max-w-[16rem]" title={automation.projectPath}>
              {automation.projectPath}
            </span>
          ) : null}
        </div>
      </div>

      <div
        className="flex shrink-0 items-center gap-1"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <Button
          type="button"
          size="sm"
          variant="secondary"
          data-testid="automation-run-btn"
          disabled={running}
          onClick={onRun}
          aria-label={t('automation.list.runNow')}
        >
          <Play className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          {t('automation.list.runNow')}
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          data-testid={`automation-edit-${automation.id}`}
          onClick={onEdit}
          aria-label={t('automation.list.edit')}
        >
          <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          data-testid={`automation-delete-${automation.id}`}
          onClick={onDelete}
          aria-label={t('automation.list.delete')}
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
        </Button>
      </div>
    </div>
  )
}
