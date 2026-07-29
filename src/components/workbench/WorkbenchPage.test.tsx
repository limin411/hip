// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18n from '@/i18n'
import { useUiStore } from '@/store/uiStore'
import { WorkbenchPage } from './WorkbenchPage'

vi.mock('@/components/layout/sidebarActions', () => ({
  enterSection: vi.fn(async () => {}),
  enterKnowledge: vi.fn(async () => {}),
  enterWorkItemsSection: vi.fn(async () => {}),
  enterAutomationsSection: vi.fn(async () => {}),
  enterTerminalsSection: vi.fn(async () => {}),
}))

vi.mock('@/domain', async () => {
  const actual = await vi.importActual<typeof import('@/domain')>('@/domain')
  return {
    ...actual,
    sessionService: {
      ...actual.sessionService,
      selectSession: vi.fn(),
    },
    useDomainStore: Object.assign(
      (sel: (s: { sessions: unknown[]; activeSessionId: string | null }) => unknown) =>
        sel({ sessions: [], activeSessionId: null }),
      {
        getState: () => ({ sessions: [], activeSessionId: null }),
      },
    ),
  }
})

vi.mock('@/store/workItemStore', () => ({
  useWorkItemStore: (sel: (s: { items: unknown[] }) => unknown) => sel({ items: [] }),
}))
vi.mock('@/store/automationStore', () => ({
  useAutomationStore: (sel: (s: { automations: unknown[] }) => unknown) =>
    sel({ automations: [] }),
  listInFlightIds: () => [],
}))
vi.mock('@/store/knowledgeStore', () => ({
  useKnowledgeStore: (sel: (s: { spaces: unknown[] }) => unknown) => sel({ spaces: [] }),
}))
vi.mock('@/store/managedTerminalStore', () => ({
  useManagedTerminalStore: (sel: (s: { terminals: unknown[] }) => unknown) =>
    sel({ terminals: [] }),
}))
vi.mock('@/store/taskRuntimeStore', () => ({
  useTaskRuntimeStore: (sel: (s: { bySession: Record<string, never> }) => unknown) =>
    sel({ bySession: {} }),
}))
vi.mock('@/lib/activeWork', () => ({
  countActiveWork: () => ({ runningSessions: 0, runningTasks: 0, total: 0 }),
}))

beforeEach(() => {
  useUiStore.setState({
    workbenchShowScene: true,
    workbenchReduceMotion: false,
  })
})

afterEach(() => {
  cleanup()
})

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <WorkbenchPage />
    </I18nextProvider>,
  )
}

describe('WorkbenchPage', () => {
  it('renders 2.5D farm map with hero and plots (no footer shortcuts)', () => {
    renderPage()
    expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
    expect(screen.getByTestId('workbench-farm-map')).toBeInTheDocument()
    expect(screen.getByTestId('workbench-hero')).toBeInTheDocument()
    expect(screen.getByTestId('workbench-modules')).toBeInTheDocument()
    expect(screen.queryByTestId('workbench-shortcuts')).not.toBeInTheDocument()
    expect(screen.getByTestId('workbench-zone-sessions')).toBeInTheDocument()
    expect(screen.getByTestId('workbench-zone-knowledge')).toBeInTheDocument()
    expect(screen.getAllByTestId('workbench-mascot').length).toBeGreaterThan(0)
    expect(screen.getByTestId('workbench-metric-running')).toHaveTextContent('0')
  })

  it('shows plot state idle by default', () => {
    renderPage()
    expect(screen.getByTestId('workbench-zone-sessions')).toHaveAttribute('data-state', 'idle')
  })

  it('opens sessions plot on click', async () => {
    const { enterSection } = await import('@/components/layout/sidebarActions')
    renderPage()
    fireEvent.click(screen.getByTestId('workbench-zone-sessions'))
    expect(enterSection).toHaveBeenCalledWith('chats')
  })

  it('hides mascots when farmers toggle is off', () => {
    useUiStore.setState({ workbenchShowScene: false })
    renderPage()
    // forceStatic path still may show HipLogo as decorative — no motion mascot action
    expect(screen.queryByTestId('workbench-mascot')).not.toBeInTheDocument()
  })
})
