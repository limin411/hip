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
 * Second-row tab strip for the shell right rail (code ArtifactPanel / chat PreviewPanel).
 * Replaces in-panel dropdown switching with always-visible tabs.
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
      className="flex h-9 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border px-2"
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
              'relative inline-flex h-full shrink-0 items-center px-2.5 text-meta font-medium transition-colors duration-chrome',
              focusChrome,
              selected ? 'text-ink' : 'text-ink-tertiary hover:text-ink-secondary',
              // Active underline (matches TabsTrigger dialect).
              'after:absolute after:inset-x-1.5 after:bottom-0 after:h-0.5 after:rounded-full after:bg-accent after:opacity-0 after:transition-opacity after:duration-chrome',
              selected && 'after:opacity-100',
            )}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
