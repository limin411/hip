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
import { AppSidebar } from '@/components/layout/AppSidebar'
import { MainToolbar } from '@/components/layout/MainToolbar'
import { SettingsPage } from '@/components/account/SettingsPage'
import { SessionHistory } from '@/components/history/SessionHistory'
import { KnowledgePage } from '@/components/knowledge/KnowledgePage'
import {
  GlobalCommandPalette,
  GlobalHotkeysBinder,
} from '@/components/command-palette'
import { SessionMenuDialogHost } from '@/components/history/SessionMenuDialogHost'
import { CODE_TERMINAL } from '@/components/artifact/terminalFeature'
import { startPtyBridge } from '@/ipc/pty'

export function AppLayout() {
  const rightPanelRef = useRef<ImperativePanelHandle>(null)
  const navigate = useNavigate()
  const activeSession = useActiveSession()
  const activeSessionId = activeSession?.id ?? null
  const activeView = useUiStore((s) => s.activeView)
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

  // App-lifetime PTY event bridge → terminalStore only (D6a). Never writes xterm.
  useEffect(() => {
    if (!CODE_TERMINAL) return
    let stop: (() => void) | undefined
    let cancelled = false
    void startPtyBridge()
      .then((unlisten) => {
        if (cancelled) unlisten()
        else stop = unlisten
      })
      .catch((err) => {
        console.error('[hip] pty bridge failed:', err)
      })
    return () => {
      cancelled = true
      stop?.()
    }
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
    if (activeView === 'knowledge') return <KnowledgePage />
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
    // Final shell: AppSidebar | (MainToolbar + main | edge drawer)
    <div className="flex h-dvh w-screen flex-row overflow-hidden bg-surface">
      <AppSidebar
        onLogout={() => {
          logout()
          navigate('/login')
        }}
      />
      <PanelGroup direction="horizontal" className="min-w-0 flex-1">
        <Panel minSize={34} className="flex min-w-0 flex-col">
          <MainToolbar />
          {renderMainContent()}
        </Panel>

        <PanelResizeHandle
          className="group relative z-10 flex w-1.5 items-stretch justify-center bg-transparent outline-none focus-visible:bg-accent/20"
          disabled={!rightOpen}
        >
          {rightOpen ? (
            <>
              {/* Full-height hover/drag cue for edge drawer */}
              <div
                className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-accent/40 group-data-[resize-handle-state=drag]:bg-accent/70 group-focus-visible:bg-accent/50"
                aria-hidden
              />
              <div
                className="relative my-auto h-8 w-[3px] rounded-full bg-border transition-colors group-hover:bg-accent/80 group-data-[resize-handle-state=drag]:bg-accent group-focus-visible:bg-accent"
                aria-hidden
                data-testid="right-panel-resize-grip"
              />
            </>
          ) : null}
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
          className="min-w-0"
        >
          {rightOpen ? (
            <div
              className="flex h-full min-h-0 flex-col border-l border-border bg-surface-subtle"
              data-testid="right-panel-drawer"
            >
              {codeOpen ? <ArtifactPanel /> : <PreviewPanel />}
            </div>
          ) : null}
        </Panel>
      </PanelGroup>

      <GlobalCommandPalette />
      <GlobalHotkeysBinder />
      <SessionMenuDialogHost />
    </div>
  )
}
