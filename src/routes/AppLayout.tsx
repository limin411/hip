import { useEffect, useRef } from 'react'
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from 'react-resizable-panels'
import { useUiStore } from '@/store/uiStore'
import { useProvidersStore } from '@/store/providersStore'
import { sessionService, useActiveSessionId } from '@/domain'
import { NewConversation } from '@/components/chat/NewConversation'
import { Sidebar } from '@/components/sidebar/Sidebar'
import { ChatPane } from '@/components/chat/ChatPane'
import { InputBar } from '@/components/chat/InputBar'
import { ArtifactPanel } from '@/components/artifact/ArtifactPanel'
import { PreviewPanel } from '@/components/artifact/PreviewPanel'
import { SidebarPeek } from '@/components/sidebar/SidebarPeek'
import { TitleBar } from '@/components/layout/TitleBar'
import { SettingsPage } from '@/components/account/SettingsPage'

export function AppLayout() {
  const sidebarRef = useRef<ImperativePanelHandle>(null)
  const collapsed = useUiStore((s) => s.collapsed)
  const sidebarWidth = useUiStore((s) => s.sidebarWidth)
  const setSidebarWidth = useUiStore((s) => s.setSidebarWidth)
  const panelOpen = useUiStore((s) => s.panelOpen)
  const setCollapsed = useUiStore((s) => s.setCollapsed)
  const setPanelOpen = useUiStore((s) => s.setPanelOpen)
  const chatPanelOpen = useUiStore((s) => s.chatPanelOpen)
  const setChatPanelOpen = useUiStore((s) => s.setChatPanelOpen)
  const activeView = useUiStore((s) => s.activeView)
  const activeSessionId = useActiveSessionId()

  useEffect(() => {
    void useProvidersStore.getState().load()
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
    <div className="flex h-dvh w-screen flex-col overflow-hidden bg-surface">
      {/* 贯穿全宽的标题栏 —— 红绿灯与统一折叠按钮的唯一归属，下方各列不再预留偏移 */}
      <TitleBar />
      <div className="relative flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <PanelGroup direction="horizontal" className="h-full w-full">
        <Panel
          ref={sidebarRef}
          defaultSize={sidebarWidth}
          minSize={12}
          maxSize={22}
          collapsible
          collapsedSize={0}
          onCollapse={() => setCollapsed(true)}
          onExpand={() => setCollapsed(false)}
          onResize={(size) => {
            if (!collapsed && size > 0) setSidebarWidth(size)
          }}
        >
          {!collapsed && (
            <div className="h-full bg-surface">
              <Sidebar />
            </div>
          )}
        </Panel>

        <PanelResizeHandle className="group relative z-10 w-2 -mx-1 bg-transparent">
          <div className="mx-auto h-full w-px bg-[var(--glass-border)] transition-colors group-hover:bg-accent group-data-[resize-handle-state=drag]:bg-accent" />
        </PanelResizeHandle>

        <Panel minSize={34}>
          <div className="flex h-full flex-col bg-surface">
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

        {(() => {
          const codeOpen = activeView === 'code' && panelOpen
          const chatOpen = activeView === 'chat' && chatPanelOpen
          if (!codeOpen && !chatOpen) return null
          return (
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
                onCollapse={() => (codeOpen ? setPanelOpen(false) : setChatPanelOpen(false))}
                onExpand={() => (codeOpen ? setPanelOpen(true) : setChatPanelOpen(true))}
              >
                {codeOpen ? <ArtifactPanel /> : <PreviewPanel />}
              </Panel>
            </>
          )
        })()}
        </PanelGroup>

        {activeView !== 'settings' && <SidebarPeek />}
        </div>

        {activeView === 'settings' && (
          <div className="absolute inset-0 z-20 bg-surface">
            <SettingsPage />
          </div>
        )}
      </div>
    </div>
  )
}
