import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  BookOpen,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Code2,
  Folder,
  MessageSquare,
  PanelLeftClose,
  Terminal,
  Zap,
} from 'lucide-react'
import { sessionService, useActiveSessionId, useSessions, type SessionVM } from '@/domain'
import { HIP_PRODUCT_VERSION } from '@/domain/product'
import { isMacPlatform } from '@/lib/platform'
import { isTerminalSession, surfaceOf } from '@/lib/sessions'
import { groupSessionsByProjectPath, projectPathKey } from '@/lib/sessionProjectGroups'
import { groupSessionsByDate } from '@/lib/sessionDateGroups'
import { cn } from '@/lib/utils'
import { useWindowDrag } from '@/lib/useWindowDrag'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import { useProjectPathStore } from '@/store/projectPathStore'
import {
  isPlaceholderSidebarSection,
  useUiStore,
  type SidebarSection,
} from '@/store/uiStore'
import { useManagedTerminalStore } from '@/store/managedTerminalStore'
import { useTerminalStore } from '@/store/terminalStore'
import { terminalSessionsFor, useTerminalAgentStore } from '@/store/terminalAgentStore'
import { DeclarativeContextMenu } from '@/components/context-menu'
import { openCreateKnowledgeSpaceDialog } from '@/components/knowledge/knowledgeSpaceDialogStore'
import { TERMINAL_MANAGEMENT } from '@/components/terminals/feature'
import { QuickConnectPopover } from '@/components/terminals/QuickConnectPopover'
import { WORK_ITEM_TRACKING } from '@/components/work-items/feature'
import { WorkItemSidebarLists } from '@/components/work-items/WorkItemSidebarLists'
import { AUTOMATION_PAGE } from '@/components/automation/feature'
import { AutomationSidebarList } from '@/components/automation/AutomationSidebarList'
import {
  enterKnowledge,
  enterPlaceholderSection,
  enterSection,
  enterTerminalsSection,
  enterWorkItemsSection,
  enterAutomationsSection,
  newConversationFromSidebar,
  openSettingsFromChrome,
  openSpaceFromSidebar,
  selectSessionFromSidebar,
  toggleHistoryOverlay,
  toggleTrashOverlay,
} from './sidebarActions'
import { SIDEBAR_ACTIVE_RAIL } from './sidebarActiveRail'
import { sidebarFooterActive } from './sidebarFooterActive'
import { SidebarAccountFooter } from './SidebarAccountFooter'
import { SettingsSidebarContent } from './SettingsSidebarContent'
import { goNavBack, goNavForward } from './navHistory'
import { useNavHistoryStore } from '@/store/navHistoryStore'
import { titlebarIconBtnClass, titlebarIconProps, titlebarRowClass } from './titlebarChrome'
import {
  clampSidebarWidth,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  SIDEBAR_WIDTH_STEP,
} from './sidebarWidth'

const titlebarNavBtnClass = cn(
  titlebarIconBtnClass,
  'disabled:pointer-events-none disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-secondary',
)

