import { useCallback, useEffect, useRef, useState, type RefObject, type TransitionEvent } from 'react'
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
import { RuntimeTaskStrip } from '@/components/chat/RuntimeTaskStrip'
import { MissingProjectBanner } from '@/components/chat/MissingProjectBanner'
import { AcpCapabilityCliffBanner } from '@/components/chat/AcpCapabilityCliffBanner'
import { ArtifactPanel } from '@/components/artifact/ArtifactPanel'
import { PreviewPanel } from '@/components/artifact/PreviewPanel'
import { AppSidebar } from '@/components/layout/AppSidebar'
import { MainToolbar } from '@/components/layout/MainToolbar'
import { PlaceholderPage } from '@/components/layout/PlaceholderPage'
import { KnowledgePage } from '@/components/knowledge/KnowledgePage'
import { OverlayShellHost } from '@/components/layout/OverlayShellHost'
import { SettingsPage } from '@/components/account/SettingsPage'
import { KnowledgeOutlinePanel } from '@/components/knowledge/KnowledgeOutlinePanel'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import {
  GlobalCommandPalette,
  GlobalHotkeysBinder,
} from '@/components/command-palette'
import { SessionMenuDialogHost } from '@/components/history/SessionMenuDialogHost'
import { ManagedTerminalDialogHost } from '@/components/terminals/ManagedTerminalDialogHost'
import { CODE_TERMINAL } from '@/components/artifact/terminalFeature'
import { TERMINAL_MANAGEMENT } from '@/components/terminals/feature'
import { TerminalManagementPage } from '@/components/terminals/TerminalManagementPage'
import { WORK_ITEM_TRACKING } from '@/components/work-items/feature'
import { WorkItemsPage } from '@/components/work-items/WorkItemsPage'
import { AUTOMATION_PAGE } from '@/components/automation/feature'
import { AutomationsPage } from '@/components/automation/AutomationsPage'
import { AutomationRunHost } from '@/components/automation/AutomationRunHost'

import { TerminalRightPanel } from '@/components/terminals/TerminalRightPanel'
import { startTerminalBridge } from '@/ipc/pty'
import { useProjectPathStore } from '@/store/projectPathStore'
import { useManagedTerminalStore } from '@/store/managedTerminalStore'
import { useTerminalHostStore } from '@/store/terminalHostStore'
import { useFocusStore } from '@/store/focusStore'
import { seedNavHistoryIfEmpty } from '@/components/layout/navHistory'
import { WindowLifecycleHost } from '@/components/window/WindowLifecycleHost'
import { widenWindowForRightPanel } from '@/lib/rightPanelWidth'
import { panelEnterMotion, panelExitMotion } from '@/components/ui/motionClasses'

/** Right rail must stay wide enough that the titlebar chrome + content breathe (~350px).
 *  react-resizable-panels minSize is group-relative %, so convert the pixel floor against the
 *  measured group width (clamped so tiny windows still leave room for the main pane).
 *  See docs/design/window-min-size-spec.md. */
const RIGHT_RAIL_MIN_PX = 350

/** Width transition duration for programmatic rail open/close. Must match
 *  --duration-expand (300ms) in the .rail-animating rule in tokens.css. */
const RAIL_TRANSITION_MS = 300
/** Extra grace before settle cleanup (covers reduced-motion + lost transitionend). */
const RAIL_TRANSITION_SLACK_MS = 80

