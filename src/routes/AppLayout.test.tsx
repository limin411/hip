// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useUiStore } from '@/store/uiStore'
import { AppLayout } from './AppLayout'

vi.mock('@/components/history/SessionHistory', () => ({ SessionHistory: () => <div data-testid="session-history" /> }))

afterEach(() => {
  cleanup()
  useUiStore.setState({ activeView: 'chat', sidebarOpen: true, overlay: null })
})

vi.mock('react-resizable-panels', () => ({
  PanelGroup: ({ children, className }: { children: any; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  Panel: ({ children, className }: { children: any; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  PanelResizeHandle: ({ className }: { className?: string }) => <div className={className} data-testid="resize-handle" />,
}))

vi.mock('@/components/layout/AppSidebar', () => ({
  AppSidebar: () => <div data-testid="app-sidebar" />,
}))
vi.mock('@/components/layout/MainToolbar', () => ({
  MainToolbar: () => <div data-testid="main-toolbar" />,
}))
vi.mock('@/components/chat/NewConversation', () => ({ NewConversation: () => <div data-testid="new-conversation" /> }))
vi.mock('@/components/chat/ChatPane', () => ({ ChatPane: () => <div data-testid="chat-pane" /> }))
vi.mock('@/components/chat/InputBar', () => ({ InputBar: () => <div data-testid="input-bar" /> }))
vi.mock('@/components/account/SettingsPage', () => ({ SettingsPage: () => <div data-testid="settings-page" /> }))
vi.mock('@/components/knowledge/KnowledgePage', () => ({ KnowledgePage: () => <div data-testid="knowledge-page" /> }))
vi.mock('@/components/terminals/TerminalManagementPage', () => ({
  TerminalManagementPage: () => <div data-testid="terminal-management-page" />,
}))
vi.mock('@/components/terminals/feature', () => ({
  TERMINAL_MANAGEMENT: true,
}))
vi.mock('@/components/work-items/WorkItemsPage', () => ({
  WorkItemsPage: () => <div data-testid="work-items-page" />,
}))
vi.mock('@/components/automation/AutomationsPage', () => ({
  AutomationsPage: () => <div data-testid="automations-page" />,
}))
vi.mock('@/components/automation/AutomationRunHost', () => ({
  AutomationRunHost: () => <div data-testid="automation-run-host" />,
}))
vi.mock('@/components/automation/feature', () => ({
  AUTOMATION_PAGE: true,
}))


describe('AppLayout', () => {
  it('renders final shell: sidebar + main toolbar, no title bar / floating avatar', () => {
    useUiStore.setState({ sidebarOpen: true })
    render(<AppLayout />, { wrapper: MemoryRouter })
    expect(screen.getByTestId('app-sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('main-toolbar')).toBeInTheDocument()
    expect(screen.queryByTestId('title-bar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('floating-avatar')).not.toBeInTheDocument()
  })

  it('hides sidebar when sidebarOpen is false', () => {
    useUiStore.setState({ sidebarOpen: false })
    render(<AppLayout />, { wrapper: MemoryRouter })
    expect(screen.queryByTestId('app-sidebar')).not.toBeInTheDocument()
    expect(screen.getByTestId('main-toolbar')).toBeInTheDocument()
  })

  it('does not render history as main content when activeView is history', () => {
    // History is an overlay shell; residual activeView history is not a main branch.
    useUiStore.setState({ activeView: 'history', overlay: null })
    render(<AppLayout />, { wrapper: MemoryRouter })
    expect(screen.queryByTestId('session-history')).not.toBeInTheDocument()
    expect(screen.getByTestId('main-toolbar')).toBeInTheDocument()
  })

  it('renders history via OverlayShellHost when overlay is history', () => {
    useUiStore.setState({ activeView: 'chat', overlay: 'history' })
    render(<AppLayout />, { wrapper: MemoryRouter })
    expect(screen.getByTestId('session-history')).toBeInTheDocument()
    // Underlying work surface stays chat (no session → new conversation)
    expect(screen.getByTestId('new-conversation')).toBeInTheDocument()
  })

  it('renders knowledge view', () => {
    useUiStore.setState({ activeView: 'knowledge' })
    render(<AppLayout />, { wrapper: MemoryRouter })
    expect(screen.getByTestId('knowledge-page')).toBeInTheDocument()
  })

  it('does not render settings as main content when activeView is settings', () => {
    // Settings is an overlay shell; residual activeView settings is not a main branch.
    useUiStore.setState({ activeView: 'settings', overlay: null })
    render(<AppLayout />, { wrapper: MemoryRouter })
    expect(screen.queryByTestId('settings-page')).not.toBeInTheDocument()
    expect(screen.getByTestId('main-toolbar')).toBeInTheDocument()
  })

  it('renders settings via OverlayShellHost when overlay is settings', () => {
    useUiStore.setState({ activeView: 'chat', overlay: 'settings' })
    render(<AppLayout />, { wrapper: MemoryRouter })
    expect(screen.getByTestId('settings-page')).toBeInTheDocument()
    // Underlying work surface stays chat
    expect(screen.getByTestId('new-conversation')).toBeInTheDocument()
  })


  it('renders TerminalManagementPage when terminals view and flag on', () => {
    useUiStore.setState({ activeView: 'terminals', sidebarSection: 'terminals' })
    render(<AppLayout />, { wrapper: MemoryRouter })
    expect(screen.getByTestId('terminal-management-page')).toBeInTheDocument()
    expect(screen.queryByTestId('placeholder-terminals')).not.toBeInTheDocument()
  })

  it('renders WorkItemsPage when tasks view and WORK_ITEM_TRACKING on', () => {
    useUiStore.setState({ activeView: 'tasks', sidebarSection: 'tasks' })
    render(<AppLayout />, { wrapper: MemoryRouter })
    expect(screen.getByTestId('work-items-page')).toBeInTheDocument()
    expect(screen.queryByTestId('placeholder-tasks')).not.toBeInTheDocument()
  })

  it('renders AutomationsPage when automation view and AUTOMATION_PAGE on', () => {
    useUiStore.setState({ activeView: 'automation' })
    render(<AppLayout />, { wrapper: MemoryRouter })
    expect(screen.getByTestId('automations-page')).toBeInTheDocument()
    expect(screen.queryByTestId('placeholder-automation')).not.toBeInTheDocument()
  })

  it('mounts AutomationRunHost when AUTOMATION_PAGE is on', () => {
    useUiStore.setState({ sidebarOpen: true })
    render(<AppLayout />, { wrapper: MemoryRouter })
    expect(screen.getByTestId('automation-run-host')).toBeInTheDocument()
  })
})