export function AppSidebar() {
  const { t } = useTranslation()
  const handlePointerDown = useWindowDrag()
  /** Project path keys whose session list is collapsed (default = expanded). */
  const [projectGroupCollapsed, setProjectGroupCollapsed] = useState<Record<string, boolean>>({})
  /** Chat date-bucket keys whose session list is collapsed (default = expanded). */
  const [chatDateGroupCollapsed, setChatDateGroupCollapsed] = useState<Record<string, boolean>>({})
  const sidebarSection = useUiStore((s) => s.sidebarSection)
  const sidebarWidth = useUiStore((s) => s.sidebarWidth)
  const setSidebarWidth = useUiStore((s) => s.setSidebarWidth)
  const activeView = useUiStore((s) => s.activeView)
  const overlay = useUiStore((s) => s.overlay)
  const sessions = useSessions()
  const activeSessionId = useActiveSessionId()
  const spaces = useKnowledgeStore((s) => s.spaces)
  const activeSpaceId = useKnowledgeStore((s) => s.activeSpaceId)
  const managedTerminals = useManagedTerminalStore((s) => s.terminals)
  const focusedManagedId = useManagedTerminalStore((s) => s.focusedId)
  const sidebarExpanded = useTerminalAgentStore((s) => s.sidebarExpanded)
  const activeAgentSessionByTerminal = useTerminalAgentStore(
    (s) => s.activeSessionByTerminal,
  )
  const activeTerminalTabByTerminal = useUiStore((s) => s.activeTerminalPanelTab)
  /** Ring status map — re-renders sidebar rows when PTY status changes. */
  const terminalBySession = useTerminalStore((s) => s.bySession)
  const isMac = isMacPlatform()
  const navIndex = useNavHistoryStore((s) => s.index)
  const navStackLen = useNavHistoryStore((s) => s.stack.length)
  const canGoBack = navIndex > 0
  const canGoForward = navIndex >= 0 && navIndex < navStackLen - 1
  const [resizing, setResizing] = useState(false)
  const resizeDrag = useRef<{ startX: number; startW: number } | null>(null)
  const resizeTeardown = useRef<(() => void) | null>(null)

  useEffect(() => () => resizeTeardown.current?.(), [])

  const liveMaxWidth = () =>
    typeof window !== 'undefined' ? Math.floor(window.innerWidth * 0.5) : SIDEBAR_WIDTH_MAX

  const onResizePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || resizeDrag.current) return
    e.preventDefault()
    e.stopPropagation()
    resizeDrag.current = { startX: e.clientX, startW: sidebarWidth }
    setResizing(true)

    const onMove = (ev: PointerEvent) => {
      const d = resizeDrag.current
      if (!d) return
      setSidebarWidth(clampSidebarWidth(d.startW + (ev.clientX - d.startX), liveMaxWidth()))
    }
    const finish = () => {
      if (!resizeDrag.current) return
      resizeDrag.current = null
      resizeTeardown.current = null
      setResizing(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    const onUp = (ev: PointerEvent) => {
      if (ev.button !== 0) return
      finish()
    }
    const onCancel = () => finish()

    resizeTeardown.current = finish
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  const onResizeKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      setSidebarWidth(sidebarWidth - SIDEBAR_WIDTH_STEP)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      setSidebarWidth(sidebarWidth + SIDEBAR_WIDTH_STEP)
    } else if (e.key === 'Home') {
      e.preventDefault()
      setSidebarWidth(SIDEBAR_WIDTH_MIN)
    } else if (e.key === 'End') {
      e.preventDefault()
      setSidebarWidth(SIDEBAR_WIDTH_MAX)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setSidebarWidth(SIDEBAR_WIDTH_DEFAULT)
    }
  }

  const filteredSessions = useMemo(() => {
    const surface = sidebarSection === 'projects' ? 'code' : 'chat'
    if (sidebarSection !== 'projects' && sidebarSection !== 'chats') return []
    return sessions
      .filter((s) => !isTerminalSession(s.config) && surfaceOf(s.config) === surface)
      .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
  }, [sessions, sidebarSection])

  /** Project sessions only: group top-level rows by workspace path. */
  const projectSessionGroups = useMemo(() => {
    if (sidebarSection !== 'projects') return []
    return groupSessionsByProjectPath(filteredSessions)
  }, [sidebarSection, filteredSessions])

  /** Chat sessions: newest-first within date buckets (Today / Yesterday / …). */
  const chatDateGroups = useMemo(() => {
    if (sidebarSection !== 'chats') return []
    return groupSessionsByDate(filteredSessions)
  }, [sidebarSection, filteredSessions])

  /** History footer badge: first-class sessions only. */
  const historyCount = useMemo(
    () => sessions.filter((s) => !isTerminalSession(s.config)).length,
    [sessions],
  )

  const pathStatusByKey = useProjectPathStore((s) => s.byKey)

  // Probe project folder existence when viewing Projects (lazy + TTL-cached).
  useEffect(() => {
    if (sidebarSection !== 'projects') return
    useProjectPathStore.getState().ensureChecked(projectSessionGroups.map((g) => g.cwd ?? g.pathKey))
  }, [sidebarSection, projectSessionGroups])

  const filteredSpaces = useMemo(() => {
    if (sidebarSection !== 'knowledge') return []
    const list = [...spaces]
    // Ascending by name (locale-aware, case-insensitive).
    list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    return list
  }, [spaces, sidebarSection])

  const projectCount = useMemo(
    () =>
      sessions.filter((s) => !isTerminalSession(s.config) && surfaceOf(s.config) === 'code').length,
    [sessions],
  )
  const chatCount = useMemo(
    () =>
      sessions.filter((s) => !isTerminalSession(s.config) && surfaceOf(s.config) === 'chat').length,
    [sessions],
  )

  const onNav = (section: SidebarSection) => {
    if (section === 'knowledge') void enterKnowledge()
    else if (section === 'terminals' && TERMINAL_MANAGEMENT)
      void enterTerminalsSection({ library: true })
    else if (section === 'tasks' && WORK_ITEM_TRACKING) void enterWorkItemsSection()
    else if (section === 'automation' && AUTOMATION_PAGE) void enterAutomationsSection()
    else if (isPlaceholderSidebarSection(section)) void enterPlaceholderSection(section)
    else if (section === 'projects' || section === 'chats') void enterSection(section)
  }

  const listLabel =
    sidebarSection === 'knowledge'
      ? t('sidebar.list.spaces')
      : sidebarSection === 'projects'
        ? t('sidebar.list.projects')
        : sidebarSection === 'chats'
          ? t('sidebar.list.chats')
          : sidebarSection === 'terminals' && TERMINAL_MANAGEMENT
            ? t('sidebar.list.terminals')
            : sidebarSection === 'tasks' && WORK_ITEM_TRACKING
              ? t('sidebar.list.workItems')
              : sidebarSection === 'automation' && AUTOMATION_PAGE
                ? t('sidebar.list.automations')
                : t(`sidebar.nav.${sidebarSection}`)

  const toggleProjectGroup = (groupId: string) => {
    setProjectGroupCollapsed((prev) => ({ ...prev, [groupId]: !prev[groupId] }))
  }

  const isProjectGroupExpanded = (groupId: string) => projectGroupCollapsed[groupId] !== true

  const toggleChatDateGroup = (bucketId: string) => {
    setChatDateGroupCollapsed((prev) => ({ ...prev, [bucketId]: !prev[bucketId] }))
  }

  const isChatDateGroupExpanded = (bucketId: string) => chatDateGroupCollapsed[bucketId] !== true

  const settingsOpen = overlay === 'settings'

  return (
    <aside
      className="relative flex h-full shrink-0 flex-col border-r border-border bg-surface-subtle"
      style={{ width: sidebarWidth }}
      data-testid="app-sidebar"
      aria-label={settingsOpen ? t('settings.title') : t('sidebar.aria')}
    >
      <div
        data-tauri-drag-region
        data-testid="sidebar-drag-region"
        onPointerDown={handlePointerDown}
        className={cn(titlebarRowClass, 'border-b-0')}
      >
        {isMac ? (
          <div
            className="h-full shrink-0"
            style={{ width: 'var(--titlebar-lights-inset, 90px)' }}
            aria-hidden
          />
        ) : (
          <div className="h-full w-2 shrink-0" aria-hidden />
        )}
        <div className="flex h-full shrink-0 items-center gap-0.5 pr-2">
          <button
            type="button"
            data-testid="sidebar-toggle"
            data-no-drag
            title={t('sidebar.collapse')}
            aria-label={t('sidebar.collapseAria')}
            aria-expanded={true}
            onClick={() => useUiStore.getState().setSidebarOpen(false)}
            className={titlebarIconBtnClass}
          >
            <PanelLeftClose {...titlebarIconProps} />
          </button>
          {!settingsOpen ? (
            <>
              <button
                type="button"
                data-testid="sidebar-nav-back"
                data-no-drag
                title={t('sidebar.navBack')}
                aria-label={t('sidebar.navBackAria')}
                disabled={!canGoBack}
                onClick={() => void goNavBack()}
                className={titlebarNavBtnClass}
              >
                <ChevronLeft {...titlebarIconProps} />
              </button>
              <button
                type="button"
                data-testid="sidebar-nav-forward"
                data-no-drag
                title={t('sidebar.navForward')}
                aria-label={t('sidebar.navForwardAria')}
                disabled={!canGoForward}
                onClick={() => void goNavForward()}
                className={titlebarNavBtnClass}
              >
                <ChevronRight {...titlebarIconProps} />
              </button>
            </>
          ) : null}
        </div>
      </div>

      {settingsOpen ? (
        <SettingsSidebarContent />
      ) : (
        <>
      <div
        className="px-3 pb-1.5 pt-0 text-caption tabular-nums tracking-wide text-ink-tertiary"
        data-testid="sidebar-app-version"
      >
        HIP {HIP_PRODUCT_VERSION}
      </div>

      <nav className="flex shrink-0 flex-col gap-0.5 px-2 pb-3" aria-label={t('sidebar.navAria')}>
        <NavItem
          section="chats"
          active={sidebarSection === 'chats'}
          label={t('sidebar.nav.chats')}
          icon={<MessageSquare size={16} strokeWidth={1.75} />}
          count={chatCount > 0 ? chatCount : undefined}
          onClick={() => onNav('chats')}
        />
        <NavItem
          section="projects"
          active={sidebarSection === 'projects'}
          label={t('sidebar.nav.projects')}
          icon={<Code2 size={16} strokeWidth={1.75} />}
          count={projectCount > 0 ? projectCount : undefined}
          onClick={() => onNav('projects')}
        />
        <NavItem
          section="knowledge"
          active={sidebarSection === 'knowledge'}
          label={t('sidebar.nav.knowledge')}
          icon={<BookOpen size={16} strokeWidth={1.75} />}
          count={spaces.length > 0 ? spaces.length : undefined}
          onClick={() => onNav('knowledge')}
        />
        <NavItem
          section="terminals"
          active={sidebarSection === 'terminals' && activeView === 'terminals'}
          label={t('sidebar.nav.terminals')}
          icon={<Terminal size={16} strokeWidth={1.75} />}
          onClick={() => onNav('terminals')}
        />
        <NavItem
          section="tasks"
          // Section-only (like chats/knowledge): Settings keeps `tasks` so the
          // rail stays on Tasks; trash/history still reassign section away.
          active={sidebarSection === 'tasks'}
          label={t('sidebar.nav.tasks')}
          icon={<CheckSquare size={16} strokeWidth={1.75} />}
          onClick={() => onNav('tasks')}
        />
        <NavItem
          section="automation"
          active={sidebarSection === 'automation' && activeView === 'automation'}
          label={t('sidebar.nav.automation')}
          icon={<Zap size={16} strokeWidth={1.75} />}
          onClick={() => onNav('automation')}
        />
      </nav>

      <div
        className="min-h-0 flex-1 overflow-y-auto px-2 py-2"
        data-testid="sidebar-list"
        role="region"
        aria-label={listLabel}
      >
        <div className="mb-1.5 flex items-center justify-between px-2">
          <span
            id="sidebar-list-heading"
            className="text-caption font-medium text-ink-tertiary"
          >
            {listLabel}
          </span>
          {sidebarSection === 'knowledge' ? (
            <button
              type="button"
              data-testid="sidebar-new-space"
              data-no-drag
              onClick={() => openCreateKnowledgeSpaceDialog()}
              className="rounded-sm px-1.5 py-0.5 text-caption text-ink-tertiary transition-colors duration-chrome hover:bg-state-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
            >
              {t('sidebar.newSpace')}
            </button>
          ) : sidebarSection === 'projects' ? (
            <button
              type="button"
              data-testid="sidebar-new-task"
              data-new-session="code"
              data-no-drag
              onClick={() => void newConversationFromSidebar('code')}
              className="rounded-sm px-1.5 py-0.5 text-caption text-ink-tertiary transition-colors duration-chrome hover:bg-state-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
            >
              {t('sidebar.newTask')}
            </button>
          ) : sidebarSection === 'chats' ? (
            <button
              type="button"
              data-testid="sidebar-new-chat-list"
              data-new-session="chat"
              data-no-drag
              onClick={() => void newConversationFromSidebar('chat')}
              className="rounded-sm px-1.5 py-0.5 text-caption text-ink-tertiary transition-colors duration-chrome hover:bg-state-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
            >
              {t('sidebar.newChat')}
            </button>
          ) : sidebarSection === 'terminals' && TERMINAL_MANAGEMENT ? (
            <QuickConnectPopover />
          ) : sidebarSection === 'tasks' && WORK_ITEM_TRACKING ? (
            <button
              type="button"
              data-testid="sidebar-new-work-item"
              data-no-drag
              onClick={() => {
                void (async () => {
                  await enterWorkItemsSection()
                  const { useWorkItemViewStore } = await import(
                    '@/store/workItemViewStore'
                  )
                  useWorkItemViewStore.getState().requestCreate()
                })()
              }}
              className="rounded-sm px-1.5 py-0.5 text-caption text-ink-tertiary transition-colors duration-chrome hover:bg-state-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
            >
              {t('sidebar.newWorkItem')}
            </button>
          ) : sidebarSection === 'automation' && AUTOMATION_PAGE ? (
            <button
              type="button"
              data-testid="sidebar-new-automation"
              data-no-drag
              onClick={() => {
                void (async () => {
                  await enterAutomationsSection()
                  const { useAutomationStore } = await import(
                    '@/store/automationStore'
                  )
                  useAutomationStore.getState().requestCreate()
                })()
              }}
              className="rounded-sm px-1.5 py-0.5 text-caption text-ink-tertiary transition-colors duration-chrome hover:bg-state-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
            >
              {t('sidebar.newAutomation')}
            </button>
          ) : null}
        </div>

        {sidebarSection === 'tasks' && WORK_ITEM_TRACKING ? (
          <WorkItemSidebarLists />
        ) : sidebarSection === 'automation' && AUTOMATION_PAGE ? (
          <AutomationSidebarList />
        ) : sidebarSection === 'terminals' && TERMINAL_MANAGEMENT ? (
          managedTerminals.length === 0 ? (
            <div
              className="flex flex-col items-center gap-1 px-3 py-6 text-center"
              role="status"
              data-testid="sidebar-terminals-empty"
            >
              <p className="text-meta text-ink-tertiary">{t('terminals.sidebarEmpty')}</p>
              <p className="text-caption leading-relaxed text-ink-tertiary/80">
                {t('terminals.emptyHint')}
              </p>
            </div>
          ) : (
            <ul
              className="m-0 list-none p-0"
              aria-labelledby="sidebar-list-heading"
              data-testid="sidebar-managed-terminals"
            >
              {managedTerminals.map((mt) => {
                const active = focusedManagedId === mt.id && activeView === 'terminals'
                const ptyStatus = terminalBySession[mt.id]?.status ?? 'idle'
                const terminalSessions = terminalSessionsFor(sessions, mt.id)
                const hasChildren = mt.kind === 'ssh' && terminalSessions.length > 0
                const expanded =
                  hasChildren && sidebarExpanded[mt.id] !== false
                const activeAgentSession = activeAgentSessionByTerminal[mt.id] ?? null
                const activeAgentTab =
                  focusedManagedId === mt.id
                    ? (activeTerminalTabByTerminal ?? {})[mt.id] ?? 'files'
                    : 'files'
                const statusLabel =
                  mt.kind === 'ssh'
                    ? mt.status === 'connected'
                      ? t('terminals.connected')
                      : mt.status === 'error'
                        ? t('terminals.statusError')
                        : mt.status === 'disconnected'
                          ? t('terminals.disconnected')
                          : t('terminals.connecting')
                    : ptyStatus === 'exited'
                      ? t('terminals.statusExited')
                      : t('terminals.kindLocal')
                return (
                  <li key={mt.id}>
                    <DeclarativeContextMenu
                      kind="managedTerminal"
                      payload={{
                        terminalId: mt.id,
                        kind: mt.kind,
                        title: mt.title,
                      }}
                      className="mb-0.5 block w-full"
                    >
                      <button
                        type="button"
                        data-testid={`sidebar-managed-terminal-${mt.id}`}
                        data-no-drag
                        aria-current={active ? 'true' : undefined}
                        aria-expanded={hasChildren ? expanded : undefined}
                        aria-busy={ptyStatus === 'running' || undefined}
                        title={
                          mt.kind === 'local'
                            ? mt.cwd || t('terminals.kindLocal')
                            : t('terminals.kindSsh')
                        }
                        onClick={() => {
                          useManagedTerminalStore.getState().focus(mt.id)
                          if (activeView !== 'terminals') {
                            void enterTerminalsSection()
                          }
                        }}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-lg px-2.5 py-[var(--row-pad-y-session)] text-left transition-colors',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
                          active ? SIDEBAR_ACTIVE_RAIL : 'hover:bg-state-hover',
                        )}
                      >
                        {hasChildren ? (
                          <button
                            type="button"
                            aria-label={
                              expanded
                                ? t('terminals.collapseGroup')
                                : t('terminals.expandGroup')
                            }
                            data-testid={`sidebar-managed-terminal-chevron-${mt.id}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              useTerminalAgentStore.getState().toggleSidebarExpanded(mt.id)
                            }}
                            className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-ink-tertiary hover:bg-state-hover"
                          >
                            {expanded ? (
                              <ChevronDown size={12} aria-hidden />
                            ) : (
                              <ChevronRight size={12} aria-hidden />
                            )}
                          </button>
                        ) : (
                          <span className="w-4 shrink-0" aria-hidden />
                        )}
                        {ptyStatus === 'running' ? (
                          <span
                            className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent"
                            data-testid={`sidebar-managed-terminal-running-${mt.id}`}
                            title={t('sidebar.status.running')}
                            aria-hidden
                          />
                        ) : (
                          <Terminal
                            size={14}
                            className="shrink-0 text-ink-tertiary"
                            aria-hidden
                          />
                        )}
                        <span className="min-w-0 flex-1 truncate text-body font-medium text-ink">
                          {mt.title}
                        </span>
                        <span
                          className={cn(
                            'shrink-0 text-caption',
                            mt.kind === 'ssh' && mt.status === 'error'
                              ? 'text-danger'
                              : mt.kind === 'ssh' && mt.status !== 'connected'
                                ? 'text-ink-tertiary'
                                : mt.kind === 'ssh'
                                  ? 'text-accent'
                                  : 'text-ink-tertiary',
                          )}
                          aria-hidden
                        >
                          {statusLabel}
                        </span>
                      </button>
                    </DeclarativeContextMenu>
                    {hasChildren && expanded ? (
                      <ul
                        role="group"
                        aria-label={t('terminals.agent.sessionsGroup', { title: mt.title })}
                        className="m-0 mb-0.5 list-none p-0 pl-[34px]"
                        data-testid={`sidebar-terminal-sessions-${mt.id}`}
                      >
                        {terminalSessions.map((ts) => {
                          const childActive =
                            active &&
                            activeAgentSession === ts.id &&
                            activeAgentTab === 'agent'
                          return (
                            <li key={ts.id}>
                              <DeclarativeContextMenu
                                kind="terminalAgentSession"
                                payload={{
                                  sessionId: ts.id,
                                  terminalId: mt.id,
                                  hostId: mt.hostId,
                                  title: ts.title,
                                }}
                                className="mb-0.5 block w-full"
                              >
                                <button
                                  type="button"
                                  data-testid={`sidebar-terminal-session-${ts.id}`}
                                  aria-current={childActive ? 'true' : undefined}
                                  onClick={() =>
                                    sessionService.focusTerminalAgentSession(mt.id, ts.id)
                                  }
                                  className={cn(
                                    'flex w-full items-center gap-1.5 rounded-lg px-2 py-[var(--row-pad-y-session)] text-left transition-colors',
                                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
                                    childActive ? SIDEBAR_ACTIVE_RAIL : 'hover:bg-state-hover',
                                  )}
                                >
                                  <MessageSquare
                                    size={12}
                                    className="shrink-0 text-ink-tertiary"
                                    aria-hidden
                                  />
                                  <span className="min-w-0 flex-1 truncate text-body text-ink">
                                    {ts.title}
                                  </span>
                                  {ts.config.agentId && ts.config.agentId !== 'builtin' ? (
                                    <span className="shrink-0 text-caption text-ink-tertiary">
                                      {ts.config.agentId}
                                    </span>
                                  ) : null}
                                </button>
                              </DeclarativeContextMenu>
                            </li>
                          )
                        })}
                      </ul>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )
        ) : isPlaceholderSidebarSection(sidebarSection) ? (
          <p className="px-2 py-4 text-center text-meta text-ink-tertiary" role="status">
            {t('placeholder.comingSoon')}
          </p>
        ) : sidebarSection === 'knowledge' ? (
          filteredSpaces.length === 0 ? (
            <p className="px-2 py-4 text-center text-meta text-ink-tertiary" role="status">
              {t('sidebar.emptySpaces')}
            </p>
          ) : (
            <ul className="m-0 list-none p-0" aria-labelledby="sidebar-list-heading">
              {filteredSpaces.map((sp) => {
                const active = activeView === 'knowledge' && activeSpaceId === sp.id
                return (
                  <li key={sp.id}>
                    <DeclarativeContextMenu
                      kind="knowledgeSpace"
                      payload={{ spaceId: sp.id, name: sp.name, icon: sp.icon }}
                      className="mb-0.5 block w-full"
                    >
                      <button
                        type="button"
                        data-testid={`sidebar-space-${sp.id}`}
                        data-space-name={sp.name}
                        data-no-drag
                        aria-current={active ? 'true' : undefined}
                        onClick={() => void openSpaceFromSidebar(sp.id)}
                        className={cn(
                          'flex w-full items-start gap-2 rounded-lg px-2.5 py-[var(--row-pad-y-session)] text-left transition-colors',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
                          active ? SIDEBAR_ACTIVE_RAIL : 'hover:bg-state-hover',
                        )}
                      >
                        {sp.icon ? (
                          <span
                            className="mt-0.5 shrink-0 text-body leading-none"
                            aria-hidden
                          >
                            {sp.icon}
                          </span>
                        ) : null}
                        <span className="min-w-0 flex-1 truncate text-body font-medium text-ink">
                          {sp.name}
                        </span>
                      </button>
                    </DeclarativeContextMenu>
                  </li>
                )
              })}
            </ul>
          )
        ) : filteredSessions.length === 0 ? (
          <p className="px-2 py-4 text-center text-meta text-ink-tertiary" role="status">
            {t('sidebar.emptySessions')}
          </p>
        ) : sidebarSection === 'projects' ? (
          <ul className="m-0 list-none p-0" aria-labelledby="sidebar-list-heading">
            {projectSessionGroups.map((group) => {
              const groupId = group.pathKey || '__unbound'
              const groupLabel = group.label || t('sidebar.projectGroup.unbound')
              const groupTitle = group.cwd || t('sidebar.projectGroup.unbound')
              const pathEntry = group.pathKey
                ? pathStatusByKey[projectPathKey(group.pathKey)]
                : undefined
              const pathMissing = !!group.pathKey && pathEntry?.exists === false
              const headerTitle = pathMissing
                ? t('sidebar.projectGroup.missingTitle', { path: groupTitle })
                : groupTitle
              const groupExpanded = isProjectGroupExpanded(groupId)
              return (
                <li
                  key={groupId}
                  className="mb-2"
                  data-testid={`sidebar-project-group-${groupId}`}
                  data-path-missing={pathMissing ? 'true' : undefined}
                >
                  <button
                    type="button"
                    className={cn(
                      'mb-0.5 flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left',
                      'transition-colors hover:bg-state-hover',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
                    )}
                    title={headerTitle}
                    data-testid={`sidebar-project-group-header-${groupId}`}
                    data-no-drag
                    aria-expanded={groupExpanded}
                    aria-label={
                      groupExpanded
                        ? t('sidebar.projectGroup.collapse', { name: groupLabel })
                        : t('sidebar.projectGroup.expand', { name: groupLabel })
                    }
                    onClick={() => toggleProjectGroup(groupId)}
                  >
                    {groupExpanded ? (
                      <ChevronDown size={12} className="shrink-0 text-ink-tertiary" aria-hidden />
                    ) : (
                      <ChevronRight size={12} className="shrink-0 text-ink-tertiary" aria-hidden />
                    )}
                    {pathMissing ? (
                      <AlertTriangle
                        size={12}
                        className="shrink-0 text-warning"
                        aria-hidden
                      />
                    ) : (
                      <Folder size={12} className="shrink-0 text-ink-tertiary" aria-hidden />
                    )}
                    <span
                      className={cn(
                        'min-w-0 flex-1 truncate text-caption font-medium',
                        pathMissing ? 'text-warning' : 'text-ink-secondary',
                      )}
                    >
                      {groupLabel}
                    </span>
                    {pathMissing ? (
                      <span
                        className="shrink-0 rounded-md bg-warning/15 px-1.5 py-px text-caption font-medium text-warning"
                        data-testid={`sidebar-project-group-missing-${groupId}`}
                      >
                        {t('sidebar.projectGroup.missingBadge')}
                      </span>
                    ) : !groupExpanded || group.sessions.length > 1 ? (
                      <span className="shrink-0 tabular-nums text-caption text-ink-tertiary">
                        {group.sessions.length}
                      </span>
                    ) : null}
                  </button>
                  {groupExpanded ? (
                    <ul className="m-0 list-none p-0" aria-label={groupTitle}>
                      {group.sessions.map((session) => (
                        <SidebarSessionRow
                          key={session.id}
                          session={session}
                          activeSessionId={activeSessionId}
                          activeView={activeView}
                          
                        />
                      ))}
                    </ul>
                  ) : null}
                </li>
              )
            })}
          </ul>
        ) : sidebarSection === 'chats' ? (
          <ul className="m-0 list-none p-0" aria-labelledby="sidebar-list-heading">
            {chatDateGroups.map((group) => {
              const groupExpanded = isChatDateGroupExpanded(group.bucketId)
              const groupLabel = t(`sidebar.dateGroup.${group.bucketId}`)
              return (
                <li
                  key={group.bucketId}
                  className="mb-2"
                  data-testid={`sidebar-chat-date-group-${group.bucketId}`}
                >
                  <button
                    type="button"
                    className={cn(
                      'mb-0.5 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left',
                      'transition-colors hover:bg-state-hover',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
                    )}
                    data-testid={`sidebar-chat-date-group-header-${group.bucketId}`}
                    data-no-drag
                    aria-expanded={groupExpanded}
                    aria-label={
                      groupExpanded
                        ? t('sidebar.dateGroup.collapse', { name: groupLabel })
                        : t('sidebar.dateGroup.expand', { name: groupLabel })
                    }
                    onClick={() => toggleChatDateGroup(group.bucketId)}
                  >
                    {groupExpanded ? (
                      <ChevronDown size={12} className="shrink-0 text-ink-tertiary" aria-hidden />
                    ) : (
                      <ChevronRight size={12} className="shrink-0 text-ink-tertiary" aria-hidden />
                    )}
                    <span className="min-w-0 flex-1 truncate text-caption font-medium text-ink-secondary">
                      {groupLabel}
                    </span>
                    {!groupExpanded || group.sessions.length > 1 ? (
                      <span className="shrink-0 tabular-nums text-caption text-ink-tertiary">
                        {group.sessions.length}
                      </span>
                    ) : null}
                  </button>
                  {groupExpanded ? (
                    <ul className="m-0 list-none p-0" aria-label={groupLabel}>
                      {group.sessions.map((session) => (
                        <SidebarSessionRow
                          key={session.id}
                          session={session}
                          activeSessionId={activeSessionId}
                          activeView={activeView}
                          
                        />
                      ))}
                    </ul>
                  ) : null}
                </li>
              )
            })}
          </ul>
        ) : (
          <ul className="m-0 list-none p-0" aria-labelledby="sidebar-list-heading">
            {filteredSessions.map((session) => (
              <SidebarSessionRow
                key={session.id}
                session={session}
                activeSessionId={activeSessionId}
                activeView={activeView}
                
              />
            ))}
          </ul>
        )}
      </div>

      <SidebarAccountFooter
        active={sidebarFooterActive({ overlay })}
        historyCount={historyCount}
        onOpenTrash={() => toggleTrashOverlay()}
        onOpenHistory={() => toggleHistoryOverlay()}
        onOpenSettings={() => void openSettingsFromChrome()}
      />
        </>
      )}

      {/* Edge resize — overlaps the border so the hit target is easy without a layout gap. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t('sidebar.resizeAria')}
        aria-valuenow={sidebarWidth}
        aria-valuemin={SIDEBAR_WIDTH_MIN}
        aria-valuemax={SIDEBAR_WIDTH_MAX}
        tabIndex={0}
        data-testid="sidebar-resize-handle"
        data-dragging={resizing ? 'true' : undefined}
        onPointerDown={onResizePointerDown}
        onDoubleClick={() => setSidebarWidth(SIDEBAR_WIDTH_DEFAULT)}
        onKeyDown={onResizeKeyDown}
        className="group absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize touch-none outline-none focus-visible:ring-1 focus-visible:ring-ink/20"
      >
        <div
          className={cn(
            'mx-auto h-full w-px bg-transparent transition-colors duration-chrome',
            'group-hover:bg-accent group-focus-visible:bg-accent group-data-[dragging=true]:bg-accent',
          )}
          aria-hidden
        />
      </div>
    </aside>
  )
}

function SidebarSessionRow({
  session,
  activeSessionId,
  activeView,
}: {
  session: SessionVM
  activeSessionId: string | null
  activeView: string
}) {
  const { t } = useTranslation()
  const sidebarSection = useUiStore((s) => s.sidebarSection)

  const surface = surfaceOf(session.config)
  const active =
    session.id === activeSessionId && (activeView === 'chat' || activeView === 'code')
  const running = session.status === 'running'
  const surfaceLabel = surface === 'code' ? t('sidebar.badge.code') : t('sidebar.badge.chat')
  const ariaLabel = running
    ? `${session.title}, ${surfaceLabel}, ${t('sidebar.status.running')}`
    : `${session.title}, ${surfaceLabel}`

  // Session rows sit one level below their group header; indent the title to the
  // header label column so the folder/date → session hierarchy stays aligned.
  // projects: px-2 + 12px chevron + 4 + 12px folder icon + 4 → label at 48px (pl-10)
  // chats:    px-2 + 12px chevron + 6          → label at 34px (pl-[26px])
  const indentClass = sidebarSection === 'projects' ? 'pl-10' : 'pl-[26px]'

  return (
    <li data-testid={`sidebar-session-group-${session.id}`}>
      <DeclarativeContextMenu
        kind="sessionHistory"
        payload={{
          sessionId: session.id,
          title: session.title,
          surface: surface === 'terminal' ? 'chat' : surface,
        }}
        className="mb-0.5 block w-full"
      >
        <div
          className={cn(
            'flex w-full items-center gap-0.5 rounded-lg transition-colors',
            active ? SIDEBAR_ACTIVE_RAIL : 'hover:bg-state-hover',
          )}
        >
          <button
            type="button"
            data-testid={`sidebar-session-${session.id}`}
            // Legacy e2e gate selectors (title-bar tabs removed).
            data-session-tab="true"
            data-session-id={session.id}
            data-session-status={session.status}
            aria-selected={active ? 'true' : 'false'}
            aria-busy={running || undefined}
            data-no-drag
            aria-current={active ? 'true' : undefined}
            aria-label={ariaLabel}
            onClick={() => void selectSessionFromSidebar(session.id)}
            className={cn(
              'flex min-w-0 flex-1 items-center gap-2 py-[var(--row-pad-y-session)] pr-2.5 text-left',
              indentClass,
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20 rounded-r-lg',
            )}
          >
            {running ? (
              <span
                className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent"
                data-testid={`sidebar-session-running-${session.id}`}
                title={t('sidebar.status.running')}
                aria-hidden
              />
            ) : null}
            <span className="flex min-w-0 flex-1 items-center gap-1">
              <span className="block min-w-0 truncate text-body font-medium text-ink" aria-hidden>
                {session.title}
              </span>
            </span>
            <span
              className={cn(
                'shrink-0 rounded-md px-1.5 py-px text-caption',
                surface === 'code' ? 'text-success' : 'text-accent',
              )}
              aria-hidden
            >
              {surfaceLabel}
            </span>
          </button>
        </div>
      </DeclarativeContextMenu>
    </li>
  )
}


function NavItem({
  section,
  active,
  label,
  icon,
  count,
  onClick,
}: {
  section: SidebarSection
  active: boolean
  label: string
  icon: ReactNode
  count?: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      data-testid={`sidebar-nav-${section}`}
      data-no-drag
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      className={cn(
        'flex h-[var(--row-h-sidebar)] w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-body font-medium transition-[background-color,color] duration-chrome ease-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
        active ? SIDEBAR_ACTIVE_RAIL : 'text-ink-secondary hover:bg-state-hover hover:text-ink',
      )}
    >
      <span className="shrink-0 opacity-70">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count != null ? (
        <span className="shrink-0 tabular-nums text-caption text-ink-tertiary">{count}</span>
      ) : null}
    </button>
  )
}
