import { useTranslation } from 'react-i18next'
import { Check, ChevronDown } from 'lucide-react'
import type { ArtifactTab, ChatTab } from '@/store/uiStore'
import { useUiStore } from '@/store/uiStore'
import { useDomainStore } from '@/domain/sessionStore'
import { useDiffStore } from '@/store/diffStore'
import { CODE_TERMINAL } from './terminalFeature'
import { visibleArtifactTabs, type PanelTabValue } from './visibleArtifactTabs'
import { cn } from '@/lib/utils'
import { focusChrome } from '@/components/ui/focusClasses'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu'

/**
 * Right-rail titlebar tab switcher (code ArtifactPanel / chat PreviewPanel).
 * Compact dropdown on the right edge — current page label + chevron, full list in menu.
 * Avoids a horizontal strip that clips on a narrow rail.
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

  const current: PanelTabValue = surface === 'code' ? activeTab : chatActiveTab

  const currentDef = tabs.find((tab) => tab.value === current) ?? tabs[0]
  const currentLabel = currentDef ? t(currentDef.labelKey) : ''

  const onSelect = (value: PanelTabValue) => {
    if (surface === 'code') {
      setTab(value as ArtifactTab)
    } else {
      setChatActiveTab(value as ChatTab)
    }
  }

  return (
    <div
      role="navigation"
      aria-label={t('chat.togglePanel')}
      data-testid="panel-tab-bar"
      data-tauri-drag-region="false"
      className="shrink-0"
    >
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title={currentLabel}
            aria-label={currentLabel}
            data-testid="panel-tab-trigger"
            className={cn(
              'inline-flex h-7 max-w-[10rem] items-center gap-1 rounded-sm px-2 text-meta font-medium text-ink transition-colors duration-chrome hover:bg-state-hover',
              focusChrome,
            )}
          >
            <span className="truncate">{currentLabel}</span>
            <ChevronDown size={14} strokeWidth={1.75} className="shrink-0 text-ink-tertiary" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" data-testid="panel-tab-dropdown">
          {tabs.map((tab) => {
            const selected = current === tab.value
            return (
              <DropdownMenuItem
                key={tab.value}
                onSelect={() => onSelect(tab.value)}
                data-testid={`panel-tab-${tab.value}`}
              >
                <span className="flex w-4 shrink-0 items-center justify-center">
                  {selected ? <Check size={14} className="text-accent" /> : null}
                </span>
                {t(tab.labelKey)}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
