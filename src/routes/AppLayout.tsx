import { useEffect, useRef } from 'react'
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from 'react-resizable-panels'
import { useUiStore } from '@/store/uiStore'
import { Sidebar } from '@/components/sidebar/Sidebar'
import { ChatHeader } from '@/components/chat/ChatHeader'
import { ChatPane } from '@/components/chat/ChatPane'
import { InputBar } from '@/components/chat/InputBar'
import { ArtifactPanel } from '@/components/artifact/ArtifactPanel'
import { SidebarPeek } from '@/components/sidebar/SidebarPeek'

export function AppLayout() {
  const sidebarRef = useRef<ImperativePanelHandle>(null)
  const panelRef = useRef<ImperativePanelHandle>(null)
  const collapsed = useUiStore((s) => s.collapsed)
  const panelOpen = useUiStore((s) => s.panelOpen)
  const setCollapsed = useUiStore((s) => s.setCollapsed)
  const setPanelOpen = useUiStore((s) => s.setPanelOpen)

  // 侧边栏折叠 ↔ store.collapsed 双向同步（setTimeout 避免同步死循环）
  useEffect(() => {
    const p = sidebarRef.current
    if (!p) return
    const t = setTimeout(() => {
      if (collapsed && !p.isCollapsed()) p.collapse()
      if (!collapsed && p.isCollapsed()) p.expand()
    }, 0)
    return () => clearTimeout(t)
  }, [collapsed])

  // 右侧面板开关 ↔ store.panelOpen
  useEffect(() => {
    const p = panelRef.current
    if (!p) return
    const t = setTimeout(() => {
      if (!panelOpen && !p.isCollapsed()) p.collapse()
      if (panelOpen && p.isCollapsed()) p.expand()
    }, 0)
    return () => clearTimeout(t)
  }, [panelOpen])

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-surface">
      <PanelGroup direction="horizontal">
        <Panel
          ref={sidebarRef}
          defaultSize={14}
          minSize={12}
          maxSize={22}
          collapsible
          collapsedSize={0}
          onCollapse={() => setCollapsed(true)}
          onExpand={() => setCollapsed(false)}
        >
          {!collapsed && <Sidebar />}
        </Panel>

        <PanelResizeHandle className="w-px bg-border transition-colors hover:bg-accent data-[resize-handle-state=drag]:bg-accent" />

        <Panel minSize={34}>
          <div className="flex h-full flex-col bg-surface">
            <ChatHeader />
            <ChatPane />
            <InputBar />
          </div>
        </Panel>

        <PanelResizeHandle className="w-px bg-border transition-colors hover:bg-accent data-[resize-handle-state=drag]:bg-accent" />

        <Panel
          ref={panelRef}
          defaultSize={26}
          minSize={18}
          maxSize={44}
          collapsible
          collapsedSize={0}
          onCollapse={() => setPanelOpen(false)}
          onExpand={() => setPanelOpen(true)}
        >
          <ArtifactPanel />
        </Panel>
      </PanelGroup>

      <SidebarPeek />
    </div>
  )
}
