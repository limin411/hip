import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from 'react-resizable-panels'
import { useProvidersStore } from '@/store/providersStore'
import { sessionService, useActiveSessionId } from '@/domain'
import { useUiStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import { NewConversation } from '@/components/chat/NewConversation'
import { ChatPane } from '@/components/chat/ChatPane'
import { InputBar } from '@/components/chat/InputBar'
import { ArtifactPanel } from '@/components/artifact/ArtifactPanel'
import { PreviewPanel } from '@/components/artifact/PreviewPanel'
import { TitleBar } from '@/components/layout/TitleBar'
import { SettingsPage } from '@/components/account/SettingsPage'
import { FloatingAvatarButton } from '@/components/account/FloatingAvatarButton'

export function AppLayout() {
  const rightPanelRef = useRef<ImperativePanelHandle>(null)
  const navigate = useNavigate()
  const activeSessionId = useActiveSessionId()
  const activeView = useUiStore((s) => s.activeView)
  const setActiveView = useUiStore((s) => s.setActiveView)
  const logout = useAuthStore((s) => s.logout)
  const panelOpen = useUiStore((s) => s.panelOpen)
  const setPanelOpen = useUiStore((s) => s.setPanelOpen)
  const chatPanelOpen = useUiStore((s) => s.chatPanelOpen)
  const setChatPanelOpen = useUiStore((s) => s.setChatPanelOpen)

  useEffect(() => {
    if (!useProvidersStore.getState().loaded) {
      void useProvidersStore.getState().load().catch((err) => {
        console.error('Failed to load providers catalog (safety net):', err)
      })
    }
    sessionService.connect()
    return () => sessionService.disconnect()
  }, [])

  const codeOpen = activeView === 'code' && panelOpen
  const chatOpen = activeView === 'chat' && chatPanelOpen
  const rightOpen = codeOpen || chatOpen

  useEffect(() => {
    const p = rightPanelRef.current
    if (!p) return
    const t = setTimeout(() => {
      if (rightOpen && p.isCollapsed()) p.expand()
      if (!rightOpen && !p.isCollapsed()) p.collapse()
    }, 0)
    return () => clearTimeout(t)
  }, [rightOpen])

  const handleCollapse = () => {
    if (activeView === 'code') setPanelOpen(false)
    else if (activeView === 'chat') setChatPanelOpen(false)
  }

  const handleExpand = () => {
    if (activeView === 'code') setPanelOpen(true)
    else if (activeView === 'chat') setChatPanelOpen(true)
  }

  return (
    <div className="flex h-dvh w-screen flex-col overflow-hidden bg-surface">
      <TitleBar />
      <div className="relative flex min-h-0 flex-1">
        <PanelGroup direction="horizontal" className="flex-1">
          <Panel minSize={34} className="flex min-w-0 flex-col">
            {activeSessionId == null ? (
              <NewConversation />
            ) : (
              <>
                <ChatPane />
                <InputBar />
              </>
            )}
          </Panel>

          <PanelResizeHandle className="group relative z-10 w-2 -mx-1 bg-transparent">
            <div className="mx-auto h-full w-px bg-border transition-colors group-hover:bg-accent group-data-[resize-handle-state=drag]:bg-accent" />
          </PanelResizeHandle>

          <Panel
            ref={rightPanelRef}
            defaultSize={26}
            minSize={18}
            maxSize={65}
            collapsible
            collapsedSize={0}
            onCollapse={handleCollapse}
            onExpand={handleExpand}
          >
            {rightOpen ? (
              codeOpen ? <ArtifactPanel /> : <PreviewPanel />
            ) : null}
          </Panel>
        </PanelGroup>

        <FloatingAvatarButton
          onOpenSettings={() => setActiveView('settings')}
          onLogout={() => {
            logout()
            navigate('/login')
          }}
        />
      </div>

      {activeView === 'settings' && (
        <div className="absolute inset-0 z-20 bg-surface">
          <SettingsPage />
        </div>
      )}
    </div>
  )
}
