import { useTranslation } from 'react-i18next'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { SlidersHorizontal, Cpu, Bot, Plug, Sparkles, Package, Brain, Link2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUiStore, type SettingsPageId } from '@/store/uiStore'

import { GeneralSettings } from './GeneralSettings'
import { ModelConfig } from './ModelConfig'
import { AgentManagement } from './AgentManagement'
import { McpConfig } from './McpConfig'
import { SkillConfig } from './SkillConfig'
import { PluginConfig } from './PluginConfig'
import { HookConfig } from './HookConfig'
import { MemoryConfig } from './MemoryConfig'

const PAGES = [
  { id: 'general' as const, icon: SlidersHorizontal, labelKey: 'settings.general' as const, Component: GeneralSettings },
  { id: 'model' as const, icon: Cpu, labelKey: 'settings.model' as const, Component: ModelConfig },
  { id: 'agents' as const, icon: Bot, labelKey: 'settings.agentsLabel' as const, Component: AgentManagement },
  { id: 'mcp' as const, icon: Plug, labelKey: 'settings.mcpLabel' as const, Component: McpConfig },
  { id: 'skill' as const, icon: Sparkles, labelKey: 'settings.skillLabel' as const, Component: SkillConfig },
  { id: 'plugins' as const, icon: Package, labelKey: 'settings.pluginsLabel' as const, Component: PluginConfig },
  { id: 'hooks' as const, icon: Link2, labelKey: 'settings.hooksLabel' as const, Component: HookConfig },
  { id: 'memory' as const, icon: Brain, labelKey: 'settings.memoryLabel' as const, Component: MemoryConfig },
]

/** Fixed width for the settings category nav (not user-resizable). */
const NAV_WIDTH_CLASS = 'w-48'

export function SettingsPanel() {
  const { t } = useTranslation()
  const settingsPage = useUiStore((s) => s.settingsPage)
  const setSettingsPage = useUiStore((s) => s.setSettingsPage)

  return (
    <TabsPrimitive.Root
      orientation="vertical"
      value={settingsPage}
      onValueChange={(v) => setSettingsPage(v as SettingsPageId)}
      className="flex h-full w-full"
    >
      <div className={cn('flex h-full shrink-0 flex-col bg-surface', NAV_WIDTH_CLASS)}>
        <TabsPrimitive.List
          aria-label={t('settings.title')}
          className="flex flex-1 flex-col gap-1 overflow-y-auto p-2"
        >
          {PAGES.map((page) => {
            const Icon = page.icon
            return (
              <TabsPrimitive.Trigger
                key={page.id}
                value={page.id}
                data-testid={`settings-nav-${page.id}`}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-body font-medium transition-colors',
                  'text-ink-secondary hover:bg-state-hover hover:text-ink',
                  // Match AppSidebar session/nav selection: surface + border ring, ink text (no accent green).
                  'data-[state=active]:bg-surface data-[state=active]:text-ink data-[state=active]:shadow-[0_0_0_1px_var(--border)]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
                )}
              >
                <Icon size={16} className="shrink-0" />
                <span className="truncate">{t(page.labelKey)}</span>
              </TabsPrimitive.Trigger>
            )
          })}
        </TabsPrimitive.List>
      </div>
      <div className="w-px shrink-0 bg-border" aria-hidden data-testid="settings-nav-divider" />

      <div className="min-w-0 flex-1">
        {PAGES.map((page) => {
          const Page = page.Component
          return (
            <TabsPrimitive.Content
              key={page.id}
              value={page.id}
              className="h-full min-w-0 overflow-y-auto focus-visible:outline-none"
            >
              <Page />
            </TabsPrimitive.Content>
          )
        })}
      </div>
    </TabsPrimitive.Root>
  )
}
