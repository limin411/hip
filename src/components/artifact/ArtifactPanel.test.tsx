// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import React from 'react'
import type { WorkflowDef, RunState } from '@hip/protocol'

// ── Mocks ──

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'artifact.files': 'Files',
        'artifact.agents': 'Agents',
        'artifact.timeline': 'Timeline',
        'artifact.changes': 'Changes',
        'artifact.closePanel': 'Close panel',
      }
      return map[key] ?? key
    },
  }),
}))

vi.mock('lucide-react', () => ({
  X: () => React.createElement('span', { 'data-testid': 'icon-x' }),
}))

// Mock UI components
vi.mock('@/components/ui/Tabs', async () => {
  const React = await import('react')
  return {
    Tabs: ({ children, value }: { children: React.ReactNode; value: string }) =>
      React.createElement('div', { 'data-testid': 'tabs', 'data-value': value }, children),
    TabsList: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', { 'data-testid': 'tabs-list' }, children),
    TabsTrigger: ({ children, value }: { children: React.ReactNode; value: string }) =>
      React.createElement('button', { 'data-testid': `tab-${value}` }, children),
    TabsContent: ({ children, value }: { children: React.ReactNode; value: string }) =>
      React.createElement('div', { 'data-testid': `tab-content-${value}` }, children),
  }
})

vi.mock('@/components/ui/Button', () => ({
  Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) =>
    React.createElement('button', { 'data-testid': 'close-btn', onClick }, children),
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
vi.mock('@/components/workflow/DagEditor', () => ({
  DagEditor: () => React.createElement('div', { 'data-testid': 'dag-editor' }),
}))

// Mock stores with settable state
let mockUiState = { activeTab: 'files' as string }
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

let mockWorkflowState: { activeWorkflow: WorkflowDef | null; runState: RunState | null } = {
  activeWorkflow: null,
  runState: null,
}
vi.mock('@/store/workflowStore', () => ({
  useWorkflowStore: (sel: (s: typeof mockWorkflowState) => unknown) => sel(mockWorkflowState),
}))

vi.mock('@/domain', () => ({
  useActiveSessionId: () => 'sess-1',
}))

import { ArtifactPanel } from './ArtifactPanel'

describe('ArtifactPanel', () => {
  beforeEach(() => {
    cleanup()
    mockUiState = { activeTab: 'files' }
    mockDomainState = { activeSessionId: 'sess-1' }
    mockDiffState = { bySession: { 'sess-1': { isGitRepo: false } } }
    mockWorkflowState = { activeWorkflow: null, runState: null }
  })

  afterEach(() => {
    cleanup()
  })

  it('renders all always-visible tabs (Files, Agents, DAG)', () => {
    render(<ArtifactPanel />)
    expect(screen.getByTestId('tab-files')).toBeInTheDocument()
    expect(screen.getByTestId('tab-agents')).toBeInTheDocument()
    expect(screen.getByTestId('tab-dag')).toBeInTheDocument()
  })

  it('hides git-gated tabs (Timeline, Changes) when not in a git repo', () => {
    render(<ArtifactPanel />)
    expect(screen.queryByTestId('tab-timeline')).toBeNull()
    expect(screen.queryByTestId('tab-changes')).toBeNull()
  })

  it('shows git-gated tabs when in a git repo', () => {
    mockDiffState = { bySession: { 'sess-1': { isGitRepo: true, summary: { totalFiles: 3 } } } }
    render(<ArtifactPanel />)
    expect(screen.getByTestId('tab-timeline')).toBeInTheDocument()
    expect(screen.getByTestId('tab-changes')).toBeInTheDocument()
  })

  it('shows changes badge count when in a git repo with diffs', () => {
    mockDiffState = { bySession: { 'sess-1': { isGitRepo: true, summary: { totalFiles: 5 } } } }
    render(<ArtifactPanel />)
    expect(screen.getByTestId('changes-badge')).toBeInTheDocument()
    expect(screen.getByTestId('changes-badge').textContent).toBe('5')
  })

  it('renders FileTree and FilePreview when files tab is active', () => {
    render(<ArtifactPanel />)
    expect(screen.getByTestId('file-tree')).toBeInTheDocument()
    expect(screen.getByTestId('file-preview')).toBeInTheDocument()
  })

  it('renders AgentDashboard when agents tab is active', () => {
    mockUiState = { activeTab: 'agents' }
    render(<ArtifactPanel />)
    expect(screen.getByTestId('agent-dashboard')).toBeInTheDocument()
  })

  it('renders DagEditor when a workflow is active and DAG tab is selected', () => {
    mockUiState = { activeTab: 'dag' }
    mockWorkflowState = {
      activeWorkflow: { id: 'wf-1', name: 'Test', nodes: [], edges: [], entry: [] },
      runState: null,
    }
    render(<ArtifactPanel />)
    expect(screen.getByTestId('dag-editor')).toBeInTheDocument()
  })

  it('shows empty state when DAG tab is selected but no workflow is active', () => {
    mockUiState = { activeTab: 'dag' }
    mockWorkflowState = { activeWorkflow: null, runState: null }
    render(<ArtifactPanel />)
    expect(screen.queryByTestId('dag-editor')).toBeNull()
    expect(screen.getByText(/No workflow active/)).toBeInTheDocument()
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
})
