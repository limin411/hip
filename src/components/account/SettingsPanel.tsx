import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from 'react-resizable-panels'
import { SlidersHorizontal, Cpu, Bot } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/store/uiStore'
import { GeneralSettings } from './GeneralSettings'
import { ModelConfig } from './ModelConfig'
import { AgentManagement } from './AgentManagement'

const PAGES = [
  { id: 'general', icon: SlidersHorizontal, labelKey: 'settings.general', Component: GeneralSettings },
  { id: 'model', icon: Cpu, labelKey: 'settings.model', Component: ModelConfig },
  { id: 'agents', icon: Bot, labelKey: 'settings.agentsLabel', Component: AgentManagement },
] as const

export function SettingsPanel() {
  const { t } = useTranslation()
  const navRef = useRef<ImperativePanelHandle>(null)
  const navCollapsed = useUiStore((s) => s.settingsNavCollapsed)
  const setNavCollapsed = useUiStore((s) => s.setSettingsNavCollapsed)

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
    <TabsPrimitive.Root orientation="vertical" defaultValue="general" className="h-full">
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
          <TabsPrimitive.List
            aria-label={t('settings.title')}
            className="flex h-full flex-col gap-1 overflow-y-auto bg-surface p-2"
          >
            {PAGES.map((page) => {
              const Icon = page.icon
              return (
                <TabsPrimitive.Trigger
                  key={page.id}
                  value={page.id}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2.5 py-2 text-body transition-colors',
                    'text-ink-secondary hover:bg-surface-muted',
                    'data-[state=active]:bg-accent-active data-[state=active]:font-medium data-[state=active]:text-accent-strong',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
                  )}
                >
                  <Icon size={16} className="shrink-0" />
                  <span className="truncate">{t(page.labelKey)}</span>
                </TabsPrimitive.Trigger>
              )
            })}
          </TabsPrimitive.List>
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
