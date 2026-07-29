// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18n from '@/i18n'
import { useUiStore } from '@/store/uiStore'
import { useDomainStore } from '@/domain'
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
  useDomainStore.setState({ sessions: [], activeSessionId: null })
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
  it('renders dense calm home: ambient, continue, surfaces, shortcuts, recent', () => {
    renderPage()
    expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
    expect(screen.getByTestId('workbench-home')).toBeInTheDocument()
    expect(screen.getByTestId('workbench-ambient')).toBeInTheDocument()
    expect(screen.getByTestId('workbench-hero')).toBeInTheDocument()
    expect(screen.getByTestId('workbench-continue')).toBeInTheDocument()
    expect(screen.getByTestId('workbench-continue-empty')).toBeInTheDocument()
    expect(screen.getByTestId('workbench-modules')).toBeInTheDocument()
    expect(screen.getByTestId('workbench-shortcuts')).toBeInTheDocument()
    expect(screen.getByTestId('workbench-shortcut-new-chat')).toBeInTheDocument()
    expect(screen.getByTestId('workbench-recent')).toBeInTheDocument()
    expect(screen.getByTestId('workbench-recent-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('workbench-attention')).not.toBeInTheDocument()
    expect(screen.getByTestId('workbench-zone-sessions')).toBeInTheDocument()
    expect(screen.getByTestId('workbench-metric-running')).toHaveTextContent('0')
  })

  it('shows continue + recent when sessions exist', () => {
    useDomainStore.setState({
      sessions: [
        {
          id: 's1',
          title: 'Fix auth flow',
          status: 'idle',
          updatedAtMs: Date.now() - 60_000,
          createdAtMs: Date.now() - 3600_000,
          messages: [],
          config: { surface: 'code' },
        },
      ] as never,
      activeSessionId: null,
    })
    renderPage()
    expect(screen.getByTestId('workbench-continue-session')).toBeInTheDocument()
    expect(screen.getAllByText('Fix auth flow').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByTestId('workbench-recent-s1')).toBeInTheDocument()
    expect(screen.queryByTestId('workbench-recent-empty')).not.toBeInTheDocument()
  })

  it('opens sessions surface on click', async () => {
    const { enterSection } = await import('@/components/layout/sidebarActions')
    renderPage()
    fireEvent.click(screen.getByTestId('workbench-zone-sessions'))
    expect(enterSection).toHaveBeenCalledWith('chats')
  })

  it('resumes latest session from continue card', async () => {
    const { sessionService } = await import('@/domain')
    useDomainStore.setState({
      sessions: [
        {
          id: 's-latest',
          title: 'Resume me',
          status: 'idle',
          updatedAtMs: Date.now(),
          createdAtMs: Date.now() - 1000,
          messages: [],
          config: { surface: 'chat' },
        },
      ] as never,
      activeSessionId: null,
    })
    renderPage()
    fireEvent.click(screen.getByTestId('workbench-continue-session'))
    expect(sessionService.selectSession).toHaveBeenCalledWith('s-latest')
  })

  it('freezes ambient motion when reduce-motion is on', () => {
    useUiStore.setState({ workbenchReduceMotion: true })
    renderPage()
    expect(screen.getByTestId('workbench-ambient')).toHaveAttribute('data-motion', 'static')
  })
})
