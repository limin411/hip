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
import { OfficeScene } from './OfficeScene'
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

  const shortcuts = (
    <>
      <ShortcutButton
        testId="workbench-shortcut-continue"
        disabled={!lastSession}
        onClick={() => {
          if (lastSession) sessionService.selectSession(lastSession.id)
        }}
      >
        {lastSession
          ? t('workbench.shortcuts.continueSession', {
              title: truncateTitle(lastSession.title?.trim() || t('chat.newChat')),
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
    </>
  )

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      data-testid="workbench-page"
    >
      <OfficeScene
        zones={zones}
        hero={heroBase}
        heroTitle={t(heroCopy.titleKey)}
        heroSubtitle={t(heroCopy.subtitleKey)}
        showCartoon={showCartoon}
        reduceMotion={reduceMotion}
        selectedId={selectedId}
        onOpenZone={handleOpenZone}
        shortcuts={shortcuts}
      />
    </div>
  )
}

function truncateTitle(title: string, max = 28): string {
  if (title.length <= max) return title
  return `${title.slice(0, max - 1)}…`
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
