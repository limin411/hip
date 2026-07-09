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

vi.mock('@/domain', () => ({
  useActiveSessionId: () => mockActiveSessionId,
}))

vi.mock('@/store/uiStore', () => ({
  useUiStore: (selector: (state: any) => any) =>
    selector({
      activeView: mockActiveView,
      activeTab: mockActiveTab,
      chatActiveTab: mockChatActiveTab,
      setTab,
      setChatActiveTab,
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

let mockActiveSessionId: string | null = 's1'
let mockActiveView = 'chat'
let mockActiveTab = 'agents'
let mockChatActiveTab = 'files'
let mockIsGitRepo = false

describe('PanelToggle', () => {
  beforeEach(() => {
    mockActiveSessionId = 's1'
    mockActiveView = 'chat'
    mockActiveTab = 'agents'
    mockChatActiveTab = 'files'
    mockIsGitRepo = false
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
    expect(screen.getByTestId('panel-tab-dag')).toBeInTheDocument()
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
})
