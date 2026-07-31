// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'artifact.files': 'Files',
        'artifact.agents': 'Agents',
        'artifact.outline': 'Outline',
        'artifact.sources': 'Sources',
        'artifact.timeline': 'Timeline',
        'artifact.changes': 'Changes',
        'artifact.terminal': 'Terminal',
        'artifact.moreTabs': 'More tabs',
        'chat.togglePanel': 'Panel',
      }
      return map[key] ?? key
    },
  }),
}))

// Radix portals don't interact well with happy-dom clicks — render inline like the
// other dropdown tests in this repo (PermissionModePicker / SessionAgentPicker).
vi.mock('@/components/ui/DropdownMenu', async () => {
  const React = await import('react')
  return {
    DropdownMenu: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    DropdownMenuContent: ({
      children,
      ...rest
    }: {
      children: React.ReactNode
      'data-testid'?: string
    }) => React.createElement('div', { 'data-testid': rest['data-testid'] }, children),
    DropdownMenuItem: ({
      children,
      onSelect,
      ...rest
    }: {
      children: React.ReactNode
      onSelect?: () => void
      'data-testid'?: string
    }) =>
      React.createElement(
        'div',
        { 'data-testid': rest['data-testid'], onClick: () => onSelect?.() },
        children,
      ),
  }
})

const setTab = vi.fn()
const setChatActiveTab = vi.fn()

let mockUiState = {
  activeTab: 'files' as string,
  chatActiveTab: 'files' as string,
  setTab,
  setChatActiveTab,
}
vi.mock('@/store/uiStore', () => ({
  useUiStore: (sel: (s: typeof mockUiState) => unknown) => sel(mockUiState),
}))

let mockDomainState = { activeSessionId: 'sess-1' }
vi.mock('@/domain/sessionStore', () => ({
  useDomainStore: (sel: (s: typeof mockDomainState) => unknown) => sel(mockDomainState),
}))

let mockDiffState: { bySession: Record<string, { isGitRepo?: boolean }> } = {
  bySession: { 'sess-1': { isGitRepo: false } },
}
vi.mock('@/store/diffStore', () => ({
  useDiffStore: (sel: (s: typeof mockDiffState) => unknown) => sel(mockDiffState),
}))

let mockCodeTerminal = false
vi.mock('./terminalFeature', () => ({
  get CODE_TERMINAL() {
    return mockCodeTerminal
  },
}))

import { PanelTabBar } from './PanelTabBar'

