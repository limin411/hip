import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { sessionService, useDomainStore } from '@/domain'
import { useUiStore } from '@/store/uiStore'
import {
  enterAutomationsSection,
  enterKnowledge,
  enterSection,
  enterTerminalsSection,
  enterWorkItemsSection,
} from '@/components/layout/sidebarActions'
import { AUTOMATION_PAGE } from '@/components/automation/feature'
import { TERMINAL_MANAGEMENT } from '@/components/terminals/feature'
import { WORK_ITEM_TRACKING } from '@/components/work-items/feature'
import { cn } from '@/lib/utils'
import { ZoneCard } from './ZoneCard'
import { WorkbenchMascot } from './WorkbenchMascot'
import { aggregateHero, buildZoneModels } from './zoneProgress'
import { useWorkbenchSnapshot } from './useWorkbenchSnapshot'
import { resolveHeroCopy } from './heroGreeting'
import type { ZoneModel } from './workbenchTypes'

async function openZone(zone: ZoneModel): Promise<void> {
  switch (zone.id) {
    case 'sessions': {
      const domain = useDomainStore.getState()
      const last =
        domain.sessions.find((s) => s.id === domain.activeSessionId) ??
        [...domain.sessions].sort((a, b) => b.updatedAtMs - a.updatedAtMs)[0]
      if (last && zone.hrefHint === 'last-session') {
        sessionService.selectSession(last.id)
        return
      }
      await enterSection('chats')
      return
    }
    case 'tasks':
      if (WORK_ITEM_TRACKING) await enterWorkItemsSection()
      else useUiStore.getState().setActiveView('tasks')
      return
    case 'automations':
      if (AUTOMATION_PAGE) await enterAutomationsSection()
      else useUiStore.getState().setActiveView('automation')
      return
    case 'knowledge':
      await enterKnowledge()
      return
    case 'terminals':
      if (TERMINAL_MANAGEMENT) await enterTerminalsSection({ library: true })
      else useUiStore.getState().setActiveView('terminals')
      return
    case 'workflows':
      if (AUTOMATION_PAGE) await enterAutomationsSection()
      return
    default:
      useUiStore.getState().setActiveView(zone.hrefView)
  }
}

