/**
 * Sidebar list of enabled automations.
 * Rendered by AppSidebar when AUTOMATION_PAGE && sidebarSection === 'automation'.
 */
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Zap } from 'lucide-react'
import type { Automation } from '@/domain/automations'
import { cn } from '@/lib/utils'
import { isInFlight, useAutomationStore } from '@/store/automationStore'
import { useUiStore } from '@/store/uiStore'
import { SIDEBAR_ACTIVE_RAIL } from '@/components/layout/sidebarActiveRail'
import { enterAutomationsSection } from '@/components/layout/sidebarActions'

const WEEKDAY_KEYS = [
  'automation.weekday.0',
  'automation.weekday.1',
  'automation.weekday.2',
  'automation.weekday.3',
  'automation.weekday.4',
  'automation.weekday.5',
  'automation.weekday.6',
] as const

function triggerSubtitle(
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

function sortEnabled(a: Automation, b: Automation): number {
  const aRun = isInFlight(a.id) ? 0 : 1
  const bRun = isInFlight(b.id) ? 0 : 1
  if (aRun !== bRun) return aRun - bRun
  const aNext = a.nextRunAt ?? Number.POSITIVE_INFINITY
  const bNext = b.nextRunAt ?? Number.POSITIVE_INFINITY
  if (aNext !== bNext) return aNext - bNext
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
}

export function AutomationSidebarList() {
  const { t } = useTranslation()
  const loaded = useAutomationStore((s) => s.loaded)
  const load = useAutomationStore((s) => s.load)
  const automations = useAutomationStore((s) => s.automations)
  const selectedId = useAutomationStore((s) => s.selectedId)
  const select = useAutomationStore((s) => s.select)
  const activeView = useUiStore((s) => s.activeView)
  // Poll so in-flight claim shows as "running" without a dedicated store field.
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!useAutomationStore.getState().loaded) {
      void load()
    }
  }, [load])

  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [])

  const enabled = useMemo(() => {
    void tick
    return automations.filter((a) => a.enabled).slice().sort(sortEnabled)
  }, [automations, tick])

  if (!loaded && automations.length === 0) {
    return (
      <p
        className="px-2 py-4 text-center text-meta text-ink-tertiary"
        role="status"
        data-testid="sidebar-automations-loading"
      >
        {t('automation.loading')}
      </p>
    )
  }

  if (enabled.length === 0) {
    return (
      <div
        className="flex flex-col items-center gap-1 px-3 py-6 text-center"
        role="status"
        data-testid="sidebar-automations-empty"
      >
        <p className="text-meta text-ink-tertiary">{t('sidebar.emptyAutomations')}</p>
        <p className="text-caption leading-relaxed text-ink-tertiary/80">
          {t('sidebar.automationsHint')}
        </p>
      </div>
    )
  }

  return (
    <ul
      className="m-0 list-none p-0"
      aria-labelledby="sidebar-list-heading"
      data-testid="sidebar-automations"
    >
      {enabled.map((a) => {
        const active = selectedId === a.id && activeView === 'automation'
        const running = isInFlight(a.id)
        const name = a.name.trim() || t('automation.untitled')
        const status = a.lastStatus
        return (
          <li key={a.id}>
            <button
              type="button"
              data-testid={`sidebar-automation-${a.id}`}
              data-no-drag
              aria-current={active ? 'true' : undefined}
              onClick={() => {
                select(a.id)
                if (activeView !== 'automation') {
                  void enterAutomationsSection()
                }
              }}
              className={cn(
                'mb-0.5 flex w-full items-start gap-2 rounded-lg px-2.5 py-[var(--row-pad-y-session)] text-left transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
                active ? SIDEBAR_ACTIVE_RAIL : 'hover:bg-state-hover',
              )}
            >
              <span
                className={cn(
                  'mt-1.5 size-1.5 shrink-0 rounded-full',
                  active || running ? 'bg-accent' : 'bg-transparent',
                )}
                aria-hidden
              />
              <Zap
                size={14}
                className={cn(
                  'mt-0.5 shrink-0',
                  running ? 'text-accent' : 'text-ink-tertiary',
                )}
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-medium text-ink">
                  {name}
                </span>
                <span className="block truncate text-caption text-ink-tertiary">
                  {triggerSubtitle(a, t)}
                  {running
                    ? ` · ${t('sidebar.status.running')}`
                    : status
                      ? ` · ${t(`automation.status.${status}` as 'automation.status.succeeded')}`
                      : ''}
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