describe('PanelTabBar', () => {
  beforeEach(() => {
    cleanup()
    setTab.mockClear()
    setChatActiveTab.mockClear()
    mockUiState = {
      activeTab: 'files',
      chatActiveTab: 'files',
      setTab,
      setChatActiveTab,
    }
    mockDomainState = { activeSessionId: 'sess-1' }
    mockDiffState = { bySession: { 'sess-1': { isGitRepo: false } } }
    mockCodeTerminal = false
  })

  afterEach(() => {
    cleanup()
  })

  it('renders chat tabs and switches chatActiveTab', () => {
    render(<PanelTabBar surface="chat" />)
    expect(screen.getByTestId('panel-tab-bar')).toBeInTheDocument()
    expect(screen.getByTestId('panel-tab-outline')).toBeInTheDocument()
    expect(screen.getByTestId('panel-tab-files')).toBeInTheDocument()
    expect(screen.getByTestId('panel-tab-sources')).toBeInTheDocument()
    expect(screen.getByTestId('panel-tab-agents')).toBeInTheDocument()
    expect(screen.queryByTestId('panel-tab-timeline')).not.toBeInTheDocument()
    expect(screen.queryByTestId('panel-tab-terminal')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('panel-tab-agents'))
    expect(setChatActiveTab).toHaveBeenCalledWith('agents')
    expect(setTab).not.toHaveBeenCalled()
  })

  it('hides git-gated code tabs when not a git repo', () => {
    render(<PanelTabBar surface="code" />)
    expect(screen.getByTestId('panel-tab-files')).toBeInTheDocument()
    expect(screen.getByTestId('panel-tab-agents')).toBeInTheDocument()
    expect(screen.queryByTestId('panel-tab-timeline')).not.toBeInTheDocument()
    expect(screen.queryByTestId('panel-tab-changes')).not.toBeInTheDocument()
  })

  it('shows git-gated code tabs in a git repo and switches activeTab', () => {
    mockDiffState = { bySession: { 'sess-1': { isGitRepo: true } } }
    render(<PanelTabBar surface="code" />)
    expect(screen.getByTestId('panel-tab-timeline')).toBeInTheDocument()
    expect(screen.getByTestId('panel-tab-changes')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('panel-tab-changes'))
    expect(setTab).toHaveBeenCalledWith('changes')
    expect(setChatActiveTab).not.toHaveBeenCalled()
  })

  it('shows terminal tab on code when CODE_TERMINAL is on', () => {
    mockCodeTerminal = true
    render(<PanelTabBar surface="code" />)
    expect(screen.getByTestId('panel-tab-terminal')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('panel-tab-terminal'))
    expect(setTab).toHaveBeenCalledWith('terminal')
  })

  it('marks the active tab selected', () => {
    mockUiState = { ...mockUiState, activeTab: 'agents' }
    render(<PanelTabBar surface="code" />)
    expect(screen.getByTestId('panel-tab-agents')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('panel-tab-files')).toHaveAttribute('aria-selected', 'false')
  })

  it('shows the ⋯ overflow menu when tabs do not fit and jumps from it', () => {
    const { container, rerender } = render(<PanelTabBar surface="code" />)
    expect(screen.queryByTestId('panel-tabs-overflow')).not.toBeInTheDocument()

    // Fake a narrow strip, then change the tab set so the layout effect re-measures.
    const strip = container.querySelector('[data-testid="panel-tab-strip"]')!
    Object.defineProperty(strip, 'clientWidth', { value: 80, configurable: true })
    Object.defineProperty(strip, 'scrollWidth', { value: 600, configurable: true })
    mockDiffState = { bySession: { 'sess-1': { isGitRepo: true } } }
    rerender(<PanelTabBar surface="code" />)

    expect(screen.getByTestId('panel-tabs-overflow')).toBeInTheDocument()
    expect(screen.getByTestId('panel-tab-overflow-menu')).toBeInTheDocument()
    expect(screen.getByTestId('panel-tab-overflow-timeline')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('panel-tab-overflow-timeline'))
    expect(setTab).toHaveBeenCalledWith('timeline')
  })

  it('hides the ⋯ overflow menu when all tabs fit', () => {
    const { container, rerender } = render(<PanelTabBar surface="chat" />)
    const strip = container.querySelector('[data-testid="panel-tab-strip"]')!
    Object.defineProperty(strip, 'clientWidth', { value: 800, configurable: true })
    Object.defineProperty(strip, 'scrollWidth', { value: 300, configurable: true })
    rerender(<PanelTabBar surface="code" />) // surface switch re-runs the measure

    expect(screen.queryByTestId('panel-tabs-overflow')).not.toBeInTheDocument()
  })

  it('scrolls the active tab into view once the strip starts clipping', () => {
    const scrollIntoView = vi
      .spyOn(HTMLElement.prototype, 'scrollIntoView')
      .mockImplementation(() => {})
    const { container, rerender } = render(<PanelTabBar surface="code" />)

    const strip = container.querySelector('[data-testid="panel-tab-strip"]')!
    Object.defineProperty(strip, 'clientWidth', { value: 80, configurable: true })
    Object.defineProperty(strip, 'scrollWidth', { value: 600, configurable: true })
    mockDiffState = { bySession: { 'sess-1': { isGitRepo: true } } }
    rerender(<PanelTabBar surface="code" />)

    expect(scrollIntoView).toHaveBeenCalled()
    scrollIntoView.mockRestore()
  })
})
