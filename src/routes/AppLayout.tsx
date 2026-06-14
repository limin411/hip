import { useEffect, useRef } from 'react'
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from 'react-resizable-panels'
import { useUiStore } from '@/store/uiStore'
import { sessionService, useActiveSessionId } from '@/domain'
import { NewConversation } from '@/components/chat/NewConversation'
import { Sidebar } from '@/components/sidebar/Sidebar'
import { ChatHeader } from '@/components/chat/ChatHeader'
import { ChatPane } from '@/components/chat/ChatPane'
import { InputBar } from '@/components/chat/InputBar'
import { ArtifactPanel } from '@/components/artifact/ArtifactPanel'
import { SidebarPeek } from '@/components/sidebar/SidebarPeek'
import { MenuRail } from '@/components/rail/MenuRail'
import { SettingsPage } from '@/components/account/SettingsPage'

export function AppLayout() {
  const sidebarRef = useRef<ImperativePanelHandle>(null)
  const collapsed = useUiStore((s) => s.collapsed)
  const panelOpen = useUiStore((s) => s.panelOpen)
  const setCollapsed = useUiStore((s) => s.setCollapsed)
  const setPanelOpen = useUiStore((s) => s.setPanelOpen)
  const activeView = useUiStore((s) => s.activeView)
  const activeSessionId = useActiveSessionId()

  useEffect(() => {
    sessionService.connect()
    return () => sessionService.disconnect()
  }, [])

  useEffect(() => {
    const p = sidebarRef.current
    if (!p) return
    const t = setTimeout(() => {
      if (collapsed && !p.isCollapsed()) p.collapse()
      if (!collapsed && p.isCollapsed()) p.expand()
    }, 0)
    return () => clearTimeout(t)
  }, [collapsed])

  return (
    <div className="relative flex h-dvh w-screen overflow-hidden bg-surface">
      <MenuRail />
      <div className="relative min-w-0 flex-1">
        <PanelGroup direction="horizontal" className="h-full w-full">
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
          {!collapsed && (
            <div className="h-full bg-surface">
              <Sidebar />
            </div>
          )}
        </Panel>

        <PanelResizeHandle className="group relative z-10 w-2 -mx-1 bg-transparent">
          <div className="mx-auto h-full w-px bg-border transition-colors group-hover:bg-accent group-data-[resize-handle-state=drag]:bg-accent" />
        </PanelResizeHandle>

        <Panel minSize={34}>
          <div className="flex h-full flex-col bg-surface">
            <ChatHeader />
            {activeSessionId == null ? (
              <NewConversation />
            ) : (
              <>
                <ChatPane />
                <InputBar />
              </>
            )}
          </div>
        </Panel>

        {panelOpen && (
          <>
            <PanelResizeHandle className="group relative z-10 w-2 -mx-1 bg-transparent">
              <div className="mx-auto h-full w-px bg-border transition-colors group-hover:bg-accent group-data-[resize-handle-state=drag]:bg-accent" />
            </PanelResizeHandle>

            <Panel
              defaultSize={26}
              minSize={18}
              maxSize={65}
              collapsible
              collapsedSize={0}
              onCollapse={() => setPanelOpen(false)}
              onExpand={() => setPanelOpen(true)}
            >
              <ArtifactPanel />
            </Panel>
          </>
        )}
        </PanelGroup>

        {activeView === 'chat' && <SidebarPeek />}

        {activeView === 'settings' && (
          <div className="absolute inset-0 z-20 bg-surface">
            <SettingsPage />
          </div>
        )}
      </div>
    </div>
  )
}
