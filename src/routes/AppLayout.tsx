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
  const sidebarWidth = useUiStore((s) => s.sidebarWidth)
  const setSidebarWidth = useUiStore((s) => s.setSidebarWidth)
  const panelOpen = useUiStore((s) => s.panelOpen)
  const setPanelOpen = useUiStore((s) => s.setPanelOpen)
  const chatPanelOpen = useUiStore((s) => s.chatPanelOpen)
  const setChatPanelOpen = useUiStore((s) => s.setChatPanelOpen)
  const activeView = useUiStore((s) => s.activeView)
  const activeSessionId = useActiveSessionId()

  useEffect(() => {
    // App.tsx already bootstraps providers/config before rendering the router.
    // This is a reload/reconnect safety net for direct navigation or hot reload.
    if (!useProvidersStore.getState().loaded) {
      void useProvidersStore.getState().load().catch((err) => {
        console.error('Failed to load providers catalog (safety net):', err)
      })
    }
    sessionService.connect()
    return () => sessionService.disconnect()
  }, [])

  // 在设置页调整宽度后返回主界面时，同步主侧边栏的宽度。
  useEffect(() => {
    const p = sidebarRef.current
    if (!p || sidebarWidth <= 0) return
    const current = p.getSize()
    if (Math.abs(current - sidebarWidth) > 0.1) {
      p.resize(sidebarWidth)
    }
  }, [sidebarWidth])

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
          onResize={(size) => {
            if (size > 0) setSidebarWidth(size)
          }}
        >
          <div className="h-full bg-surface">
            <Sidebar />
          </div>
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
