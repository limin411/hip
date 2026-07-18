import { useTranslation } from 'react-i18next'
import { Check, PanelRight } from 'lucide-react'
import { useActiveSessionId } from '@/domain'
import type { ArtifactTab, ChatTab } from '@/store/uiStore'
import { useUiStore } from '@/store/uiStore'
import { useDomainStore } from '@/domain/sessionStore'
import { useDiffStore } from '@/store/diffStore'
import { Button } from '@/components/ui/Button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu'
import { CODE_TERMINAL } from '@/components/artifact/terminalFeature'

type PanelTabOption = {
  value: ArtifactTab | ChatTab
  label: string
  gated?: boolean
}

export function PanelToggle() {
  const { t } = useTranslation()
  const activeSessionId = useActiveSessionId()
  const activeView = useUiStore((s) => s.activeView)
  const activeTab = useUiStore((s) => s.activeTab)
  const setTab = useUiStore((s) => s.setTab)
  const chatActiveTab = useUiStore((s) => s.chatActiveTab)
  const setChatActiveTab = useUiStore((s) => s.setChatActiveTab)
  const setSessionCodePanelOpen = useDomainStore((s) => s.setSessionCodePanelOpen)
  const setSessionChatPanelOpen = useDomainStore((s) => s.setSessionChatPanelOpen)
  const isGitRepo =
    useDiffStore((s) => (activeSessionId ? s.bySession[activeSessionId]?.isGitRepo : false)) ?? false

  if (!activeSessionId) return null
  if (activeView !== 'code' && activeView !== 'chat') return null

  const isCode = activeView === 'code'

  const codeTabs: PanelTabOption[] = [
    { value: 'outline', label: t('artifact.outline') },
    { value: 'files', label: t('artifact.files') },
    { value: 'agents', label: t('artifact.agents') },
    { value: 'timeline', label: t('artifact.timeline'), gated: true },
    { value: 'changes', label: t('artifact.changes'), gated: true },
    ...(CODE_TERMINAL
      ? [{ value: 'terminal' as const, label: t('artifact.terminal') }]
      : []),
  ]
  const chatTabs: PanelTabOption[] = [
    { value: 'outline', label: t('artifact.outline') },
    { value: 'files', label: t('artifact.files') },
    { value: 'agents', label: t('artifact.agents') },
  ]

  const tabs = (isCode ? codeTabs : chatTabs).filter((tab) => !tab.gated || isGitRepo)
  const currentTab = isCode ? activeTab : chatActiveTab

  const onSelect = (value: ArtifactTab | ChatTab) => {
    if (isCode) {
      setTab(value as ArtifactTab)
      setSessionCodePanelOpen(activeSessionId, true)
    } else {
      setChatActiveTab(value as ChatTab)
      setSessionChatPanelOpen(activeSessionId, true)
    }
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          title={t('chat.togglePanel')}
          data-tauri-drag-region="false"
          data-no-drag
          data-testid="toggle-panel"
        >
          <PanelRight size={17} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" data-testid="panel-tab-menu">
        {tabs.map((tab) => {
          const selected = currentTab === tab.value
          return (
            <DropdownMenuItem
              key={tab.value}
              onSelect={() => onSelect(tab.value)}
              data-testid={`panel-tab-${tab.value}`}
            >
              <span className="flex w-4 shrink-0 items-center justify-center">
                {selected ? <Check size={14} className="text-accent" /> : null}
              </span>
              {tab.label}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
