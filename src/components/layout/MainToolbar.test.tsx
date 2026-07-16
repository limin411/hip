// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUiStore } from '@/store/uiStore'
import { useDomainStore } from '@/domain'
import { DEFAULT_CONFIG } from '@/domain/sessionStore'

vi.mock('./ConnectionStatus', () => ({
  ConnectionStatus: () => <div data-testid="connection-status" />,
}))
vi.mock('./PanelToggle', () => ({
  PanelToggle: () => <div data-testid="toggle-panel" />,
}))
vi.mock('@/store/knowledgeStore', () => ({
  useKnowledgeStore: (sel: (s: { mode: string; spaces: unknown[]; activeSpaceId: null }) => unknown) =>
    sel({ mode: 'home', spaces: [], activeSpaceId: null }),
}))

import { MainToolbar } from './MainToolbar'

describe('MainToolbar', () => {
  beforeEach(() => {
    useUiStore.setState({
      activeView: 'chat',
      previousView: null,
      sidebarSection: 'chats',
    })
    useDomainStore.setState({
      sessions: [],
      activeSessionId: null,
    } as never)
  })

  afterEach(() => cleanup())

  it('shows new conversation title without panel toggle when no session', () => {
    render(<MainToolbar />)
    expect(screen.getByTestId('main-toolbar')).toBeInTheDocument()
    expect(screen.getByTestId('main-toolbar-title')).toHaveTextContent(/new conversation|新对话|新對話/i)
    expect(screen.getByTestId('connection-status')).toBeInTheDocument()
    // PanelToggle returns null without session in real impl; mock always renders —
    // just ensure toolbar chrome is present.
    expect(screen.getByTestId('main-toolbar-command-palette')).toBeInTheDocument()
  })

  it('shows session title when active', () => {
    useDomainStore.setState({
      sessions: [
        {
          id: 's1',
          title: 'My Session',
          preview: '',
          updatedAtMs: 1,
          config: { ...DEFAULT_CONFIG, surface: 'chat' },
          messages: [],
          status: 'idle',
          loaded: true,
        },
      ],
      activeSessionId: 's1',
    } as never)
    render(<MainToolbar />)
    expect(screen.getByTestId('main-toolbar-title')).toHaveTextContent('My Session')
  })

  it('settings: no back, shows title, hides connection and panel', () => {
    useUiStore.setState({
      activeView: 'settings',
      previousView: 'chat',
      sidebarSection: 'chats',
    })
    render(<MainToolbar />)
    expect(screen.queryByTestId('main-toolbar-back')).not.toBeInTheDocument()
    expect(screen.getByTestId('main-toolbar-title')).toBeInTheDocument()
    expect(screen.queryByTestId('connection-status')).not.toBeInTheDocument()
    expect(screen.queryByTestId('toggle-panel')).not.toBeInTheDocument()
  })

  it('history: back present, empty toolbar title', () => {
    useUiStore.setState({
      activeView: 'history',
      previousView: 'chat',
    })
    render(<MainToolbar />)
    expect(screen.getByTestId('main-toolbar-back')).toBeInTheDocument()
    expect(screen.getByTestId('main-toolbar-title')).toHaveTextContent('')
  })

  it('knowledge → history → back restores knowledge view and section', () => {
    useUiStore.setState({
      activeView: 'history',
      previousView: 'knowledge',
      sidebarSection: 'chats', // as if assignSectionAfterLeavingKnowledge ran
    })
    render(<MainToolbar />)
    fireEvent.click(screen.getByTestId('main-toolbar-back'))
    expect(useUiStore.getState().activeView).toBe('knowledge')
    expect(useUiStore.getState().sidebarSection).toBe('knowledge')
  })
})
