// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { useUiStore } from '@/store/uiStore'
import { useDomainStore } from '@/domain'
import { DEFAULT_CONFIG } from '@/domain/sessionStore'
import { useParallelStore } from '@/store/parallelStore'
import { useWorktreeStore } from '@/store/worktreeStore'
import { useProjectPathStore } from '@/store/projectPathStore'
import { useNavHistoryStore } from '@/store/navHistoryStore'

const enterKnowledge = vi.fn(async () => {})
const openCreateKnowledgeSpaceDialog = vi.fn()
const enterSection = vi.fn(async (_section: 'projects' | 'chats') => {})
const enterPlaceholderSection = vi.fn(
  async (_section: 'tasks' | 'automation') => {},
)
const enterTerminalsSection = vi.fn(async (_opts?: { library?: boolean }) => {})
const enterWorkItemsSection = vi.fn(async () => {})
const enterAutomationsSection = vi.fn(async () => {})
const openHistoryFromChrome = vi.fn(async () => {})
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
  openHistoryFromChrome: () => openHistoryFromChrome(),
  openSettingsFromChrome: vi.fn(),
  openAutomationFromChrome: vi.fn(),
  openTrashFromChrome: vi.fn(),
  leaveKnowledge: vi.fn(async () => {}),
  leaveWorkItems: vi.fn(async () => {}),
  openSpaceFromSidebar: vi.fn(),
  selectSessionFromSidebar: (id: string) => selectSessionFromSidebar(id),
  newConversationFromSidebar: (surface: 'chat' | 'code') => newConversationFromSidebar(surface),
}))

