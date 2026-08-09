// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUiStore } from '@/store/uiStore'
import { useDomainStore } from '@/domain'
import { DEFAULT_CONFIG } from '@/domain/sessionStore'
import type { KnowledgeNode } from '@/domain/knowledge/types'

const toggleMaximize = vi.fn().mockResolvedValue(undefined)

vi.mock('./ConnectionStatus', () => ({
  ConnectionStatus: () => <div data-testid="connection-status" />,
}))
vi.mock('./PanelToggle', () => ({
  PanelToggle: () => <div data-testid="toggle-panel" />,
}))
const kbState = vi.hoisted(() => ({
  mode: 'home' as string,
  spaces: [] as unknown[],
  activeSpaceId: null as string | null,
  nodes: [] as KnowledgeNode[],
  activeDocId: null as string | null,
  currentFolderId: null as string | null,
}))

vi.mock('@/store/knowledgeStore', () => ({
  useKnowledgeStore: (sel: (s: typeof kbState) => unknown) => sel(kbState),
}))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    toggleMaximize,
    minimize: vi.fn(),
    close: vi.fn(),
    isMaximized: vi.fn().mockResolvedValue(false),
    onResized: vi.fn().mockResolvedValue(() => {}),
  }),
}))

import { MainToolbar } from './MainToolbar'

describe('MainToolbar', () => {
  beforeEach(() => {
    toggleMaximize.mockClear()
    useUiStore.setState({
      activeView: 'chat',
      sidebarSection: 'chats',
      sidebarOpen: true,
      overlay: null,
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
    expect(screen.queryByTestId('main-toolbar-command-palette')).not.toBeInTheDocument()
    expect(screen.queryByTestId('main-toolbar-sidebar-chrome')).not.toBeInTheDocument()
  })

  it('when sidebar collapsed, shows expand control and expands on click', () => {
    useUiStore.setState({ sidebarOpen: false })
    render(<MainToolbar />)
    expect(screen.getByTestId('main-toolbar-sidebar-chrome')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-toggle')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('sidebar-toggle'))
    expect(useUiStore.getState().sidebarOpen).toBe(true)
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

  it('under settings mode shows settings title without panel chrome', () => {
    useUiStore.setState({
      activeView: 'chat',
      overlay: 'settings',
      settingsPage: 'general',
      sidebarSection: 'chats',
    })
    render(<MainToolbar />)
    expect(screen.queryByTestId('main-toolbar-back')).not.toBeInTheDocument()
    expect(screen.queryByTestId('connection-status')).not.toBeInTheDocument()
    expect(screen.getByTestId('main-toolbar-title')).toBeInTheDocument()
  })

  it('under history overlay still shows work-surface chrome', () => {
    useUiStore.setState({
      activeView: 'chat',
      overlay: 'history',
    })
    render(<MainToolbar />)
    // Falls through to new-conversation title path (no active session).
    expect(screen.getByTestId('connection-status')).toBeInTheDocument()
  })

  it('terminals: shows title and panel chrome (files rail via PanelToggle)', () => {
    useUiStore.setState({
      activeView: 'terminals',
      sidebarSection: 'terminals',
    })
    render(<MainToolbar />)
    expect(screen.getByTestId('main-toolbar-title')).toBeInTheDocument()
    // PanelToggle is mocked always-present; connection + toggle chrome should show.
    expect(screen.getByTestId('connection-status')).toBeInTheDocument()
    expect(screen.getByTestId('toggle-panel')).toBeInTheDocument()
  })

  it('knowledge: title shows 全部文档 root when nothing open (no fixed 文档管理)', () => {
    kbState.nodes = []
    kbState.activeDocId = null
    kbState.currentFolderId = null
    useUiStore.setState({ activeView: 'knowledge', sidebarSection: 'knowledge' })
    render(<MainToolbar />)
    expect(screen.getByTestId('main-toolbar-title')).toHaveTextContent(/All documents|全部文档/i)
  })

  it('knowledge: title shows 目录 > 文件名 for an open doc', () => {
    kbState.nodes = [
      { id: 'fld_1', parentId: null, kind: 'folder', title: 'FolderA', order: 0, createdAt: 1, updatedAt: 1 },
      { id: 'doc_1', parentId: 'fld_1', kind: 'doc', title: 'Note', order: 0, createdAt: 1, updatedAt: 1 },
    ]
    kbState.activeDocId = 'doc_1'
    kbState.currentFolderId = null
    useUiStore.setState({ activeView: 'knowledge', sidebarSection: 'knowledge' })
    render(<MainToolbar />)
    expect(screen.getByTestId('main-toolbar-title')).toHaveTextContent(
      /All documents › FolderA › Note|全部文档 › FolderA › Note/i,
    )
  })

  it('knowledge: title shows current folder path while browsing', () => {
    kbState.nodes = [
      { id: 'fld_1', parentId: null, kind: 'folder', title: 'FolderA', order: 0, createdAt: 1, updatedAt: 1 },
      { id: 'fld_2', parentId: 'fld_1', kind: 'folder', title: 'FolderB', order: 0, createdAt: 1, updatedAt: 1 },
    ]
    kbState.activeDocId = null
    kbState.currentFolderId = 'fld_2'
    useUiStore.setState({ activeView: 'knowledge', sidebarSection: 'knowledge' })
    render(<MainToolbar />)
    expect(screen.getByTestId('main-toolbar-title')).toHaveTextContent(
      /All documents › FolderA › FolderB|全部文档 › FolderA › FolderB/i,
    )
  })

  it('double-click on the toolbar toggles window maximize', async () => {
    render(<MainToolbar />)
    fireEvent.doubleClick(screen.getByTestId('main-toolbar'))
    await vi.waitFor(() => expect(toggleMaximize).toHaveBeenCalledTimes(1))
  })
})
