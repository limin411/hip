// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUiStore } from '@/store/uiStore'
import { useDomainStore } from '@/domain'
import { DEFAULT_CONFIG } from '@/domain/sessionStore'

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

  afterEach(() => cleanup())

  it('renders search, nav, and chat sessions for chats section', () => {
    render(<AppSidebar onLogout={vi.fn()} />)
    expect(screen.getByTestId('app-sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-search')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-nav-chats')).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTestId('sidebar-session-chat-1')).toBeInTheDocument()
    expect(screen.queryByTestId('sidebar-session-code-1')).not.toBeInTheDocument()
  })

  it('filters sessions by search query', () => {
    render(<AppSidebar onLogout={vi.fn()} />)
    fireEvent.change(screen.getByTestId('sidebar-search'), { target: { value: 'nope' } })
    expect(screen.queryByTestId('sidebar-session-chat-1')).not.toBeInTheDocument()
    fireEvent.change(screen.getByTestId('sidebar-search'), { target: { value: 'Hello' } })
    expect(screen.getByTestId('sidebar-session-chat-1')).toBeInTheDocument()
  })

  it('nav knowledge calls enterKnowledge', () => {
    render(<AppSidebar onLogout={vi.fn()} />)
    fireEvent.click(screen.getByTestId('sidebar-nav-knowledge'))
    expect(enterKnowledge).toHaveBeenCalled()
  })

  it('nav projects calls enterSection projects', () => {
    render(<AppSidebar onLogout={vi.fn()} />)
    fireEvent.click(screen.getByTestId('sidebar-nav-projects'))
    expect(enterSection).toHaveBeenCalledWith('projects')
  })

  it('chats section new chat starts chat conversation', () => {
    render(<AppSidebar onLogout={vi.fn()} />)
    fireEvent.click(screen.getByTestId('sidebar-new-chat-list'))
    expect(newConversationFromSidebar).toHaveBeenCalledWith('chat')
  })

  it('projects section new task starts code conversation', () => {
    useUiStore.setState({ sidebarSection: 'projects' })
    render(<AppSidebar onLogout={vi.fn()} />)
    fireEvent.click(screen.getByTestId('sidebar-new-task'))
    expect(newConversationFromSidebar).toHaveBeenCalledWith('code')
  })

  it('manage spaces opens knowledge home', () => {
    useUiStore.setState({ sidebarSection: 'knowledge' })
    render(<AppSidebar onLogout={vi.fn()} />)
    fireEvent.click(screen.getByTestId('sidebar-manage-spaces'))
    expect(openKnowledgeHome).toHaveBeenCalled()
  })

  it('session row calls selectSessionFromSidebar', () => {
    render(<AppSidebar onLogout={vi.fn()} />)
    fireEvent.click(screen.getByTestId('sidebar-session-chat-1'))
    expect(selectSessionFromSidebar).toHaveBeenCalledWith('chat-1')
  })

  it('new chat button starts chat conversation', () => {
    render(<AppSidebar onLogout={vi.fn()} />)
    fireEvent.click(screen.getByTestId('sidebar-new-chats'))
    expect(newConversationFromSidebar).toHaveBeenCalledWith('chat')
  })
})