function useRailMinPct(groupRef: RefObject<HTMLDivElement | null>): number {
  const [minPct, setMinPct] = useState(18)
  useEffect(() => {
    const el = groupRef.current
    if (!el) return
    const compute = () => {
      const w = el.clientWidth
      if (w > 0) setMinPct(Math.min(45, Math.max(15, Math.round((RIGHT_RAIL_MIN_PX / w) * 100))))
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(el)
    return () => ro.disconnect()
  }, [groupRef])
  return minPct
}

export function AppLayout() {
  const rightPanelRef = useRef<ImperativePanelHandle>(null)
  const groupRef = useRef<HTMLDivElement>(null)
  const railMinPct = useRailMinPct(groupRef)
  const activeSession = useActiveSession()
  const activeSessionId = activeSession?.id ?? null
  const activeView = useUiStore((s) => s.activeView)
  const overlay = useUiStore((s) => s.overlay)
  const activeCwd = activeSession?.config.cwd

  useEffect(() => {
    if (!useProvidersStore.getState().loaded) {
      void useProvidersStore.getState().load().catch((err) => {
        console.error('Failed to load providers catalog (safety net):', err)
      })
    }
    sessionService.connect()
    // Seed shell back/forward with the cold-launch location (chats).
    seedNavHistoryIfEmpty()
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
  const hostCatalogLoaded = useTerminalHostStore((s) => s.loaded)
  const persistedTerminalRecords = useTerminalHostStore((s) => s.terminalRecords)
  const settingsOpen = overlay === 'settings'
  // Settings owns the main column; suppress work-surface right rails while open.
  const codeOpen =
    !settingsOpen && activeView === 'code' && activeSession?.codePanelOpen === true
  const chatOpen =
    !settingsOpen && activeView === 'chat' && activeSession?.chatPanelOpen === true
  // Only in a space workspace — home has no doc outline.
  const knowledgeOpen =
    !settingsOpen &&
    activeView === 'knowledge' &&
    knowledgeMode === 'workspace' &&
    knowledgePanelOpen
  // Terminal files rail: focused managed session + toolbar toggle (like KB outline).
  const terminalsOpen =
    !settingsOpen &&
    TERMINAL_MANAGEMENT &&
    activeView === 'terminals' &&
    !!focusedManagedId &&
    !!focusedManaged &&
    terminalPanelOpen
  const rightOpen = codeOpen || chatOpen || knowledgeOpen || terminalsOpen

  // —— Right rail open/close animation state ——
  type DrawerKind = 'code' | 'knowledge' | 'terminals' | 'chat'
  // Which rail kind renders right now (all four flags are false while closed).
  const liveDrawerKind: DrawerKind = codeOpen
    ? 'code'
    : knowledgeOpen
      ? 'knowledge'
      : terminalsOpen
        ? 'terminals'
        : 'chat'
  // Last open kind, kept so the exit animation renders the same content.
  const lastDrawerKindRef = useRef<DrawerKind>('chat')
  useEffect(() => {
    if (rightOpen) lastDrawerKindRef.current = liveDrawerKind
  }, [rightOpen, liveDrawerKind])
  const drawerKind = rightOpen ? liveDrawerKind : lastDrawerKindRef.current

  // Drawer content stays mounted through the exit animation (mounted ≠ open).
  const [drawerMounted, setDrawerMounted] = useState(rightOpen)
  // True while the programmatic width transition runs (gates .rail-animating).
  const [railAnimating, setRailAnimating] = useState(false)
  // Pins the drawer to a fixed px width during the width transition so content
  // is clipped (drawer slide) instead of reflowing (squeeze).
  const [pinnedPx, setPinnedPx] = useState<number | null>(null)
  const rightOpenRef = useRef(rightOpen)
  rightOpenRef.current = rightOpen
  // Rail size in % of the group width, captured before collapse — restores the
  // same pixel width on the next open even if the window was resized meanwhile.
  const lastRailSizeRef = useRef(26)
  const railTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const railSettledRef = useRef(true)

  /** End of a programmatic open/close transition: drop the pin + transition class,
   *  and unmount the drawer once the closing width animation finished. */
  const settleRail = useCallback(() => {
    if (railTimerRef.current != null) {
      clearTimeout(railTimerRef.current)
      railTimerRef.current = null
    }
    if (railSettledRef.current) return
    railSettledRef.current = true
    setRailAnimating(false)
    setPinnedPx(null)
    if (!rightOpenRef.current) setDrawerMounted(false)
  }, [])

  /** Arm the flex-grow transition before p.expand()/p.collapse() so the class and
   *  the new inline flex-grow land in the same commit (React 18 auto-batching). */
  const beginRailAnim = useCallback(() => {
    railSettledRef.current = false
    setRailAnimating(true)
    railTimerRef.current = setTimeout(settleRail, RAIL_TRANSITION_MS + RAIL_TRANSITION_SLACK_MS)
  }, [settleRail])

  /** Both panels animate flex-grow in lockstep; the first transitionend settles.
   *  The timer above is the fallback (reduced-motion / missed events). */
  const handleRailTransitionEnd = (e: TransitionEvent<HTMLDivElement>) => {
    if (e.propertyName !== 'flex-grow') return
    if (!(e.target as HTMLElement).hasAttribute('data-panel')) return
    settleRail()
  }

  // P2: restore persisted disconnected `tm_*` records after the host catalog loads.
  useEffect(() => {
    if (!hostCatalogLoaded || persistedTerminalRecords.length === 0) return
    useManagedTerminalStore.getState().restorePersisted(persistedTerminalRecords)
  }, [hostCatalogLoaded, persistedTerminalRecords])

  // Sync the collapsible rail with rightOpen, animated.
  // Opening: widen the window first (best effort), pin the drawer content to its
  // target px width, then expand — the flex-grow transition slides the rail open.
  // Closing: pin the current px width and collapse — the rail slides shut while
  // the content fades out; the drawer unmounts once the transition settles.
  useEffect(() => {
    const p = rightPanelRef.current
    if (!p) return
    let cancelled = false
    const run = async () => {
      if (rightOpen) {
        const { sidebarOpen, sidebarWidth } = useUiStore.getState()
        await widenWindowForRightPanel(sidebarOpen, sidebarWidth)
        if (cancelled) return
        if (!p.isCollapsed()) {
          setDrawerMounted(true)
          return
        }
        const groupW = groupRef.current?.clientWidth ?? 0
        if (groupW > 0) {
          setPinnedPx(Math.round((groupW * lastRailSizeRef.current) / 100))
        }
        setDrawerMounted(true)
        beginRailAnim()
        p.expand()
      } else {
        if (p.isCollapsed()) {
          setDrawerMounted(false)
          return
        }
        lastRailSizeRef.current = p.getSize() ?? lastRailSizeRef.current
        const groupW = groupRef.current?.clientWidth ?? 0
        if (groupW > 0) {
          setPinnedPx(Math.round((groupW * lastRailSizeRef.current) / 100))
        }
        beginRailAnim()
        p.collapse()
      }
    }
    void run()
    return () => {
      cancelled = true
      if (railTimerRef.current != null) {
        clearTimeout(railTimerRef.current)
        railTimerRef.current = null
      }
    }
  }, [rightOpen, beginRailAnim])

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
    // Settings: sidebar category rail + main column body (not a modal shell).
    if (overlay === 'settings') return <SettingsPage />
    // History / Trash remain modal shells (OverlayShellHost).
    if (activeView === 'knowledge') return <KnowledgePage />
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
      if (WORK_ITEM_TRACKING) return <WorkItemsPage />
      return (
        <PlaceholderPage
          titleKey="sidebar.nav.tasks"
          descriptionKey="placeholder.tasks"
          testId="placeholder-tasks"
        />
      )
    }
    if (activeView === 'automation') {
      if (AUTOMATION_PAGE) return <AutomationsPage />
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
        {/* Sticky runtime task strip above the composer (replaces right-panel Runtime tab) */}
        <RuntimeTaskStrip />
        <InputBar />
      </>
    )
  }

  return (
    // Final shell: AppSidebar | (MainToolbar + main | edge drawer)
    // AppSidebar is solid bg-surface-subtle (light gray chrome); main column stays opaque.
    <div className="flex h-dvh w-screen flex-row overflow-hidden bg-transparent">
      <WindowLifecycleHost />
      {AUTOMATION_PAGE ? <AutomationRunHost /> : null}
      {sidebarOpen ? <AppSidebar /> : null}
      {/* Measure the group width via a plain div — PanelGroup's own ref is an
          ImperativePanelGroupHandle, not the DOM node. */}
      <div
        ref={groupRef}
        data-main-content-group
        onTransitionEnd={handleRailTransitionEnd}
        className={`flex min-w-0 flex-1 flex-col bg-surface${railAnimating ? ' rail-animating' : ''}`}
      >
        <PanelGroup direction="horizontal" className="min-h-0 min-w-0 flex-1">
          {/* Main column only: warm paper; left AppSidebar + right drawer stay neutral surface. */}
          <Panel minSize={34} className="flex min-w-0 flex-col bg-surface-content">
            <MainToolbar />
            <div
              key={overlay === 'settings' ? 'settings' : activeView}
              className="flex min-h-0 min-w-0 flex-1 flex-col animate-view-enter"
            >
              {renderMainContent()}
            </div>
          </Panel>

          {/* Overlap neighbors (w-2 -mx-1) so the divider is only a 1px line — no layout gap. */}
          <PanelResizeHandle
            className={
              drawerMounted
                ? 'group relative z-10 w-2 -mx-1 bg-transparent outline-none focus-visible:ring-1 focus-visible:ring-ink/20'
                : 'w-0'
            }
            disabled={!rightOpen || railAnimating}
          >
            {drawerMounted ? (
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
            minSize={railMinPct}
            maxSize={65}
            collapsible
            collapsedSize={0}
            onCollapse={handleCollapse}
            onExpand={handleExpand}
            className="min-w-0"
          >
            {drawerMounted ? (
              <div
                style={pinnedPx != null ? { width: `${pinnedPx}px` } : undefined}
                className={`flex h-full min-h-0 flex-col bg-surface-subtle ${rightOpen ? panelEnterMotion : panelExitMotion}`}
                data-testid="right-panel-drawer"
              >
                {drawerKind === 'code' ? (
                  <ArtifactPanel />
                ) : drawerKind === 'knowledge' ? (
                  <KnowledgeOutlinePanel />
                ) : drawerKind === 'terminals' && focusedManaged ? (
                  <TerminalRightPanel
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
      </div>

      <GlobalCommandPalette />
      <GlobalHotkeysBinder />
      <OverlayShellHost />
      <SessionMenuDialogHost />
      <ManagedTerminalDialogHost />
    </div>
  )
}
