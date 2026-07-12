import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from 'react-resizable-panels'
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

export function SettingsPanel() {
  const { t } = useTranslation()
  const navRef = useRef<ImperativePanelHandle>(null)
  const navCollapsed = useUiStore((s) => s.settingsNavCollapsed)
  const setNavCollapsed = useUiStore((s) => s.setSettingsNavCollapsed)
  const settingsPage = useUiStore((s) => s.settingsPage)
  const setSettingsPage = useUiStore((s) => s.setSettingsPage)

  // 折叠态由 store 驱动（标题栏统一按钮 → settingsNavCollapsed），命令式同步到 Panel，
  // 与对话侧栏（AppLayout 同款 effect）完全一致。
  useEffect(() => {
    const p = navRef.current
    if (!p) return
    const id = setTimeout(() => {
      if (navCollapsed && !p.isCollapsed()) p.collapse()
      if (!navCollapsed && p.isCollapsed()) p.expand()
    }, 0)
    return () => clearTimeout(id)
  }, [navCollapsed])

  // 左侧分类栏完全参照「对话列表」侧栏：同色（bg-surface）、可拖拽缩放（同款 PanelResizeHandle）、
  // 且可最小化（折叠到 0，由标题栏的统一折叠按钮控制）。
  return (
    <TabsPrimitive.Root
      orientation="vertical"
      value={settingsPage}
      onValueChange={(v) => setSettingsPage(v as SettingsPageId)}
      className="h-full"
    >
      <PanelGroup direction="horizontal" className="h-full w-full">
        <Panel
          ref={navRef}
          defaultSize={18}
          minSize={13}
          maxSize={34}
          collapsible
          collapsedSize={0}
          onCollapse={() => setNavCollapsed(true)}
          onExpand={() => setNavCollapsed(false)}
        >
          <div className="flex h-full flex-col bg-surface">
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
                      'flex items-center gap-2 rounded-md px-2.5 py-2 text-body transition-colors',
                      'text-ink-secondary hover:bg-surface-muted',
                      'data-[state=active]:bg-accent-active data-[state=active]:text-accent-strong',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
                    )}
                  >
                    <Icon size={16} className="shrink-0" />
                    <span className="truncate">{t(page.labelKey)}</span>
                  </TabsPrimitive.Trigger>
                )
              })}
            </TabsPrimitive.List>
          </div>
        </Panel>

        <PanelResizeHandle className="group relative z-10 w-2 -mx-1 bg-transparent">
          <div className="mx-auto h-full w-px bg-border transition-colors group-hover:bg-accent group-data-[resize-handle-state=drag]:bg-accent" />
        </PanelResizeHandle>

        <Panel minSize={40}>
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
        </Panel>
      </PanelGroup>
    </TabsPrimitive.Root>
  )
}