vi.mock('@/components/knowledge/knowledgeSpaceDialogStore', () => ({
  openCreateKnowledgeSpaceDialog: () => openCreateKnowledgeSpaceDialog(),
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
    openCreateKnowledgeSpaceDialog.mockClear()
    enterSection.mockClear()
    enterPlaceholderSection.mockClear()
    enterTerminalsSection.mockClear()
    enterWorkItemsSection.mockClear()
    enterAutomationsSection.mockClear()
    openHistoryFromChrome.mockClear()
    newConversationFromSidebar.mockClear()
    selectSessionFromSidebar.mockClear()
    knowledgeState.spaces = []
    knowledgeState.activeSpaceId = null
    useNavHistoryStore.setState({ stack: [], index: -1, applying: false })
    useUiStore.setState({
      activeView: 'chat',
      sidebarSection: 'chats',
      sidebarOpen: true,
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
        },
      ],
      activeSessionId: 'chat-1',
    } as never)
  })

  afterEach(() => {
    useParallelStore.setState({ runs: [] })
    useWorktreeStore.getState().clear()
    useProjectPathStore.setState({ byKey: {} })
    cleanup()
  })

  it('renders search icon, nav, and chat sessions for chats section', () => {
    render(<AppSidebar />)
    expect(screen.getByTestId('app-sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-nav-back')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-nav-forward')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-search')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-search').tagName).toBe('BUTTON')
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
    const search = screen.getByTestId('sidebar-search')
    const toggle = screen.getByTestId('sidebar-toggle')
    expect(back).toBeDisabled()
    expect(forward).toBeDisabled()
    // DOM order: search, toggle, back, forward
    const parent = search.parentElement
    expect(parent).toBeTruthy()
    const buttons = within(parent!).getAllByRole('button')
    expect(buttons[0]).toBe(search)
    expect(buttons[1]).toBe(toggle)
    expect(buttons[2]).toBe(back)
    expect(buttons[3]).toBe(forward)
  })

  it('active nav uses sage rail without hairline ring', () => {
    render(<AppSidebar />)
    const chats = screen.getByTestId('sidebar-nav-chats')
    expect(chats).toHaveClass('before:bg-accent')
    expect(chats).toHaveClass('bg-state-hover')
    expect(chats.className).not.toMatch(/shadow-\[0_0_0_1px/)
    const projects = screen.getByTestId('sidebar-nav-projects')
    expect(projects).not.toHaveClass('before:bg-accent')
    expect(projects).toHaveClass('hover:bg-state-hover')
  })

  it('active session row uses sage rail without hairline ring', () => {
    render(<AppSidebar />)
    const sessionBtn = screen.getByTestId('sidebar-session-chat-1')
    const row = sessionBtn.closest('div')
    expect(row).toHaveClass('before:bg-accent')
    expect(row).toHaveClass('bg-state-hover')
    expect(row?.className).not.toMatch(/shadow-\[0_0_0_1px/)
  })

  it('shows session counts on projects and chats nav', () => {
    render(<AppSidebar />)
    expect(screen.getByTestId('sidebar-nav-chats')).toHaveTextContent('1')
    expect(screen.getByTestId('sidebar-nav-projects')).toHaveTextContent('1')
  })

  it('search icon opens command palette', async () => {
    const { useCommandPaletteStore } = await import('@/store/commandPaletteStore')
    useCommandPaletteStore.setState({ open: false })
    render(<AppSidebar />)
    fireEvent.click(screen.getByTestId('sidebar-search'))
    expect(useCommandPaletteStore.getState().open).toBe(true)
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

  it('new space button opens create dialog', () => {
    useUiStore.setState({ sidebarSection: 'knowledge' })
    render(<AppSidebar />)
    fireEvent.click(screen.getByTestId('sidebar-new-space'))
    expect(openCreateKnowledgeSpaceDialog).toHaveBeenCalled()
  })

  it('terminals section shows a single new button that opens a popover', () => {
    useUiStore.setState({ sidebarSection: 'terminals', activeView: 'terminals' })
    render(<AppSidebar />)
    // One trailing action (like chat / code / knowledge) — not multiple inline buttons.
    expect(screen.getByTestId('sidebar-new-terminal')).toBeInTheDocument()
    expect(screen.queryByTestId('sidebar-new-local-terminal')).not.toBeInTheDocument()
    expect(screen.queryByTestId('sidebar-new-remote-host')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('sidebar-new-terminal'))
    expect(screen.getByTestId('terminals-new-popover')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-new-local-terminal')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-new-remote-host')).toBeInTheDocument()
  })

  it('active knowledge space uses sage rail without hairline ring', () => {
    knowledgeState.spaces = [{ id: 'space-1', name: 'Notes' }]
    knowledgeState.activeSpaceId = 'space-1'
    useUiStore.setState({ sidebarSection: 'knowledge', activeView: 'knowledge' })
    render(<AppSidebar />)
    const space = screen.getByTestId('sidebar-space-space-1')
    expect(space).toHaveClass('before:bg-accent')
    expect(space).toHaveClass('bg-state-hover')
    expect(space.className).not.toMatch(/shadow-\[0_0_0_1px/)
  })

  it('lists knowledge spaces sorted by name ascending', () => {
    knowledgeState.spaces = [
      { id: 'b', name: 'Zebra' },
      { id: 'a', name: 'Alpha' },
      { id: 'c', name: 'beta' },
    ]
    useUiStore.setState({ sidebarSection: 'knowledge', activeView: 'knowledge' })
    render(<AppSidebar />)
    const list = screen.getByTestId('sidebar-list')
    const rows = within(list).getAllByTestId(/^sidebar-space-/)
    expect(rows.map((el) => el.getAttribute('data-testid'))).toEqual([
      'sidebar-space-a',
      'sidebar-space-c',
      'sidebar-space-b',
    ])
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

  it('shows expandable worktree tree under host project session', () => {
    useUiStore.setState({ sidebarSection: 'projects', activeView: 'code' })
    useParallelStore.setState({
      runs: [
        {
          id: 'run-abc',
          baseCwd: '/tmp/repo',
          prompt: 'parallel fix',
          hostSessionId: 'code-1',
          source: 'agent',
          createdAt: Date.now(),
          slots: [
            {
              index: 1,
              sessionId: '',
              taskId: 'pwt-1',
              worktreePath: '/tmp/wt/run-abc/hip-p-1',
              branch: 'hip-p-1',
              status: 'ready',
            },
            {
              index: 2,
              sessionId: '',
              taskId: 'pwt-2',
              worktreePath: '/tmp/wt/run-abc/hip-p-2',
              branch: 'hip-p-2',
              status: 'ready',
            },
          ],
        },
      ],
    })
    render(<AppSidebar />)
    expect(screen.getByTestId('sidebar-session-code-1')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-session-expand-code-1')).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(screen.getByTestId('sidebar-session-worktrees-code-1')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-session-wt-badge-code-1')).toHaveTextContent('2')
    expect(screen.getByTestId('sidebar-parallel-slot-pwt-1')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('sidebar-session-expand-code-1'))
    expect(screen.getByTestId('sidebar-session-expand-code-1')).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(screen.queryByTestId('sidebar-session-worktrees-code-1')).not.toBeInTheDocument()
  })

  it('active worktree slot uses sage rail without hairline ring', () => {
    useUiStore.setState({ sidebarSection: 'projects', activeView: 'code' })
    useDomainStore.setState({
      sessions: [
        {
          id: 'code-1',
          title: 'Code project',
          preview: 'repo work',
          updatedAtMs: Date.now(),
          config: { ...DEFAULT_CONFIG, surface: 'code' },
          messages: [],
          status: 'idle',
          loaded: true,
        },
        {
          id: 'slot-1',
          title: 'P1 slot',
          preview: 'slot',
          updatedAtMs: Date.now(),
          config: {
            ...DEFAULT_CONFIG,
            surface: 'code',
            cwd: '/tmp/wt/run-abc/hip-p-1',
          },
          messages: [],
          status: 'idle',
          loaded: true,
        },
      ],
      activeSessionId: 'slot-1',
    } as never)
    useParallelStore.setState({
      runs: [
        {
          id: 'run-abc',
          baseCwd: '/tmp/repo',
          prompt: 'parallel fix',
          hostSessionId: 'code-1',
          source: 'agent',
          createdAt: Date.now(),
          slots: [
            {
              index: 1,
              sessionId: 'slot-1',
              taskId: 'pwt-1',
              worktreePath: '/tmp/wt/run-abc/hip-p-1',
              branch: 'hip-p-1',
              status: 'ready',
            },
          ],
        },
      ],
    })
    render(<AppSidebar />)
    const slot = screen.getByTestId('sidebar-parallel-slot-slot-1')
    expect(slot).toHaveClass('before:bg-accent')
    expect(slot).toHaveClass('bg-state-hover')
    expect(slot.className).not.toMatch(/shadow-\[0_0_0_1px/)
  })

  it('does not promote worktree slot sessions to top-level project rows', () => {
    useUiStore.setState({ sidebarSection: 'projects', activeView: 'code' })
    useDomainStore.setState((st) => ({
      ...st,
      sessions: [
        ...(st.sessions as never[]),
        {
          id: 'slot-orphan',
          title: 'P1/2 · deadrun',
          preview: 'slot',
          updatedAtMs: Date.now(),
          config: {
            ...DEFAULT_CONFIG,
            surface: 'code',
            cwd: '/Users/x/.hip/worktrees/h1/slot-orphan',
          },
          messages: [],
          status: 'idle',
          loaded: true,
        },
      ],
    }) as never)
    render(<AppSidebar />)
    expect(screen.getByTestId('sidebar-session-code-1')).toBeInTheDocument()
    expect(screen.queryByTestId('sidebar-session-slot-orphan')).not.toBeInTheDocument()
  })

  it('keeps host project visible after primary worktree catalog hydrate (click regression)', () => {
    // selectSession → git:worktree:list:result upserts primary path === session.cwd.
    // That must not nest/hide the host row.
    const hostCwd = '/Users/x/data/code-repository/project-go/forgejo'
    useUiStore.setState({ sidebarSection: 'projects', activeView: 'code' })
    useDomainStore.setState((st) => ({
      ...st,
      sessions: [
        {
          id: 'code-1',
          title: 'Forgejo 项目介绍',
          preview: 'repo',
          updatedAtMs: Date.now(),
          config: { ...DEFAULT_CONFIG, surface: 'code', cwd: hostCwd },
          messages: [],
          status: 'idle',
          loaded: true,
        },
      ],
      activeSessionId: 'code-1',
    }) as never)
    useWorktreeStore.getState().upsertFromList(
      [
        {
          id: 'primary',
          path: hostCwd,
          branch: 'main',
          head: 'abc',
          managed: false,
          isPrimary: true,
          source: 'primary',
          repoKey: 'rk',
        },
        {
          id: 'slot-wt',
          path: '/Users/x/.hip/worktrees/forgejo-p1',
          branch: 'hip-p-1',
          head: 'def',
          managed: true,
          isPrimary: false,
          source: 'parallel',
          repoKey: 'rk',
        },
      ],
      'code-1',
    )
    render(<AppSidebar />)
    expect(screen.getByTestId('sidebar-session-code-1')).toBeInTheDocument()
  })

  it('humanizes catalog worktree source subtitle (no raw enum leak)', async () => {
    await i18n.changeLanguage('en')
    const hostCwd = '/Users/x/data/code-repository/project-go/forgejo'
    useUiStore.setState({ sidebarSection: 'projects', activeView: 'code' })
    useDomainStore.setState((st) => ({
      ...st,
      sessions: [
        {
          id: 'code-1',
          title: 'Forgejo',
          preview: 'repo',
          updatedAtMs: Date.now(),
          config: { ...DEFAULT_CONFIG, surface: 'code', cwd: hostCwd },
          messages: [],
          status: 'idle',
          loaded: true,
        },
      ],
      activeSessionId: 'code-1',
    }) as never)
    useWorktreeStore.getState().upsertFromList(
      [
        {
          id: 'primary',
          path: hostCwd,
          branch: 'main',
          head: 'abc',
          managed: false,
          isPrimary: true,
          source: 'primary',
          repoKey: 'rk',
        },
        {
          id: 'slot-wt',
          path: '/Users/x/.hip/worktrees/forgejo-p1',
          branch: 'hip-p-1',
          head: 'def',
          managed: true,
          isPrimary: false,
          source: 'host_fanout',
          repoKey: 'rk',
        },
      ],
      'code-1',
    )
    render(<AppSidebar />)
    const row = screen.getByTestId('sidebar-catalog-wt-slot-wt')
    // Label comes from chat.worktreeControl.source.host_fanout (en: Batch create).
    expect(row).toHaveTextContent('Batch create')
    expect(row).not.toHaveTextContent('host_fanout')
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
