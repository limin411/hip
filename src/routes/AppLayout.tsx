import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from 'react-resizable-panels'
import { useProvidersStore } from '@/store/providersStore'
import { sessionService, useActiveSession, useDomainStore } from '@/domain'
import { useUiStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import { NewConversation } from '@/components/chat/NewConversation'
import { ChatPane } from '@/components/chat/ChatPane'
import { InputBar } from '@/components/chat/InputBar'
import { ArtifactPanel } from '@/components/artifact/ArtifactPanel'
import { PreviewPanel } from '@/components/artifact/PreviewPanel'
import { TitleBar } from '@/components/layout/TitleBar'
import { SettingsPage } from '@/components/account/SettingsPage'
import { SessionHistory } from '@/components/history/SessionHistory'
import { FloatingAvatarButton } from '@/components/account/FloatingAvatarButton'

export function AppLayout() {
  const rightPanelRef = useRef<ImperativePanelHandle>(null)
  const navigate = useNavigate()
  const activeSession = useActiveSession()
  const activeSessionId = activeSession?.id ?? null
  const activeView = useUiStore((s) => s.activeView)
  const setActiveView = useUiStore((s) => s.setActiveView)
  const logout = useAuthStore((s) => s.logout)

  useEffect(() => {
    if (!useProvidersStore.getState().loaded) {
      void useProvidersStore.getState().load().catch((err) => {
        console.error('Failed to load providers catalog (safety net):', err)
      })
    }
    sessionService.connect()
    return () => sessionService.disconnect()
  }, [])

  const codeOpen = activeView === 'code' && activeSession?.codePanelOpen === true
  const chatOpen = activeView === 'chat' && activeSession?.chatPanelOpen === true
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
    if (!activeSessionId) return
    if (activeView === 'code') useDomainStore.getState().setSessionCodePanelOpen(activeSessionId, false)
    else if (activeView === 'chat') useDomainStore.getState().setSessionChatPanelOpen(activeSessionId, false)
  }

  const handleExpand = () => {
    if (!activeSessionId) return
    if (activeView === 'code') useDomainStore.getState().setSessionCodePanelOpen(activeSessionId, true)
    else if (activeView === 'chat') useDomainStore.getState().setSessionChatPanelOpen(activeSessionId, true)
  }

  const renderMainContent = () => {
    if (activeView === 'history') return <SessionHistory />
    if (activeView === 'settings') return <SettingsPage />
    return activeSessionId == null ? (
      <NewConversation />
    ) : (
      <>
        <ChatPane />
        <InputBar />
      </>
    )
  }

  return (
    <div className="flex h-dvh w-screen flex-col overflow-hidden bg-surface">
      <TitleBar />
      <div className="relative flex min-h-0 flex-1">
        <PanelGroup direction="horizontal" className="flex-1">
          <Panel minSize={34} className="flex min-w-0 flex-col">
            {renderMainContent()}
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
          onOpenHistory={() => setActiveView('history')}
          onOpenSettings={() => setActiveView('settings')}
          onLogout={() => {
            logout()
            navigate('/login')
          }}
        />
      </div>
    </div>
  )
}
