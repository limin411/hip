/**
 * Shared settings IA: category nav groups and page components.
 * Used by SettingsSidebar (left rail) and SettingsPanel (main body).
 */
import {
  AppWindow,
  Bot,
  Brain,
  Cpu,
  KeyRound,
  Link2,
  Mic,
  Package,
  Plug,
  SlidersHorizontal,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import type { SettingsPageId } from '@/store/uiStore'
import { VOICE_INPUT } from '@/components/chat/voiceFeature'

import { GeneralSettings } from './GeneralSettings'
import { VoiceSettings } from './VoiceSettings'
import { WindowSettings } from './WindowSettings'
import { ModelConfig } from './ModelConfig'
import { AgentManagement } from './AgentManagement'
import { McpConfig } from './McpConfig'
import { KeyManagementSettings } from './KeyManagementSettings'
import { SkillConfig } from './SkillConfig'
import { PluginConfig } from './PluginConfig'
import { HookConfig } from './HookConfig'
import { MemoryConfig } from './MemoryConfig'

export type SettingsPageDef = {
  id: SettingsPageId
  icon: LucideIcon
  labelKey:
    | 'settings.general'
    | 'settings.voicePage'
    | 'settings.window'
    | 'settings.model'
    | 'settings.agentsLabel'
    | 'settings.mcpLabel'
    | 'settings.keyManagementLabel'
    | 'settings.skillLabel'
    | 'settings.pluginsLabel'
    | 'settings.hooksLabel'
    | 'settings.memoryLabel'
  Component: () => React.JSX.Element
}

export type SettingsNavGroup = {
  id: 'basics' | 'agents'
  labelKey: 'settings.groups.basics' | 'settings.groups.agents'
  pages: SettingsPageDef[]
}

/** Grouped settings nav (order is the product IA). */
export const SETTINGS_NAV_GROUPS: SettingsNavGroup[] = [
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
      { id: 'keyManagement', icon: KeyRound, labelKey: 'settings.keyManagementLabel', Component: KeyManagementSettings },
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

export const SETTINGS_PAGES = SETTINGS_NAV_GROUPS.flatMap((g) => g.pages)
