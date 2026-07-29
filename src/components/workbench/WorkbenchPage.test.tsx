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
  it('renders pixel farm hub: field, plots, no bottom dock', () => {
    renderPage()
    expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
    expect(screen.getByTestId('workbench-farm')).toBeInTheDocument()
    expect(screen.getByTestId('workbench-farm-sky')).toBeInTheDocument()
    expect(screen.getByTestId('workbench-hero')).toBeInTheDocument()
    expect(screen.getByTestId('workbench-modules')).toBeInTheDocument()
    expect(screen.getByTestId('workbench-zone-sessions')).toBeInTheDocument()
    expect(screen.getByTestId('workbench-metric-running')).toHaveTextContent('0')
    expect(screen.queryByTestId('workbench-farm-dock')).not.toBeInTheDocument()
    expect(screen.queryByTestId('workbench-continue')).not.toBeInTheDocument()
    expect(screen.queryByTestId('workbench-shortcuts')).not.toBeInTheDocument()
    expect(screen.queryByTestId('workbench-recent')).not.toBeInTheDocument()
    expect(screen.queryByTestId('workbench-home')).not.toBeInTheDocument()
  })

  it('opens sessions surface on plot click', async () => {
    const { enterSection } = await import('@/components/layout/sidebarActions')
    renderPage()
    fireEvent.click(screen.getByTestId('workbench-zone-sessions'))
    expect(enterSection).toHaveBeenCalledWith('chats')
  })

  it('freezes farm motion when reduce-motion is on', () => {
    useUiStore.setState({ workbenchReduceMotion: true })
    renderPage()
    expect(screen.getByTestId('workbench-farm')).toHaveAttribute('data-motion', 'static')
    expect(screen.getByTestId('workbench-farm-sky')).toHaveAttribute('data-motion', 'static')
  })
})
