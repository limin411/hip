// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUiStore } from '@/store/uiStore'
import { useDomainStore } from '@/domain'
import { DEFAULT_CONFIG } from '@/domain/sessionStore'
import { useParallelStore } from '@/store/parallelStore'
import { useWorktreeStore } from '@/store/worktreeStore'
import { useProjectPathStore } from '@/store/projectPathStore'

const enterKnowledge = vi.fn(async () => {})
const openKnowledgeHome = vi.fn(async () => {})
const enterSection = vi.fn(async (_section: 'projects' | 'chats') => {})
const openHistoryFromChrome = vi.fn(async () => {})
const newConversationFromSidebar = vi.fn(async (_surface: 'chat' | 'code') => {})
const selectSessionFromSidebar = vi.fn(async (_id: string) => {})

vi.mock('./sidebarActions', () => ({
  enterKnowledge: () => enterKnowledge(),
  openKnowledgeHome: () => openKnowledgeHome(),
  enterSection: (section: 'projects' | 'chats') => enterSection(section),
  openHistoryFromChrome: () => openHistoryFromChrome(),
  openSettingsFromChrome: vi.fn(),
  leaveKnowledge: vi.fn(async () => {}),
  openSpaceFromSidebar: vi.fn(),
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

vi.mock('@/store/knowledgeStore', () => ({
  useKnowledgeStore: (sel: (s: { spaces: unknown[]; activeSpaceId: null }) => unknown) =>
    sel({ spaces: [], activeSpaceId: null }),
}))

import { AppSidebar } from './AppSidebar'

describe('AppSidebar', () => {
  beforeEach(() => {
    enterKnowledge.mockClear()
    openKnowledgeHome.mockClear()
    enterSection.mockClear()
    openHistoryFromChrome.mockClear()
    newConversationFromSidebar.mockClear()
    selectSessionFromSidebar.mockClear()
    useUiStore.setState({
      activeView: 'chat',
      sidebarSection: 'chats',
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

  it('renders search, nav, and chat sessions for chats section', () => {
    render(<AppSidebar />)
    expect(screen.getByTestId('app-sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-search')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-nav-chats')).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTestId('sidebar-session-chat-1')).toBeInTheDocument()
    expect(screen.queryByTestId('sidebar-session-code-1')).not.toBeInTheDocument()
  })

  it('shows session counts on projects and chats nav', () => {
    render(<AppSidebar />)
    expect(screen.getByTestId('sidebar-nav-chats')).toHaveTextContent('1')
    expect(screen.getByTestId('sidebar-nav-projects')).toHaveTextContent('1')
  })

  it('filters sessions by search query', () => {
    render(<AppSidebar />)
    fireEvent.change(screen.getByTestId('sidebar-search'), { target: { value: 'nope' } })
    expect(screen.queryByTestId('sidebar-session-chat-1')).not.toBeInTheDocument()
    fireEvent.change(screen.getByTestId('sidebar-search'), { target: { value: 'Hello' } })
    expect(screen.getByTestId('sidebar-session-chat-1')).toBeInTheDocument()
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

  it('manage spaces opens knowledge home', () => {
    useUiStore.setState({ sidebarSection: 'knowledge' })
    render(<AppSidebar />)
    fireEvent.click(screen.getByTestId('sidebar-manage-spaces'))
    expect(openKnowledgeHome).toHaveBeenCalled()
  })

  it('session row calls selectSessionFromSidebar', () => {
    render(<AppSidebar />)
    fireEvent.click(screen.getByTestId('sidebar-session-chat-1'))
    expect(selectSessionFromSidebar).toHaveBeenCalledWith('chat-1')
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
          source: 'git',
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
})
