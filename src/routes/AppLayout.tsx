import { useEffect, useRef } from 'react'
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from 'react-resizable-panels'
import { useProvidersStore } from '@/store/providersStore'
import { sessionService, useActiveSession, useDomainStore } from '@/domain'
import { useUiStore } from '@/store/uiStore'
import { NewConversation } from '@/components/chat/NewConversation'
import { ChatPane } from '@/components/chat/ChatPane'
import { ComposerPlanPanel } from '@/components/chat/ComposerPlanPanel'
import { PermissionModal } from '@/components/chat/PermissionModal'
import { GoalStatusChip } from '@/components/chat/GoalStatusChip'
import { InputBar } from '@/components/chat/InputBar'
import { MissingProjectBanner } from '@/components/chat/MissingProjectBanner'
import { AcpCapabilityCliffBanner } from '@/components/chat/AcpCapabilityCliffBanner'
import { ArtifactPanel } from '@/components/artifact/ArtifactPanel'
import { PreviewPanel } from '@/components/artifact/PreviewPanel'
import { AppSidebar } from '@/components/layout/AppSidebar'
import { MainToolbar } from '@/components/layout/MainToolbar'
import { PlaceholderPage } from '@/components/layout/PlaceholderPage'
import { SettingsPage } from '@/components/account/SettingsPage'
import { SessionHistory } from '@/components/history/SessionHistory'
import { RecycleBinPage } from '@/components/history/RecycleBinPage'
import { KnowledgePage } from '@/components/knowledge/KnowledgePage'
import { KnowledgeOutlinePanel } from '@/components/knowledge/KnowledgeOutlinePanel'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import {
  GlobalCommandPalette,
  GlobalHotkeysBinder,
} from '@/components/command-palette'
import { SessionMenuDialogHost } from '@/components/history/SessionMenuDialogHost'
import { ManagedTerminalDialogHost } from '@/components/terminals/ManagedTerminalDialogHost'
import { WorktreeDeleteDialogHost } from '@/components/chat/WorktreeControl/WorktreeDeleteDialogHost'
import { KnowledgeSpaceDialogHost } from '@/components/knowledge/KnowledgeSpaceDialogHost'
import { CODE_TERMINAL } from '@/components/artifact/terminalFeature'
import { TERMINAL_MANAGEMENT } from '@/components/terminals/feature'
import { TerminalManagementPage } from '@/components/terminals/TerminalManagementPage'
import { TerminalFilesPanel } from '@/components/terminals/TerminalFilesPanel'
import { startTerminalBridge } from '@/ipc/pty'
import { useProjectPathStore } from '@/store/projectPathStore'
import { useManagedTerminalStore } from '@/store/managedTerminalStore'
import { useFocusStore } from '@/store/focusStore'

