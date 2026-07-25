// @vitest-environment happy-dom
/**
 * Flag-true AppSidebar paths for work items.
 * Mirrors terminals pattern: mock feature flag on in a dedicated file.
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUiStore } from '@/store/uiStore'
import { useDomainStore } from '@/domain'
import { DEFAULT_CONFIG } from '@/domain/sessionStore'
import { useNavHistoryStore } from '@/store/navHistoryStore'
vi.mock('@/components/work-items/feature', () => ({
  WORK_ITEM_TRACKING: true,
}))

const enterWorkItemsSection = vi.fn(async () => {})
const enterPlaceholderSection = vi.fn(async (_section?: string) => {})
const requestCreate = vi.fn()

vi.mock('./sidebarActions', () => ({
  enterKnowledge: vi.fn(async () => {}),
  enterSection: vi.fn(async () => {}),
  enterPlaceholderSection: (section: string) => enterPlaceholderSection(section),
  enterTerminalsSection: vi.fn(async () => {}),
  enterWorkItemsSection: () => enterWorkItemsSection(),
  openHistoryFromChrome: vi.fn(),
  openSettingsFromChrome: vi.fn(),
  openAutomationFromChrome: vi.fn(),
  openTrashFromChrome: vi.fn(),
  leaveKnowledge: vi.fn(async () => {}),
  leaveWorkItems: vi.fn(async () => {}),
  openSpaceFromSidebar: vi.fn(),
  selectSessionFromSidebar: vi.fn(),
  newConversationFromSidebar: vi.fn(),
}))

vi.mock('@/components/knowledge/knowledgeSpaceDialogStore', () => ({
  openCreateKnowledgeSpaceDialog: vi.fn(),
}))

vi.mock('./SidebarAccountFooter', () => ({
  SidebarAccountFooter: () => <div data-testid="sidebar-account-footer" />,
}))

vi.mock('@/ipc/pathExists', () => ({
  isDirectory: vi.fn(async () => null),
}))

vi.mock('@/components/context-menu', () => ({
  DeclarativeContextMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/store/knowledgeStore', () => {
  const state = { spaces: [], activeSpaceId: null }
  const useKnowledgeStore = (sel: (s: typeof state) => unknown) => sel(state)
  useKnowledgeStore.getState = () => state
  return { useKnowledgeStore }
})

vi.mock('@/store/workItemStore', () => {
  const state = {
    filterId: 'all',
    lists: [],
    items: [],
    setFilter: vi.fn(),
  }
  const useWorkItemStore = (sel: (s: typeof state) => unknown) => sel(state)
  useWorkItemStore.getState = () => state
  return { useWorkItemStore }
})

vi.mock('@/store/workItemViewStore', () => {
  const state = {
    requestCreate: () => requestCreate(),
  }
  const useWorkItemViewStore = (sel: (s: typeof state) => unknown) => sel(state)
  useWorkItemViewStore.getState = () => state
  return { useWorkItemViewStore }
})

vi.mock('@/store/workItemUiPrefsStore', () => {
  const useWorkItemUiPrefsStore = (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      statusColors: {
        todo: '#3b82f6',
        in_progress: '#f59e0b',
        done: '#22c55e',
        archived: '#94a3b8',
      },
      load: vi.fn().mockResolvedValue(undefined),
      setStatusColor: vi.fn(),
    })
  return { useWorkItemUiPrefsStore }
})

import { AppSidebar } from './AppSidebar'

describe('AppSidebar with WORK_ITEM_TRACKING true', () => {
  beforeEach(() => {
    enterWorkItemsSection.mockClear()
    enterPlaceholderSection.mockClear()
    requestCreate.mockClear()
    useNavHistoryStore.setState({ stack: [], index: -1, applying: false })
    useUiStore.setState({
      activeView: 'chat',
      sidebarSection: 'chats',
      sidebarOpen: true,
    })
    useDomainStore.setState({
      sessions: [
        {
          id: 'chat-1',
          title: 'Hello',
          preview: '',
          updatedAtMs: Date.now(),
          config: { ...DEFAULT_CONFIG, surface: 'chat' },
          messages: [],
          status: 'idle',
          loaded: true,
        },
      ],
      activeSessionId: 'chat-1',
    } as never)
  })

  afterEach(() => {
    cleanup()
  })

  it('nav tasks calls enterWorkItemsSection not placeholder', () => {
    render(<AppSidebar />)
    fireEvent.click(screen.getByTestId('sidebar-nav-tasks'))
    expect(enterWorkItemsSection).toHaveBeenCalled()
    expect(enterPlaceholderSection).not.toHaveBeenCalledWith('tasks')
  })

  it('tasks section shows smart filters and new work item button (no lists)', () => {
    useUiStore.setState({ sidebarSection: 'tasks', activeView: 'tasks' })
    render(<AppSidebar />)
    expect(screen.getByTestId('sidebar-work-items')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-work-item-filter-all')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-work-item-filter-todo')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-work-item-filter-in_progress')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-work-item-filter-done')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-work-item-filter-archived')).toBeInTheDocument()
    expect(screen.queryByTestId('sidebar-work-item-filter-open')).not.toBeInTheDocument()
    expect(screen.queryByTestId('sidebar-work-item-filter-cancelled')).not.toBeInTheDocument()
    expect(screen.queryByTestId('sidebar-new-work-item-list')).not.toBeInTheDocument()
    expect(screen.queryByTestId(/^sidebar-work-item-list-/)).not.toBeInTheDocument()
    expect(screen.getByTestId('sidebar-new-work-item')).toBeInTheDocument()
  })

  it('new work item button enters section and requestCreate', async () => {
    useUiStore.setState({ sidebarSection: 'tasks', activeView: 'tasks' })
    render(<AppSidebar />)
    fireEvent.click(screen.getByTestId('sidebar-new-work-item'))
    await vi.waitFor(() => {
      expect(enterWorkItemsSection).toHaveBeenCalled()
      expect(requestCreate).toHaveBeenCalled()
    })
  })
})
