import { useTranslation } from 'react-i18next'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import {
  SlidersHorizontal,
  Cpu,
  Bot,
  Plug,
  Cable,
  Sparkles,
  Package,
  Brain,
  Link2,
  Mic,
  AppWindow,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUiStore, type SettingsPageId } from '@/store/uiStore'
import { VOICE_INPUT } from '@/components/chat/voiceFeature'

import { GeneralSettings } from './GeneralSettings'
import { VoiceSettings } from './VoiceSettings'
import { WindowSettings } from './WindowSettings'
import { ModelConfig } from './ModelConfig'
import { AgentManagement } from './AgentManagement'
import { McpConfig } from './McpConfig'
import { ConnectorsSettings } from './ConnectorsSettings'
import { SkillConfig } from './SkillConfig'
import { PluginConfig } from './PluginConfig'
import { HookConfig } from './HookConfig'
import { MemoryConfig } from './MemoryConfig'

type SettingsPageDef = {
  id: SettingsPageId
  icon: typeof SlidersHorizontal
  labelKey:
    | 'settings.general'
    | 'settings.voicePage'
    | 'settings.window'
    | 'settings.model'
    | 'settings.agentsLabel'
    | 'settings.mcpLabel'
    | 'settings.connectorsLabel'
    | 'settings.skillLabel'
    | 'settings.pluginsLabel'
    | 'settings.hooksLabel'
    | 'settings.memoryLabel'
  Component: () => React.JSX.Element
}

type SettingsNavGroup = {
  id: 'basics' | 'agents'
  labelKey: 'settings.groups.basics' | 'settings.groups.agents'
  pages: SettingsPageDef[]
}

/** Grouped settings nav (order is the product IA). */
const NAV_GROUPS: SettingsNavGroup[] = [
  {
    id: 'basics',
    labelKey: 'settings.groups.basics',
    pages: [
      { id: 'general', icon: SlidersHorizontal, labelKey: 'settings.general', Component: GeneralSettings },
      ...(VOICE_INPUT
        ? ([
            {
              id: 'voice',
              icon: Mic,
              labelKey: 'settings.voicePage',
              Component: VoiceSettings,
            },
          ] as SettingsPageDef[])
        : []),
      { id: 'window', icon: AppWindow, labelKey: 'settings.window', Component: WindowSettings },
      { id: 'model', icon: Cpu, labelKey: 'settings.model', Component: ModelConfig },
      { id: 'connectors', icon: Cable, labelKey: 'settings.connectorsLabel', Component: ConnectorsSettings },
      { id: 'memory', icon: Brain, labelKey: 'settings.memoryLabel', Component: MemoryConfig },
    ],
  },
  {
    id: 'agents',
    labelKey: 'settings.groups.agents',
    pages: [
      { id: 'agents', icon: Bot, labelKey: 'settings.agentsLabel', Component: AgentManagement },
      { id: 'mcp', icon: Plug, labelKey: 'settings.mcpLabel', Component: McpConfig },
      { id: 'skill', icon: Sparkles, labelKey: 'settings.skillLabel', Component: SkillConfig },
      { id: 'plugins', icon: Package, labelKey: 'settings.pluginsLabel', Component: PluginConfig },
      { id: 'hooks', icon: Link2, labelKey: 'settings.hooksLabel', Component: HookConfig },
    ],
  },
]

const PAGES = NAV_GROUPS.flatMap((g) => g.pages)

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
      <div className={cn('flex h-full shrink-0 flex-col bg-surface-subtle/40', NAV_WIDTH_CLASS)}>
        <TabsPrimitive.List
          aria-label={t('settings.title')}
          className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2"
        >
          {NAV_GROUPS.map((group, groupIndex) => (
            <div key={group.id} role="group" aria-labelledby={`settings-nav-group-${group.id}`}>
              <div
                id={`settings-nav-group-${group.id}`}
                data-testid={`settings-nav-group-${group.id}`}
                className={cn(
                  'px-2.5 pb-1 text-caption font-medium tracking-wide text-ink-tertiary',
                  groupIndex === 0 ? 'pt-1' : 'pt-3',
                )}
              >
                {t(group.labelKey)}
              </div>
              <div className="flex flex-col gap-0.5">
                {group.pages.map((page) => {
                  const Icon = page.icon
                  return (
                    <TabsPrimitive.Trigger
                      key={page.id}
                      value={page.id}
                      data-testid={`settings-nav-${page.id}`}
                      className={cn(
                        'relative flex h-[var(--row-h-sidebar)] w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-body font-medium transition-colors duration-chrome',
                        'text-ink-secondary hover:bg-state-hover hover:text-ink',
                        // Quiet lift + Sage rail — same signal as AppSidebar (no hairline ring).
                        'before:absolute before:inset-y-1.5 before:left-0 before:w-[2px] before:rounded-full before:bg-accent before:opacity-0',
                        'data-[state=active]:bg-state-hover data-[state=active]:text-ink data-[state=active]:before:opacity-100',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
                      )}
                    >
                      <Icon size={16} strokeWidth={1.75} className="shrink-0 opacity-70" />
                      <span className="truncate">{t(page.labelKey)}</span>
                    </TabsPrimitive.Trigger>
                  )
                })}
              </div>
            </div>
          ))}
        </TabsPrimitive.List>
      </div>
      <div className="w-px shrink-0 bg-border" aria-hidden data-testid="settings-nav-divider" />

      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {PAGES.map((page) => {
          const Page = page.Component
          // Full-height market pages (MCP / plugins) manage their own scroll inside
          // overflow-hidden roots so title actions stay pinned. Long form pages
          // (general, model, …) still scroll via overflow-y-auto here.
          return (
            <TabsPrimitive.Content
              key={page.id}
              value={page.id}
              className="h-full min-h-0 min-w-0 overflow-y-auto focus-visible:outline-none"
            >
              <Page />
            </TabsPrimitive.Content>
          )
        })}
      </div>
    </TabsPrimitive.Root>
  )
}
