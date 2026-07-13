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
import { KnowledgePage } from '@/components/knowledge/KnowledgePage'
import { FloatingAvatarButton } from '@/components/account/FloatingAvatarButton'
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
    <div className="flex h-dvh w-screen flex-col overflow-hidden bg-surface">
      <TitleBar />
      <div className="relative flex min-h-0 flex-1">
        <PanelGroup direction="horizontal" className="flex-1">
          <Panel minSize={34} className="flex min-w-0 flex-col">
            {renderMainContent()}
          </Panel>

          <PanelResizeHandle className="group relative z-10 flex w-3 items-center justify-center bg-transparent">
            {/* Restrained drag affordance: short center grip, soft full-height cue only on hover/drag. */}
            {rightOpen ? (
              <>
                <div
                  className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-accent/30 group-data-[resize-handle-state=drag]:bg-accent/50"
                  aria-hidden
                />
                <div
                  className="relative h-7 w-[3px] rounded-full bg-border transition-colors group-hover:bg-accent/70 group-data-[resize-handle-state=drag]:bg-accent"
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
              // Visual float shell only — resize/collapse/open state stay on the Panel above.
              // Equal inset on all sides so the soft shadow is not clipped into a hard edge
              // at the bottom / left (especially near the window corner).
              <div className="flex h-full min-h-0 flex-col p-3" data-testid="right-panel-float">
                {/* Low-offset shadow so it sits inside the p-3 gutter and doesn't clip into a hard line. */}
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-panel animate-panel-in">
                  {codeOpen ? <ArtifactPanel /> : <PreviewPanel />}
                </div>
              </div>
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
        <GlobalCommandPalette />
        <GlobalHotkeysBinder />
        <SessionMenuDialogHost />
      </div>
    </div>
  )
}
