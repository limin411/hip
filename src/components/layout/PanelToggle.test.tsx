// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import React from 'react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { PanelToggle } from './PanelToggle'

afterEach(cleanup)

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('lucide-react', () => ({
  Check: () => React.createElement('span', { 'data-testid': 'icon-check' }),
  PanelRight: () => React.createElement('span', { 'data-testid': 'icon-panel-right' }),
}))

vi.mock('@/components/ui/DropdownMenu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  DropdownMenuContent: ({ children, ...props }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'panel-tab-menu', ...props }, children),
  DropdownMenuItem: ({
    children,
    onSelect,
    ...props
  }: {
    children: React.ReactNode
    onSelect?: () => void
  }) => React.createElement('button', { type: 'button', onClick: onSelect, ...props }, children),
}))

const setSessionCodePanelOpen = vi.fn()
const setSessionChatPanelOpen = vi.fn()
const setTab = vi.fn()
const setChatActiveTab = vi.fn()
const setKnowledgePanelOpen = vi.fn()

vi.mock('@/domain', () => ({
  useActiveSessionId: () => mockActiveSessionId,
}))

vi.mock('@/store/uiStore', () => ({
  useUiStore: (selector: (state: any) => any) =>
    selector({
      activeView: mockActiveView,
      activeTab: mockActiveTab,
      chatActiveTab: mockChatActiveTab,
      knowledgePanelOpen: mockKnowledgePanelOpen,
      setTab,
      setChatActiveTab,
      setKnowledgePanelOpen,
    }),
}))

vi.mock('@/domain/sessionStore', () => ({
  useDomainStore: (selector: (state: any) => any) =>
    selector({
      setSessionCodePanelOpen,
      setSessionChatPanelOpen,
    }),
}))

vi.mock('@/store/diffStore', () => ({
  useDiffStore: (selector: (state: any) => any) =>
    selector({
      bySession: {
        s1: { isGitRepo: mockIsGitRepo },
      },
    }),
}))

vi.mock('@/store/knowledgeStore', () => ({
  useKnowledgeStore: (selector: (state: any) => any) =>
    selector({
      mode: mockKbMode,
    }),
}))

vi.mock('@/components/artifact/terminalFeature', () => ({
  get CODE_TERMINAL() {
    return mockCodeTerminal
  },
}))

let mockActiveSessionId: string | null = 's1'
let mockActiveView = 'chat'
let mockActiveTab = 'agents'
let mockChatActiveTab = 'files'
let mockIsGitRepo = false
let mockCodeTerminal = false
let mockKnowledgePanelOpen = false
let mockKbMode: 'home' | 'workspace' = 'home'

