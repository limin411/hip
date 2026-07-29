import { useMemo, useState } from 'react'
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
import { HomeShell } from './home/HomeShell'
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
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const zones = useMemo(() => buildZoneModels(snap), [snap])
  const heroBase = useMemo(() => aggregateHero(zones), [zones])
  const heroCopy = useMemo(
    () => resolveHeroCopy(heroBase.state, heroBase.titleKey, heroBase.subtitleKey),
    [heroBase],
  )

  const handleOpenZone = (zone: ZoneModel) => {
    setSelectedId(zone.id)
    void openZone(zone)
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      data-testid="workbench-page"
    >
      <HomeShell
        zones={zones}
        hero={heroBase}
        heroTitle={t(heroCopy.titleKey)}
        heroSubtitle={t(heroCopy.subtitleKey)}
        selectedId={selectedId}
        onOpenZone={handleOpenZone}
      />
    </div>
  )
}