export function AppLayout() {
  const rightPanelRef = useRef<ImperativePanelHandle>(null)
  const activeSession = useActiveSession()
  const activeSessionId = activeSession?.id ?? null
  const activeView = useUiStore((s) => s.activeView)
  const activeCwd = activeSession?.config.cwd

  useEffect(() => {
    if (!useProvidersStore.getState().loaded) {
      void useProvidersStore.getState().load().catch((err) => {
        console.error('Failed to load providers catalog (safety net):', err)
      })
    }
    sessionService.connect()
    return () => sessionService.disconnect()
  }, [])

  // Probe active session project folder (and re-probe on window focus).
  useEffect(() => {
    useProjectPathStore.getState().ensureChecked([activeCwd])
  }, [activeCwd, activeSessionId])

  useEffect(() => {
    const onFocus = () => {
      const store = useProjectPathStore.getState()
      store.invalidate()
      const st = useDomainStore.getState()
      store.ensureChecked(st.sessions.map((s) => s.config.cwd))
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  // App-lifetime terminal event bridge → terminalStore only (D6a). Never writes xterm.
  // Single bridge when either code-panel or terminal-management needs rings.
  // Listens pty:* + ssh:*; normalizeTerminalId accepts sessionId | terminalId.
  useEffect(() => {
    if (!CODE_TERMINAL && !TERMINAL_MANAGEMENT) return
    let stop: (() => void) | undefined
    let cancelled = false
    void startTerminalBridge()
      .then((unlisten) => {
        if (cancelled) unlisten()
        else stop = unlisten
      })
      .catch((err) => {
        console.error('[hip] terminal bridge failed:', err)
      })
    return () => {
      cancelled = true
      stop?.()
    }
  }, [])

  const knowledgePanelOpen = useUiStore((s) => s.knowledgePanelOpen)
  const terminalPanelOpen = useUiStore((s) => s.terminalPanelOpen)
  const sidebarOpen = useUiStore((s) => s.sidebarOpen)
  const knowledgeMode = useKnowledgeStore((s) => s.mode)
  const focusedManagedId = useManagedTerminalStore((s) => s.focusedId)
  const focusedManaged = useManagedTerminalStore((s) =>
    s.focusedId ? s.terminals.find((t) => t.id === s.focusedId) : undefined,
  )
  const codeOpen = activeView === 'code' && activeSession?.codePanelOpen === true
  const chatOpen = activeView === 'chat' && activeSession?.chatPanelOpen === true
  // Only in a space workspace — home has no doc outline.
  const knowledgeOpen =
    activeView === 'knowledge' && knowledgeMode === 'workspace' && knowledgePanelOpen
  // Terminal files rail: focused managed session + toolbar toggle (like KB outline).
  const terminalsOpen =
    TERMINAL_MANAGEMENT &&
    activeView === 'terminals' &&
    !!focusedManagedId &&
    !!focusedManaged &&
    terminalPanelOpen
  const rightOpen = codeOpen || chatOpen || knowledgeOpen || terminalsOpen

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
    if (activeView === 'knowledge') {
      useUiStore.getState().setKnowledgePanelOpen(false)
      return
    }
    if (activeView === 'terminals') {
      useUiStore.getState().setTerminalPanelOpen(false)
      return
    }
    if (!activeSessionId) return
    // User-dismissed: suppress write-follow auto-open for the rest of this turn.
    if (activeView === 'code' || activeView === 'chat') {
      useFocusStore.getState().dismissPanelThisTurn()
    }
    if (activeView === 'code') useDomainStore.getState().setSessionCodePanelOpen(activeSessionId, false)
    else if (activeView === 'chat') useDomainStore.getState().setSessionChatPanelOpen(activeSessionId, false)
  }

  const handleExpand = () => {
    if (activeView === 'knowledge') {
      useUiStore.getState().setKnowledgePanelOpen(true)
      return
    }
    if (activeView === 'terminals') {
      useUiStore.getState().setTerminalPanelOpen(true)
      return
    }
    if (!activeSessionId) return
    if (activeView === 'code') useDomainStore.getState().setSessionCodePanelOpen(activeSessionId, true)
    else if (activeView === 'chat') useDomainStore.getState().setSessionChatPanelOpen(activeSessionId, true)
  }

  const renderMainContent = () => {
    if (activeView === 'history') return <SessionHistory />
    if (activeView === 'trash') return <RecycleBinPage />
    if (activeView === 'settings') return <SettingsPage />
    if (activeView === 'knowledge') return <KnowledgePage />
    if (activeView === 'workbench') {
      return (
        <PlaceholderPage
          titleKey="sidebar.nav.workbench"
          descriptionKey="placeholder.workbench"
          testId="placeholder-workbench"
        />
      )
    }
    if (activeView === 'terminals') {
      if (TERMINAL_MANAGEMENT) {
        return <TerminalManagementPage />
      }
      return (
        <PlaceholderPage
          titleKey="sidebar.nav.terminals"
          descriptionKey="placeholder.terminals"
          testId="placeholder-terminals"
        />
      )
    }
    if (activeView === 'tasks') {
      return (
        <PlaceholderPage
          titleKey="sidebar.nav.tasks"
          descriptionKey="placeholder.tasks"
          testId="placeholder-tasks"
        />
      )
    }
    if (activeView === 'automation') {
      return (
        <PlaceholderPage
          titleKey="sidebar.nav.automation"
          descriptionKey="placeholder.automation"
          testId="placeholder-automation"
        />
      )
    }
    return activeSessionId == null ? (
      <NewConversation />
    ) : (
      <>
        <MissingProjectBanner />
        <GoalStatusChip />
        <ChatPane />
        {/* Sticky plan/todo checklist directly above the composer */}
        <ComposerPlanPanel />
        {/* Session-scoped HITL permission prompt above the composer (not a global modal) */}
        <PermissionModal />
        {/* ACP primary capability cliff — sticky above InputBar (not in timeline). */}
        <AcpCapabilityCliffBanner />
        <InputBar />
      </>
    )
  }

  return (
    // Final shell: AppSidebar | (MainToolbar + main | edge drawer)
    // Shell is transparent so native vibrancy (macOS Sidebar / Win Mica) shows through
    // the left sidebar; main column stays opaque for readable content.
    <div className="flex h-dvh w-screen flex-row overflow-hidden bg-transparent">
      {sidebarOpen ? <AppSidebar /> : null}
      <PanelGroup direction="horizontal" className="min-w-0 flex-1 bg-surface">
        <Panel minSize={34} className="flex min-w-0 flex-col bg-surface">
          <MainToolbar />
          {renderMainContent()}
        </Panel>

        {/* Overlap neighbors (w-2 -mx-1) so the divider is only a 1px line — no layout gap. */}
        <PanelResizeHandle
          className={
            rightOpen
              ? 'group relative z-10 w-2 -mx-1 bg-transparent outline-none focus-visible:ring-1 focus-visible:ring-ink/20'
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
              {codeOpen ? (
                <ArtifactPanel />
              ) : knowledgeOpen ? (
                <KnowledgeOutlinePanel />
              ) : terminalsOpen && focusedManaged ? (
                <TerminalFilesPanel
                  terminalId={focusedManaged.id}
                  backend={focusedManaged.kind === 'local' ? 'local' : 'sftp'}
                  localRoot={focusedManaged.cwd}
                  remotePath={focusedManaged.remotePath}
                />
              ) : (
                <PreviewPanel />
              )}
            </div>
          ) : null}
        </Panel>
      </PanelGroup>

      <GlobalCommandPalette />
      <GlobalHotkeysBinder />
      <SessionMenuDialogHost />
      <ManagedTerminalDialogHost />
      <WorktreeDeleteDialogHost />
      <KnowledgeSpaceDialogHost />
    </div>
  )
}