describe('PanelToggle', () => {
  beforeEach(() => {
    mockActiveSessionId = 's1'
    mockActiveView = 'chat'
    mockActiveTab = 'agents'
    mockChatActiveTab = 'files'
    mockIsGitRepo = false
    mockCodeTerminal = false
    mockKnowledgePanelOpen = false
    mockKbMode = 'home'
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders toggle button', () => {
    render(<PanelToggle />)
    expect(screen.getByTestId('toggle-panel')).toBeInTheDocument()
  })

  it('is hidden when no session is active', () => {
    mockActiveSessionId = null
    render(<PanelToggle />)
    expect(screen.queryByTestId('toggle-panel')).not.toBeInTheDocument()
  })

  it('shows chat panel tabs (files, agents)', () => {
    render(<PanelToggle />)
    expect(screen.getByTestId('panel-tab-files')).toBeInTheDocument()
    expect(screen.getByTestId('panel-tab-agents')).toBeInTheDocument()
    expect(screen.queryByTestId('panel-tab-dag')).not.toBeInTheDocument()
    expect(screen.queryByTestId('panel-tab-timeline')).not.toBeInTheDocument()
  })

  it('opens chat panel and switches tab when a chat tab is selected', () => {
    render(<PanelToggle />)
    fireEvent.click(screen.getByTestId('panel-tab-agents'))
    expect(setChatActiveTab).toHaveBeenCalledWith('agents')
    expect(setSessionChatPanelOpen).toHaveBeenCalledWith('s1', true)
    expect(setSessionCodePanelOpen).not.toHaveBeenCalled()
    expect(setTab).not.toHaveBeenCalled()
  })

  it('shows code panel tabs and hides git-gated tabs when not a git repo', () => {
    mockActiveView = 'code'
    render(<PanelToggle />)
    expect(screen.getByTestId('panel-tab-files')).toBeInTheDocument()
    expect(screen.getByTestId('panel-tab-agents')).toBeInTheDocument()
    expect(screen.queryByTestId('panel-tab-dag')).not.toBeInTheDocument()
    expect(screen.queryByTestId('panel-tab-timeline')).not.toBeInTheDocument()
    expect(screen.queryByTestId('panel-tab-changes')).not.toBeInTheDocument()
  })

  it('shows git-gated code tabs when session is a git repo', () => {
    mockActiveView = 'code'
    mockIsGitRepo = true
    render(<PanelToggle />)
    expect(screen.getByTestId('panel-tab-timeline')).toBeInTheDocument()
    expect(screen.getByTestId('panel-tab-changes')).toBeInTheDocument()
  })

  it('opens code panel and switches tab when a code tab is selected', () => {
    mockActiveView = 'code'
    render(<PanelToggle />)
    fireEvent.click(screen.getByTestId('panel-tab-files'))
    expect(setTab).toHaveBeenCalledWith('files')
    expect(setSessionCodePanelOpen).toHaveBeenCalledWith('s1', true)
    expect(setSessionChatPanelOpen).not.toHaveBeenCalled()
    expect(setChatActiveTab).not.toHaveBeenCalled()
  })

  // G1: chat menu never exposes terminal, even when the dark-launch flag is on.
  it('does not show terminal tab on chat surface when CODE_TERMINAL is true', () => {
    mockCodeTerminal = true
    mockActiveView = 'chat'
    render(<PanelToggle />)
    expect(screen.queryByTestId('panel-tab-terminal')).not.toBeInTheDocument()
    expect(screen.getByTestId('panel-tab-files')).toBeInTheDocument()
    expect(screen.getByTestId('panel-tab-agents')).toBeInTheDocument()
  })

  // G4 (flag off): code menu has no terminal entry under dark launch.
  it('does not show terminal tab on code surface when CODE_TERMINAL is false', () => {
    mockActiveView = 'code'
    render(<PanelToggle />)
    expect(screen.queryByTestId('panel-tab-terminal')).not.toBeInTheDocument()
  })

  // G4 (flag on): code + session shows Terminal and selecting it opens the panel.
  it('shows terminal tab on code surface when CODE_TERMINAL is true', () => {
    mockCodeTerminal = true
    mockActiveView = 'code'
    render(<PanelToggle />)
    expect(screen.getByTestId('panel-tab-terminal')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('panel-tab-terminal'))
    expect(setTab).toHaveBeenCalledWith('terminal')
    expect(setSessionCodePanelOpen).toHaveBeenCalledWith('s1', true)
  })

  // G7 already covered by "is hidden when no session is active"

  it('shows knowledge outline tab in workspace (no session required)', () => {
    mockActiveSessionId = null
    mockActiveView = 'knowledge'
    mockKbMode = 'workspace'
    render(<PanelToggle />)
    expect(screen.getByTestId('toggle-panel')).toBeInTheDocument()
    expect(screen.getByTestId('panel-tab-knowledge-outline')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('panel-tab-knowledge-outline'))
    expect(setKnowledgePanelOpen).toHaveBeenCalledWith(true)
  })

  it('hides panel toggle on knowledge home (no space open)', () => {
    mockActiveSessionId = null
    mockActiveView = 'knowledge'
    mockKbMode = 'home'
    render(<PanelToggle />)
    expect(screen.queryByTestId('toggle-panel')).not.toBeInTheDocument()
  })
})
