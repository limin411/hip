// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUiStore } from '@/store/uiStore'
import { sessionService, useDomainStore } from '@/domain'
import { DEFAULT_CONFIG } from '@/domain/sessionStore'
import { useManagedTerminalStore } from '@/store/managedTerminalStore'
import { useTerminalAgentStore } from '@/store/terminalAgentStore'
import { useProjectPathStore } from '@/store/projectPathStore'
import { useNavHistoryStore } from '@/store/navHistoryStore'

const enterKnowledge = vi.fn(async () => {})
const enterSection = vi.fn(async (_section: 'projects' | 'chats') => {})
const enterPlaceholderSection = vi.fn(
  async (_section: 'tasks' | 'automation') => {},
)
const enterTerminalsSection = vi.fn(async (_opts?: { library?: boolean }) => {})
const enterWorkItemsSection = vi.fn(async () => {})
const enterAutomationsSection = vi.fn(async () => {})
const toggleHistoryOverlay = vi.fn(() => {})
const toggleTrashOverlay = vi.fn(() => {})
const newConversationFromSidebar = vi.fn(async (_surface: 'chat' | 'code') => {})
const selectSessionFromSidebar = vi.fn(async (_id: string) => {})

vi.mock('./sidebarActions', () => ({
  enterKnowledge: () => enterKnowledge(),
  enterSection: (section: 'projects' | 'chats') => enterSection(section),
  enterPlaceholderSection: (section: 'tasks' | 'automation') =>
    enterPlaceholderSection(section),
  enterTerminalsSection: (opts?: { library?: boolean }) => enterTerminalsSection(opts),
  enterWorkItemsSection: () => enterWorkItemsSection(),
  enterAutomationsSection: () => enterAutomationsSection(),
  openHistoryFromChrome: vi.fn(),
  openSettingsFromChrome: vi.fn(),
  openAutomationFromChrome: vi.fn(),
  openTrashFromChrome: vi.fn(),
  closeOverlay: vi.fn(),
  toggleHistoryOverlay: () => toggleHistoryOverlay(),
  toggleTrashOverlay: () => toggleTrashOverlay(),
  leaveKnowledge: vi.fn(async () => {}),
  leaveWorkItems: vi.fn(async () => {}),
  selectSessionFromSidebar: (id: string) => selectSessionFromSidebar(id),
  newConversationFromSidebar: (surface: 'chat' | 'code') => newConversationFromSidebar(surface),
}))

vi.mock('./SidebarAccountFooter', () => ({
  SidebarAccountFooter: () => <div data-testid="sidebar-account-footer" />,
}))

vi.mock('@/ipc/pathExists', () => ({
  isDirectory: vi.fn(async () => null),
}))

