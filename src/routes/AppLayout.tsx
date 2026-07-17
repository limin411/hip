import { useEffect, useRef } from 'react'
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from 'react-resizable-panels'
import { useProvidersStore } from '@/store/providersStore'
import { sessionService, useActiveSession, useDomainStore } from '@/domain'
import { useUiStore } from '@/store/uiStore'
import { NewConversation } from '@/components/chat/NewConversation'
import { ChatPane } from '@/components/chat/ChatPane'
import { ComposerPlanPanel } from '@/components/chat/ComposerPlanPanel'
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
  const activeSession = useActiveSession()
  const activeSessionId = activeSession?.id ?? null
  const activeView = useUiStore((s) => s.activeView)

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
        {/* Sticky plan/todo checklist directly above the composer */}
        <ComposerPlanPanel />
        <InputBar />
      </>
    )
  }

  return (
    // Final shell: AppSidebar | (MainToolbar + main | edge drawer)
    // Shell is transparent so native vibrancy (macOS Sidebar / Win Mica) shows through
    // the left sidebar; main column stays opaque for readable content.
    <div className="flex h-dvh w-screen flex-row overflow-hidden bg-transparent">
      <AppSidebar />
      <PanelGroup direction="horizontal" className="min-w-0 flex-1 bg-surface">
        <Panel minSize={34} className="flex min-w-0 flex-col bg-surface">
          <MainToolbar />
          {renderMainContent()}
        </Panel>

        {/* Overlap neighbors (w-2 -mx-1) so the divider is only a 1px line — no layout gap. */}
        <PanelResizeHandle
          className={
            rightOpen
              ? 'group relative z-10 w-2 -mx-1 bg-transparent outline-none focus-visible:ring-1 focus-visible:ring-accent/40'
              : 'w-0'
          }
          disabled={!rightOpen}
        >
          {rightOpen ? (
            <div
              className="mx-auto h-full w-px bg-border transition-colors group-hover:bg-accent group-data-[resize-handle-state=drag]:bg-accent group-focus-visible:bg-accent"
              aria-hidden
              data-testid="right-panel-resize-grip"
            />
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
              className="flex h-full min-h-0 flex-col bg-surface-subtle"
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