export function WorkbenchPage() {
  const { t } = useTranslation()
  const snap = useWorkbenchSnapshot()
  const sessions = useDomainStore((s) => s.sessions)
  const activeSessionId = useDomainStore((s) => s.activeSessionId)

  const showCartoon = useUiStore((s) => s.workbenchShowCartoon)
  const reduceMotion = useUiStore((s) => s.workbenchReduceMotion)

  const [selectedId, setSelectedId] = useState<string | null>(null)

  const zones = useMemo(() => buildZoneModels(snap), [snap])
  const heroBase = useMemo(() => aggregateHero(zones), [zones])
  const heroCopy = useMemo(
    () => resolveHeroCopy(heroBase.state, heroBase.titleKey, heroBase.subtitleKey),
    [heroBase],
  )

  const lastSession =
    sessions.find((s) => s.id === activeSessionId) ??
    [...sessions].sort((a, b) => b.updatedAtMs - a.updatedAtMs)[0] ??
    null

  const handleOpenZone = (zone: ZoneModel) => {
    setSelectedId(zone.id)
    void openZone(zone)
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-auto"
      data-testid="workbench-page"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-5 pb-10">
        <section
          className={cn(
            'grid items-center gap-4 rounded-xl border border-border bg-surface p-4 shadow-panel',
            'sm:grid-cols-[auto_1fr_auto]',
          )}
          aria-label={t('workbench.hero.region')}
          data-testid="workbench-hero"
        >
          {showCartoon ? (
            <WorkbenchMascot
              action={heroBase.mascotAction}
              size={72}
              forceStatic={reduceMotion}
            />
          ) : (
            <div className="h-[72px] w-[72px]" aria-hidden />
          )}
          <div className="min-w-0">
            <h1 className="text-title font-semibold tracking-tight text-ink">
              {t(heroCopy.titleKey)}
            </h1>
            <p className="mt-0.5 text-meta text-ink-secondary">{t(heroCopy.subtitleKey)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <MetricPill
              value={heroBase.runningCount}
              label={t('workbench.metrics.running')}
              testId="workbench-metric-running"
            />
            <MetricPill
              value={heroBase.attentionCount}
              label={t('workbench.metrics.attention')}
              testId="workbench-metric-attention"
            />
            <MetricPill
              value={heroBase.doneCount}
              label={t('workbench.metrics.done')}
              testId="workbench-metric-done"
            />
          </div>
        </section>

        <div className="grid gap-5 lg:grid-cols-[1fr_260px]">
          <section aria-label={t('workbench.zonesRegion')} className="min-w-0">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {zones.map((zone) => (
                <ZoneCard
                  key={zone.id}
                  zone={zone}
                  showCartoon={showCartoon}
                  forceStatic={reduceMotion}
                  selected={selectedId === zone.id}
                  onOpen={handleOpenZone}
                />
              ))}
            </div>
          </section>

          <aside
            className="flex h-fit flex-col gap-2 rounded-xl border border-border bg-surface-subtle p-3"
            aria-label={t('workbench.shortcuts.title')}
            data-testid="workbench-shortcuts"
          >
            <div className="px-1 text-meta font-semibold text-ink">
              {t('workbench.shortcuts.title')}
            </div>
            <ShortcutButton
              testId="workbench-shortcut-continue"
              disabled={!lastSession}
              onClick={() => {
                if (lastSession) sessionService.selectSession(lastSession.id)
              }}
            >
              {lastSession
                ? t('workbench.shortcuts.continueSession', {
                    title: truncateTitle(
                      lastSession.title?.trim() || t('chat.newChat'),
                    ),
                  })
                : t('workbench.shortcuts.continueSessionEmpty')}
            </ShortcutButton>
            <ShortcutButton
              testId="workbench-shortcut-new-chat"
              onClick={() => void enterSection('chats')}
            >
              {t('workbench.shortcuts.newChat')}
            </ShortcutButton>
            <ShortcutButton
              testId="workbench-shortcut-knowledge"
              onClick={() => void enterKnowledge()}
            >
              {t('workbench.shortcuts.openKnowledge')}
            </ShortcutButton>
            {WORK_ITEM_TRACKING && (
              <ShortcutButton
                testId="workbench-shortcut-tasks"
                onClick={() => void enterWorkItemsSection()}
              >
                {t('workbench.shortcuts.openTasks')}
              </ShortcutButton>
            )}
            {AUTOMATION_PAGE && (
              <ShortcutButton
                testId="workbench-shortcut-automation"
                onClick={() => void enterAutomationsSection()}
              >
                {t('workbench.shortcuts.openAutomations')}
              </ShortcutButton>
            )}
            {TERMINAL_MANAGEMENT && (
              <ShortcutButton
                testId="workbench-shortcut-terminals"
                onClick={() => void enterTerminalsSection({ library: true })}
              >
                {t('workbench.shortcuts.openTerminals')}
              </ShortcutButton>
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}

function truncateTitle(title: string, max = 28): string {
  if (title.length <= max) return title
  return `${title.slice(0, max - 1)}…`
}

function MetricPill({
  value,
  label,
  testId,
}: {
  value: number
  label: string
  testId: string
}) {
  return (
    <div
      className="min-w-[4.5rem] rounded-xl border border-border bg-surface-subtle px-3 py-2 text-center"
      data-testid={testId}
    >
      <div className="text-title font-semibold tracking-tight text-ink">{value}</div>
      <div className="text-[11px] text-ink-tertiary">{label}</div>
    </div>
  )
}

function ShortcutButton({
  children,
  onClick,
  disabled,
  testId,
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  testId: string
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'rounded-lg px-3 py-2 text-left text-meta font-medium text-ink',
        'hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent',
      )}
    >
      {children}
    </button>
  )
}