vi.mock('@/components/context-menu', () => ({
  DeclarativeContextMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const knowledgeState = {
  spaces: [] as { id: string; name: string }[],
  activeSpaceId: null as string | null,
  nodes: [] as { id: string; parentId: string | null; kind: string; title: string }[],
  currentFolderId: null as string | null,
  activeDocId: null as string | null,
  busy: false,
  recent: [] as { spaceId: string; docId: string; title: string; spaceName: string; at: number }[],
  enterFolder: vi.fn(async () => {}),
  goUp: vi.fn(async () => {}),
  navigateTo: vi.fn(async () => {}),
  openDoc: vi.fn(async () => {}),
  openRecent: vi.fn(async () => {}),
  dropRecent: vi.fn(() => {}),
  createFolder: vi.fn(async () => {}),
  requestCreateDoc: vi.fn(async () => {}),
  renameNode: vi.fn(async () => {}),
  deleteNode: vi.fn(async () => {}),
}

vi.mock('@/store/knowledgeStore', () => {
  const useKnowledgeStore = (sel: (s: typeof knowledgeState) => unknown) => sel(knowledgeState)
  useKnowledgeStore.getState = () => knowledgeState
  return { useKnowledgeStore }
})

import { AppSidebar } from './AppSidebar'

describe('AppSidebar', () => {
  beforeEach(() => {
    enterKnowledge.mockClear()
    enterSection.mockClear()
    enterPlaceholderSection.mockClear()
    enterTerminalsSection.mockClear()
    enterWorkItemsSection.mockClear()
    enterAutomationsSection.mockClear()
    toggleHistoryOverlay.mockClear()
    toggleTrashOverlay.mockClear()
    newConversationFromSidebar.mockClear()
    selectSessionFromSidebar.mockClear()
    knowledgeState.spaces = []
    knowledgeState.activeSpaceId = null
    knowledgeState.nodes = []
    knowledgeState.currentFolderId = null
    knowledgeState.activeDocId = null
    knowledgeState.recent = []
    useNavHistoryStore.setState({ stack: [], index: -1, applying: false })
    useUiStore.setState({
      activeView: 'chat',
      sidebarSection: 'chats',
      sidebarOpen: true,
      overlay: null,
    })
    useDomainStore.setState({
      sessions: [
        {
          id: 'chat-1',
          title: 'Hello chat',
          preview: 'preview text',
          updatedAtMs: Date.now(),
          config: { ...DEFAULT_CONFIG, surface: 'chat' },
          messages: [],
          status: 'idle',
          loaded: true,
          error: null,
        },
        {
          id: 'code-1',
          title: 'Code project',
          preview: 'repo work',
          updatedAtMs: Date.now() - 1000,
          config: { ...DEFAULT_CONFIG, surface: 'code' },
          messages: [],
          status: 'idle',
          loaded: true,
          error: null,
        },
      ],
      activeSessionId: 'chat-1',
    } as never)
  })

  afterEach(() => {
    useProjectPathStore.setState({ byKey: {} })
    cleanup()
  })

  it('renders nav and chat sessions for chats section', () => {
    render(<AppSidebar />)
    expect(screen.getByTestId('app-sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-nav-back')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-nav-forward')).toBeInTheDocument()
    expect(screen.queryByTestId('sidebar-search')).not.toBeInTheDocument()
    expect(screen.getByTestId('sidebar-toggle')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-app-version')).toHaveTextContent(/^HIP \d+\.\d+\.\d+/)
    expect(screen.getByTestId('sidebar-nav-terminals')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-nav-tasks')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-nav-automation')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-nav-chats')).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTestId('sidebar-session-chat-1')).toBeInTheDocument()
    expect(screen.queryByTestId('sidebar-session-code-1')).not.toBeInTheDocument()
  })

  it('back/forward sit right of collapse and start disabled after seed', () => {
    render(<AppSidebar />)
    const back = screen.getByTestId('sidebar-nav-back')
    const forward = screen.getByTestId('sidebar-nav-forward')
    const toggle = screen.getByTestId('sidebar-toggle')
    expect(back).toBeDisabled()
    expect(forward).toBeDisabled()
    // DOM order: toggle, back, forward
    const parent = toggle.parentElement
    expect(parent).toBeTruthy()
    const buttons = within(parent!).getAllByRole('button')
    expect(buttons[0]).toBe(toggle)
    expect(buttons[1]).toBe(back)
    expect(buttons[2]).toBe(forward)
  })

  it('active nav uses surface wash without left rail or hairline ring', () => {
    render(<AppSidebar />)
    const chats = screen.getByTestId('sidebar-nav-chats')
    expect(chats).not.toHaveClass('before:bg-accent')
    expect(chats).toHaveClass('bg-state-active')
    expect(chats.className).not.toMatch(/shadow-\[0_0_0_1px/)
    const projects = screen.getByTestId('sidebar-nav-projects')
    expect(projects).not.toHaveClass('before:bg-accent')
    expect(projects).toHaveClass('hover:bg-state-hover')
  })

  it('active session row uses surface wash without left rail or hairline ring', () => {
    render(<AppSidebar />)
    const sessionBtn = screen.getByTestId('sidebar-session-chat-1')
    const row = sessionBtn.closest('div')
    expect(row).not.toHaveClass('before:bg-accent')
    expect(row).toHaveClass('bg-state-active')
    expect(row?.className).not.toMatch(/shadow-\[0_0_0_1px/)
  })

  it('shows session counts on projects and chats nav', () => {
    render(<AppSidebar />)
    expect(screen.getByTestId('sidebar-nav-chats')).toHaveTextContent('1')
    expect(screen.getByTestId('sidebar-nav-projects')).toHaveTextContent('1')
  })

  it('toggle button collapses the sidebar', () => {
    useUiStore.setState({ sidebarOpen: true })
    render(<AppSidebar />)
    fireEvent.click(screen.getByTestId('sidebar-toggle'))
    expect(useUiStore.getState().sidebarOpen).toBe(false)
  })

  it('applies sidebarWidth from the store', () => {
    useUiStore.setState({ sidebarWidth: 320 })
    render(<AppSidebar />)
    expect(screen.getByTestId('app-sidebar')).toHaveStyle({ width: '320px' })
  })

  it('resize handle drag updates sidebarWidth', () => {
    useUiStore.setState({ sidebarWidth: 300 })
    render(<AppSidebar />)
    const handle = screen.getByTestId('sidebar-resize-handle')
    fireEvent.pointerDown(handle, { button: 0, clientX: 300 })
    fireEvent.pointerMove(window, { clientX: 360 })
    fireEvent.pointerUp(window, { button: 0, clientX: 360 })
    expect(useUiStore.getState().sidebarWidth).toBe(360)
  })

  it('resize handle keyboard arrows nudge width; double-click resets', () => {
    useUiStore.setState({ sidebarWidth: 300 })
    render(<AppSidebar />)
    const handle = screen.getByTestId('sidebar-resize-handle')
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(useUiStore.getState().sidebarWidth).toBe(316)
    fireEvent.doubleClick(handle)
    expect(useUiStore.getState().sidebarWidth).toBe(300)
  })

  it('nav knowledge calls enterKnowledge', () => {
    render(<AppSidebar />)
    fireEvent.click(screen.getByTestId('sidebar-nav-knowledge'))
    expect(enterKnowledge).toHaveBeenCalled()
  })

  it('nav projects calls enterSection projects', () => {
    render(<AppSidebar />)
    fireEvent.click(screen.getByTestId('sidebar-nav-projects'))
    expect(enterSection).toHaveBeenCalledWith('projects')
  })


  it('nav terminals opens library landing (not last focused session)', () => {
    render(<AppSidebar />)
    fireEvent.click(screen.getByTestId('sidebar-nav-terminals'))
    expect(enterTerminalsSection).toHaveBeenCalledWith({ library: true })
    expect(enterPlaceholderSection).not.toHaveBeenCalledWith('terminals')
  })

  it('nav tasks calls enterWorkItemsSection when WORK_ITEM_TRACKING is on', () => {
    render(<AppSidebar />)
    fireEvent.click(screen.getByTestId('sidebar-nav-tasks'))
    expect(enterWorkItemsSection).toHaveBeenCalled()
    expect(enterPlaceholderSection).not.toHaveBeenCalledWith('tasks')
  })

  it('nav automation is below tasks and calls enterAutomationsSection when AUTOMATION_PAGE is on', () => {
    render(<AppSidebar />)
    const tasks = screen.getByTestId('sidebar-nav-tasks')
    const automation = screen.getByTestId('sidebar-nav-automation')
    expect(tasks.compareDocumentPosition(automation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(automation)
    expect(enterAutomationsSection).toHaveBeenCalled()
    expect(enterPlaceholderSection).not.toHaveBeenCalledWith('automation')
  })

  it('chats section new chat starts chat conversation', () => {
    render(<AppSidebar />)
    fireEvent.click(screen.getByTestId('sidebar-new-chat-list'))
    expect(newConversationFromSidebar).toHaveBeenCalledWith('chat')
  })

  it('projects section new task starts code conversation', () => {
    useUiStore.setState({ sidebarSection: 'projects' })
    render(<AppSidebar />)
    fireEvent.click(screen.getByTestId('sidebar-new-task'))
    expect(newConversationFromSidebar).toHaveBeenCalledWith('code')
  })

  it('knowledge section renders single-level dir nav (no space list)', () => {
    useUiStore.setState({ sidebarSection: 'knowledge', activeView: 'knowledge' })
    knowledgeState.nodes = [
      { id: 'nod_a', parentId: null, kind: 'folder', title: 'A' },
      { id: 'doc_1', parentId: null, kind: 'doc', title: 'D' },
    ]
    render(<AppSidebar />)
    expect(screen.getByTestId('dir-nav-list')).toBeInTheDocument()
    expect(screen.getByTestId('dir-row-nod_a')).toBeInTheDocument()
    expect(screen.getByTestId('dir-row-doc_1')).toBeInTheDocument()
    // 空间列表不再渲染
    expect(screen.queryByTestId('sidebar-new-space')).not.toBeInTheDocument()
  })

  it('knowledge recent block is hidden when the recent list is empty (V2-N1)', () => {
    useUiStore.setState({ sidebarSection: 'knowledge', activeView: 'knowledge' })
    knowledgeState.recent = []
    render(<AppSidebar />)
    expect(screen.queryByTestId('sidebar-knowledge-recent')).not.toBeInTheDocument()
  })

  it('knowledge recent block lists recent docs; click opens via openRecent (V2-N1)', () => {
    useUiStore.setState({ sidebarSection: 'knowledge', activeView: 'knowledge' })
    knowledgeState.recent = [
      {
        spaceId: 'sp1',
        docId: 'doc_recent',
        title: '版本发布说明',
        spaceName: '产品手册',
        at: Date.now() - 60_000,
      },
    ]
    render(<AppSidebar />)
    const block = screen.getByTestId('sidebar-knowledge-recent')
    expect(block).toBeInTheDocument()
    const row = screen.getByTestId('sidebar-recent-doc_recent')
    expect(row).toHaveTextContent('版本发布说明')
    fireEvent.click(row)
    expect(knowledgeState.openRecent).toHaveBeenCalledWith(
      expect.objectContaining({ spaceId: 'sp1', docId: 'doc_recent' }),
    )
  })

  it('knowledge recent caps the displayed rows at 8 (V2-N1)', () => {
    useUiStore.setState({ sidebarSection: 'knowledge', activeView: 'knowledge' })
    knowledgeState.recent = Array.from({ length: 12 }, (_, i) => ({
      spaceId: 'sp1',
      docId: `doc_${i}`,
      title: `Doc ${i}`,
      spaceName: '产品手册',
      at: Date.now() - i * 60_000,
    }))
    render(<AppSidebar />)
    expect(screen.getAllByTestId(/^sidebar-recent-/)).toHaveLength(8)
  })

  it('terminals section shows a single new button that opens a popover', () => {
    useUiStore.setState({ sidebarSection: 'terminals', activeView: 'terminals' })
    render(<AppSidebar />)
    // One trailing action (like chat / code / knowledge) — not multiple inline buttons.
    expect(screen.getByTestId('sidebar-new-terminal')).toBeInTheDocument()
    expect(screen.queryByTestId('sidebar-new-group')).not.toBeInTheDocument()
    expect(screen.queryByTestId('sidebar-new-local-terminal')).not.toBeInTheDocument()
    expect(screen.queryByTestId('sidebar-new-remote-host')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('sidebar-new-terminal'))
    expect(screen.getByTestId('terminals-new-popover')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-new-group')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-new-local-terminal')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-new-remote-host')).toBeInTheDocument()
  })

  it('ssh terminal row expands into agent session children; local has none', async () => {
    useUiStore.setState({ sidebarSection: 'terminals', activeView: 'terminals' })
    useManagedTerminalStore.setState({
      terminals: [
        {
          id: 'tm_ssh1',
          kind: 'ssh',
          title: 'ops',
          hostId: 'hst_1',
          remotePath: '/var/www',
          status: 'connected',
          createdAt: 1,
        },
        {
          id: 'tm_local1',
          kind: 'local',
          title: 'home',
          cwd: '/tmp',
          status: 'connected',
          createdAt: 2,
        },
      ],
      focusedId: null,
    })
    useTerminalAgentStore.setState({ sidebarExpanded: {}, activeSessionByTerminal: {} })
    useDomainStore.setState((s) => ({
      sessions: [
        ...s.sessions.filter((x) => x.id !== 'chat-1' && x.id !== 'code-1'),
        {
          id: 'ta_1',
          title: 'disk check',
          preview: '',
          updatedAtMs: 10,
          config: {
            ...DEFAULT_CONFIG,
            surface: 'terminal',
            managedTerminalId: 'tm_ssh1',
            hostId: 'hst_1',
          },
          messages: [],
          status: 'idle',
          loaded: true,
          error: null,
        },
      ],
    }))
    const focusSpy = vi
      .spyOn(sessionService, 'focusTerminalAgentSession')
      .mockImplementation(() => {})
    render(<AppSidebar />)
    expect(screen.getByTestId('sidebar-managed-terminal-tm_ssh1')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-terminal-session-ta_1')).toBeInTheDocument()
    expect(screen.queryByTestId('sidebar-terminal-sessions-tm_local1')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('sidebar-terminal-session-ta_1'))
    expect(focusSpy).toHaveBeenCalledWith('tm_ssh1', 'ta_1')
    focusSpy.mockRestore()
  })

  it('terminals new group requests group creation from the host library', async () => {
    useUiStore.setState({ sidebarSection: 'terminals', activeView: 'terminals' })
    render(<AppSidebar />)
    fireEvent.click(screen.getByTestId('sidebar-new-terminal'))
    fireEvent.click(screen.getByTestId('sidebar-new-group'))
    const { useHostLibraryUi } = await import('@/components/terminals/hostLibraryUi')
    await waitFor(() => {
      expect(useHostLibraryUi.getState().pendingCreateGroup).toBe(true)
    })
  })

  it('knowledge nav row shows top-level item count', () => {
    knowledgeState.nodes = [
      { id: 'nod_a', parentId: null, kind: 'folder', title: 'A' },
      { id: 'nod_b', parentId: 'nod_a', kind: 'folder', title: 'B' },
      { id: 'doc_1', parentId: null, kind: 'doc', title: 'D' },
    ]
    useUiStore.setState({ sidebarSection: 'chats', activeView: 'chat' })
    render(<AppSidebar />)
    const nav = screen.getByTestId('sidebar-nav-knowledge')
    expect(nav.textContent).toContain('2')
  })

  it('lists current level rows only (single-level dir nav)', () => {
    knowledgeState.nodes = [
      { id: 'nod_root', parentId: null, kind: 'folder', title: 'Root' },
      { id: 'nod_child', parentId: 'nod_root', kind: 'folder', title: 'Child' },
      { id: 'doc_root', parentId: null, kind: 'doc', title: 'Top doc' },
    ]
    useUiStore.setState({ sidebarSection: 'knowledge', activeView: 'knowledge' })
    render(<AppSidebar />)
    const list = screen.getByTestId('sidebar-list')
    expect(within(list).getByTestId('dir-row-nod_root')).toBeInTheDocument()
    expect(within(list).getByTestId('dir-row-doc_root')).toBeInTheDocument()
    // 子层条目不渲染（单层级）
    expect(within(list).queryByTestId('dir-row-nod_child')).not.toBeInTheDocument()
  })

  it('session row calls selectSessionFromSidebar', () => {
    render(<AppSidebar />)
    fireEvent.click(screen.getByTestId('sidebar-session-chat-1'))
    expect(selectSessionFromSidebar).toHaveBeenCalledWith('chat-1')
  })

  it('shows a blinking running indicator while a session is running', () => {
    useDomainStore.setState({
      sessions: [
        {
          id: 'chat-1',
          title: 'Hello chat',
          preview: 'preview text',
          updatedAtMs: Date.now(),
          config: { ...DEFAULT_CONFIG, surface: 'chat' },
          messages: [],
          status: 'running',
          loaded: true,
        },
      ],
      activeSessionId: 'chat-1',
    } as never)
    render(<AppSidebar />)
    const indicator = screen.getByTestId('sidebar-session-running-chat-1')
    expect(indicator).toBeInTheDocument()
    expect(indicator).toHaveClass('animate-pulse')
    expect(screen.getByTestId('sidebar-session-chat-1')).toHaveAttribute(
      'data-session-status',
      'running',
    )
    expect(screen.getByTestId('sidebar-session-chat-1')).toHaveAttribute('aria-busy', 'true')
  })

  it('hides the running indicator after the session finishes', () => {
    useDomainStore.setState({
      sessions: [
        {
          id: 'chat-1',
          title: 'Hello chat',
          preview: 'preview text',
          updatedAtMs: Date.now(),
          config: { ...DEFAULT_CONFIG, surface: 'chat' },
          messages: [],
          status: 'idle',
          loaded: true,
        },
      ],
      activeSessionId: 'chat-1',
    } as never)
    render(<AppSidebar />)
    expect(screen.queryByTestId('sidebar-session-running-chat-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('sidebar-session-chat-1')).toHaveAttribute(
      'data-session-status',
      'idle',
    )
    expect(screen.getByTestId('sidebar-session-chat-1')).not.toHaveAttribute('aria-busy')
  })

  it('marks project group when path is missing on disk', () => {
    useUiStore.setState({ sidebarSection: 'projects', activeView: 'code' })
    useDomainStore.setState({
      sessions: [
        {
          id: 'code-gone',
          title: 'Orphan task',
          preview: 'x',
          updatedAtMs: Date.now(),
          config: { ...DEFAULT_CONFIG, surface: 'code', cwd: '/deleted/repo' },
          messages: [],
          status: 'idle',
          loaded: true,
        },
      ],
      activeSessionId: 'code-gone',
    } as never)
    useProjectPathStore.setState({
      byKey: { '/deleted/repo': { exists: false, checkedAt: Date.now() } },
    })
    render(<AppSidebar />)
    expect(screen.getByTestId('sidebar-project-group-/deleted/repo')).toHaveAttribute(
      'data-path-missing',
      'true',
    )
    expect(screen.getByTestId('sidebar-project-group-missing-/deleted/repo')).toBeInTheDocument()
  })

  it('groups project sessions by project path', () => {
    useUiStore.setState({ sidebarSection: 'projects', activeView: 'code' })
    useDomainStore.setState({
      sessions: [
        {
          id: 'code-hip-1',
          title: 'Hip task A',
          preview: 'a',
          updatedAtMs: Date.now(),
          config: { ...DEFAULT_CONFIG, surface: 'code', cwd: '/Users/x/data/hip' },
          messages: [],
          status: 'idle',
          loaded: true,
        },
        {
          id: 'code-hip-2',
          title: 'Hip task B',
          preview: 'b',
          updatedAtMs: Date.now() - 1000,
          config: { ...DEFAULT_CONFIG, surface: 'code', cwd: '/Users/x/data/hip/' },
          messages: [],
          status: 'idle',
          loaded: true,
        },
        {
          id: 'code-other',
          title: 'Other repo',
          preview: 'c',
          updatedAtMs: Date.now() - 500,
          config: { ...DEFAULT_CONFIG, surface: 'code', cwd: '/Users/x/data/other' },
          messages: [],
          status: 'idle',
          loaded: true,
        },
        {
          id: 'code-unbound',
          title: 'No folder',
          preview: 'd',
          updatedAtMs: Date.now() - 2000,
          config: { ...DEFAULT_CONFIG, surface: 'code' },
          messages: [],
          status: 'idle',
          loaded: true,
        },
      ],
      activeSessionId: 'code-hip-1',
    } as never)

    render(<AppSidebar />)

    expect(screen.getByTestId('sidebar-project-group-/Users/x/data/hip')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-project-group-/Users/x/data/other')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-project-group-__unbound')).toBeInTheDocument()

    const hipGroup = screen.getByTestId('sidebar-project-group-/Users/x/data/hip')
    expect(hipGroup).toHaveTextContent('hip')
    expect(hipGroup).toHaveTextContent('2')
    expect(within(hipGroup).getByTestId('sidebar-session-code-hip-1')).toBeInTheDocument()
    expect(within(hipGroup).getByTestId('sidebar-session-code-hip-2')).toBeInTheDocument()

    const otherGroup = screen.getByTestId('sidebar-project-group-/Users/x/data/other')
    expect(within(otherGroup).getByTestId('sidebar-session-code-other')).toBeInTheDocument()

    // Chats section stays flat (no project path groups).
    cleanup()
    useUiStore.setState({ sidebarSection: 'chats', activeView: 'chat' })
    useDomainStore.setState({
      sessions: [
        {
          id: 'chat-1',
          title: 'Hello chat',
          preview: 'preview',
          updatedAtMs: Date.now(),
          config: { ...DEFAULT_CONFIG, surface: 'chat' },
          messages: [],
          status: 'idle',
          loaded: true,
        },
      ],
      activeSessionId: 'chat-1',
    } as never)
    render(<AppSidebar />)
    expect(screen.queryByTestId(/^sidebar-project-group-/)).not.toBeInTheDocument()
    expect(screen.getByTestId('sidebar-session-chat-1')).toBeInTheDocument()
  })

  it('collapses and expands conversations under a project group', () => {
    useUiStore.setState({ sidebarSection: 'projects', activeView: 'code' })
    useDomainStore.setState({
      sessions: [
        {
          id: 'code-hip-1',
          title: 'Hip task A',
          preview: 'a',
          updatedAtMs: Date.now(),
          config: { ...DEFAULT_CONFIG, surface: 'code', cwd: '/Users/x/data/hip' },
          messages: [],
          status: 'idle',
          loaded: true,
        },
        {
          id: 'code-hip-2',
          title: 'Hip task B',
          preview: 'b',
          updatedAtMs: Date.now() - 1000,
          config: { ...DEFAULT_CONFIG, surface: 'code', cwd: '/Users/x/data/hip' },
          messages: [],
          status: 'idle',
          loaded: true,
        },
        {
          id: 'code-other',
          title: 'Other repo',
          preview: 'c',
          updatedAtMs: Date.now() - 500,
          config: { ...DEFAULT_CONFIG, surface: 'code', cwd: '/Users/x/data/other' },
          messages: [],
          status: 'idle',
          loaded: true,
        },
      ],
      activeSessionId: 'code-hip-1',
    } as never)

    render(<AppSidebar />)

    const hipHeader = screen.getByTestId('sidebar-project-group-header-/Users/x/data/hip')
    expect(hipHeader).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('sidebar-session-code-hip-1')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-session-code-hip-2')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-session-code-other')).toBeInTheDocument()

    fireEvent.click(hipHeader)
    expect(hipHeader).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('sidebar-session-code-hip-1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('sidebar-session-code-hip-2')).not.toBeInTheDocument()
    // Other project stays expanded.
    expect(screen.getByTestId('sidebar-session-code-other')).toBeInTheDocument()
    // Collapsed group still shows session count.
    expect(screen.getByTestId('sidebar-project-group-/Users/x/data/hip')).toHaveTextContent('2')

    fireEvent.click(hipHeader)
    expect(hipHeader).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('sidebar-session-code-hip-1')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-session-code-hip-2')).toBeInTheDocument()
  })
})
