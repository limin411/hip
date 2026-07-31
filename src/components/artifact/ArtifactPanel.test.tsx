// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import React from 'react'

// ── Mocks ──

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'artifact.files': 'Files',
        'artifact.agents': 'Agents',
        'artifact.timeline': 'Timeline',
        'artifact.changes': 'Changes',
        'artifact.terminal': 'Terminal',
        'artifact.closePanel': 'Close panel',
      }
      return map[key] ?? key
    },
  }),
}))

vi.mock('@/components/layout/PanelToggle', () => ({
  PanelToggle: () => React.createElement('button', { 'data-testid': 'close-btn', type: 'button' }, 'collapse'),
}))

vi.mock('./PanelTabBar', () => ({
  PanelTabBar: () => React.createElement('div', { 'data-testid': 'panel-tab-bar', role: 'tablist' }),
}))

vi.mock('react-resizable-panels', () => ({
  Panel: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'resizable-panel' }, children),
  PanelGroup: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'panel-group' }, children),
  PanelResizeHandle: () => React.createElement('div', { 'data-testid': 'resize-handle' }),
}))

// Mock child components
vi.mock('./FileTree', () => ({
  FileTree: () => React.createElement('div', { 'data-testid': 'file-tree' }),
}))
vi.mock('./FilePreview', () => ({
  FilePreview: () => React.createElement('div', { 'data-testid': 'file-preview' }),
}))
vi.mock('./AgentDashboard', () => ({
  AgentDashboard: () => React.createElement('div', { 'data-testid': 'agent-dashboard' }),
}))
vi.mock('./AgentsRuntimeSplit', () => ({
  AgentsRuntimeSplit: () => React.createElement('div', { 'data-testid': 'agents-runtime-split' }),
}))
vi.mock('./TimelineView', () => ({
  TimelineView: () => React.createElement('div', { 'data-testid': 'timeline-view' }),
}))
vi.mock('./ChangesView', () => ({
  ChangesView: () => React.createElement('div', { 'data-testid': 'changes-view' }),
}))
vi.mock('./GitInitBanner', () => ({
  GitInitBanner: () => React.createElement('div', { 'data-testid': 'git-init-banner' }),
}))
vi.mock('./BranchSwitcher', () => ({
  BranchSwitcher: () => React.createElement('div', { 'data-testid': 'branch-switcher' }),
}))
vi.mock('./TerminalView', () => ({
  TerminalView: () => React.createElement('div', { 'data-testid': 'terminal-view' }),
}))

vi.mock('./terminalFeature', () => ({
  get CODE_TERMINAL() {
    return mockCodeTerminal
  },
}))

// Mock stores with settable state
let mockUiState = { activeTab: 'files' as string }
let mockCodeTerminal = false
vi.mock('@/store/uiStore', () => ({
  useUiStore: (sel: (s: typeof mockUiState) => unknown) => sel(mockUiState),
}))

let mockDomainState = { activeSessionId: 'sess-1' }
vi.mock('@/domain/sessionStore', () => ({
  useDomainStore: (sel: (s: typeof mockDomainState) => unknown) => sel(mockDomainState),
}))

let mockDiffState: { bySession: Record<string, { isGitRepo?: boolean; summary?: { totalFiles: number } }> } = {
  bySession: { 'sess-1': { isGitRepo: false } },
}
vi.mock('@/store/diffStore', () => ({
  useDiffStore: (sel: (s: typeof mockDiffState) => unknown) => sel(mockDiffState),
}))

vi.mock('@/domain', () => ({
  useActiveSessionId: () => 'sess-1',
}))

import { ArtifactPanel } from './ArtifactPanel'

describe('ArtifactPanel', () => {
  beforeEach(() => {
    cleanup()
    mockUiState = { activeTab: 'files' }
    mockCodeTerminal = false
    mockDomainState = { activeSessionId: 'sess-1' }
    mockDiffState = { bySession: { 'sess-1': { isGitRepo: false } } }
  })

  afterEach(() => {
    cleanup()
  })

  it('shows the titlebar tab bar without a panel title', () => {
    render(<ArtifactPanel />)
    expect(screen.getByTestId('panel-tab-bar')).toBeInTheDocument()
    expect(screen.queryByTestId('panel-title')).toBeNull()
  })

  it('falls back to files when a git-gated tab is active outside a git repo', () => {
    mockUiState = { activeTab: 'timeline' }
    render(<ArtifactPanel />)
    expect(screen.getByTestId('panel-view-files')).toBeInTheDocument()
    expect(screen.queryByTestId('timeline-view')).toBeNull()
  })

  it('renders TimelineView when timeline is active in a git repo', () => {
    mockUiState = { activeTab: 'timeline' }
    mockDiffState = { bySession: { 'sess-1': { isGitRepo: true } } }
    render(<ArtifactPanel />)
    expect(screen.getByTestId('panel-view-timeline')).toBeInTheDocument()
    expect(screen.getByTestId('timeline-view')).toBeInTheDocument()
  })

  it('renders FileTree and FilePreview when files tab is active', () => {
    render(<ArtifactPanel />)
    expect(screen.getByTestId('file-tree')).toBeInTheDocument()
    expect(screen.getByTestId('file-preview')).toBeInTheDocument()
  })

  it('renders AgentsRuntimeSplit when agents tab is active', () => {
    mockUiState = { activeTab: 'agents' }
    render(<ArtifactPanel />)
    expect(screen.getByTestId('panel-view-agents')).toBeInTheDocument()
    expect(screen.getByTestId('agents-runtime-split')).toBeInTheDocument()
  })

  it('maps legacy tasks tab to AgentsRuntimeSplit', () => {
    mockUiState = { activeTab: 'tasks' }
    render(<ArtifactPanel />)
    expect(screen.getByTestId('panel-view-agents')).toBeInTheDocument()
    expect(screen.getByTestId('agents-runtime-split')).toBeInTheDocument()
  })

  it('shows GitInitBanner in files tab when not in a git repo', () => {
    render(<ArtifactPanel />)
    expect(screen.getByTestId('git-init-banner')).toBeInTheDocument()
  })

  it('shows BranchSwitcher when in a git repo', () => {
    mockDiffState = { bySession: { 'sess-1': { isGitRepo: true } } }
    render(<ArtifactPanel />)
    expect(screen.getByTestId('branch-switcher')).toBeInTheDocument()
  })

  it('renders close button', () => {
    render(<ArtifactPanel />)
    expect(screen.getByTestId('close-btn')).toBeInTheDocument()
  })

  // G3: flag off + leftover activeTab=terminal → fallback files
  it('falls back to files when terminal tab is active but CODE_TERMINAL is false', () => {
    mockUiState = { activeTab: 'terminal' }
    mockCodeTerminal = false
    render(<ArtifactPanel />)
    expect(screen.getByTestId('panel-view-files')).toBeInTheDocument()
    expect(screen.queryByTestId('terminal-view')).toBeNull()
  })

  // G4: flag on + terminal tab → TerminalView
  it('renders TerminalView when terminal tab is active and CODE_TERMINAL is true', () => {
    mockUiState = { activeTab: 'terminal' }
    mockCodeTerminal = true
    render(<ArtifactPanel />)
    expect(screen.getByTestId('panel-view-terminal')).toBeInTheDocument()
    expect(screen.getByTestId('terminal-view')).toBeInTheDocument()
  })
})
