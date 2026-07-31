import { useTranslation } from 'react-i18next'
import type { ArtifactTab, ChatTab } from '@/store/uiStore'
import { useUiStore } from '@/store/uiStore'
import { useDomainStore } from '@/domain/sessionStore'
import { useDiffStore } from '@/store/diffStore'
import { CODE_TERMINAL } from './terminalFeature'
import { visibleArtifactTabs, type PanelTabValue } from './visibleArtifactTabs'
import { cn } from '@/lib/utils'
import { focusChrome } from '@/components/ui/focusClasses'

/**
 * Tab strip for the shell right rail titlebar (code ArtifactPanel / chat PreviewPanel).
 * Sits in the first row beside collapse / branch controls; selected tab uses a rounded wash.
 */
export function PanelTabBar({ surface }: { surface: 'code' | 'chat' }) {
  const { t } = useTranslation()
  const sid = useDomainStore((s) => s.activeSessionId)
  const isGitRepo = useDiffStore((s) => (sid ? s.bySession[sid]?.isGitRepo : false)) ?? false
  const activeTab = useUiStore((s) => s.activeTab)
  const setTab = useUiStore((s) => s.setTab)
  const chatActiveTab = useUiStore((s) => s.chatActiveTab)
  const setChatActiveTab = useUiStore((s) => s.setChatActiveTab)

  const tabs = visibleArtifactTabs({
    surface,
    isGitRepo,
    codeTerminal: CODE_TERMINAL,
  }).filter((tab) => !tab.gated)

  const current: PanelTabValue =
    surface === 'code'
      ? activeTab === 'tasks'
        ? 'agents'
        : activeTab
      : chatActiveTab === 'tasks'
        ? 'agents'
        : chatActiveTab

  const onSelect = (value: PanelTabValue) => {
    if (surface === 'code') {
      setTab(value as ArtifactTab)
    } else {
      setChatActiveTab(value as ChatTab)
    }
  }

  return (
    <div
      role="tablist"
      aria-label={t('chat.togglePanel')}
      data-testid="panel-tab-bar"
      data-tauri-drag-region="false"
      className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
    >
      {tabs.map((tab) => {
        const selected = current === tab.value
        const label = t(tab.labelKey)
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={selected}
            data-testid={`panel-tab-${tab.value}`}
            onClick={() => onSelect(tab.value)}
            className={cn(
              'inline-flex h-7 shrink-0 items-center rounded-md px-2.5 text-meta font-medium transition-colors duration-chrome',
              focusChrome,
              selected
                ? 'bg-state-active text-ink'
                : 'text-ink-tertiary hover:bg-state-hover hover:text-ink-secondary',
            )}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
