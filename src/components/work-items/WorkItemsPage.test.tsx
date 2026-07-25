// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { WorkItem, WorkItemList } from '@/domain/work-items'
import { DEFAULT_STATUS_COLORS, INBOX_LIST_ID } from '@/domain/work-items'

const load = vi.fn().mockResolvedValue(undefined)
const complete = vi.fn().mockResolvedValue(undefined)
const reopen = vi.fn().mockResolvedValue(undefined)

let storeState: {
  loaded: boolean
  loading: boolean
  error: string | null
  lists: WorkItemList[]
  items: WorkItem[]
  filterId: string
  search: string
  selectedId: string | null
}

function defaultLists(): WorkItemList[] {
  return [
    {
      id: INBOX_LIST_ID,
      name: 'Inbox',
      sortOrder: 0,
      createdAt: 0,
      updatedAt: 0,
      system: 'inbox',
    },
  ]
}

const requestCreate = vi.fn()
const requestEdit = vi.fn()
const setViewMode = vi.fn()
const setHighlightId = vi.fn()
const shiftCalendarMonth = vi.fn()
const setCalendarCursor = vi.fn()
const closeModal = vi.fn()
const leaveWorkItems = vi.fn()

let viewState = {
  modal: { mode: 'closed' as const },
  viewMode: 'calendar' as 'calendar' | 'list',
  calendarCursor: { year: 2026, monthIndex: 6 },
  highlightId: null as string | null,
}

vi.mock('@/store/workItemStore', () => {
  const useWorkItemStore = (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      ...storeState,
      load,
      complete,
      reopen,
      setSearch: vi.fn(),
      setFilter: vi.fn(),
    })
  useWorkItemStore.getState = () => ({
    ...storeState,
    load,
    complete,
    reopen,
  })
  return { useWorkItemStore }
})

vi.mock('@/store/workItemViewStore', () => {
  const useWorkItemViewStore = (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      ...viewState,
      requestCreate,
      requestEdit,
      setViewMode,
      setHighlightId,
      shiftCalendarMonth,
      setCalendarCursor,
      closeModal,
      leaveWorkItems,
    })
  useWorkItemViewStore.getState = () => ({
    ...viewState,
    requestCreate,
    requestEdit,
  })
  return { useWorkItemViewStore }
})

vi.mock('@/store/workItemUiPrefsStore', () => {
  const useWorkItemUiPrefsStore = (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      loaded: true,
      statusColors: { ...DEFAULT_STATUS_COLORS },
      load: vi.fn().mockResolvedValue(undefined),
      setStatusColor: vi.fn(),
    })
  return { useWorkItemUiPrefsStore }
})

vi.mock('@/store/uiStore', () => {
  const useUiStore = (sel: (s: { activeView: string }) => unknown) =>
    sel({ activeView: 'tasks' })
  return { useUiStore }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}))

import { WorkItemsPage } from './WorkItemsPage'

describe('WorkItemsPage', () => {
  beforeEach(() => {
    storeState = {
      loaded: true,
      loading: false,
      error: null,
      lists: defaultLists(),
      items: [],
      filterId: 'all',
      search: '',
      selectedId: null,
    }
    viewState = {
      modal: { mode: 'closed' },
      viewMode: 'calendar',
      calendarCursor: { year: 2026, monthIndex: 6 },
      highlightId: null,
    }
    load.mockClear().mockResolvedValue(undefined)
    requestCreate.mockClear()
    requestEdit.mockClear()
    complete.mockClear()
    reopen.mockClear()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders calendar by default', () => {
    render(<WorkItemsPage />)
    expect(screen.getByTestId('work-items-page')).toBeInTheDocument()
    expect(screen.getByTestId('work-item-month-calendar')).toBeInTheDocument()
    expect(screen.getByTestId('work-item-view-mode')).toBeInTheDocument()
  })

  it('loads catalog on mount when not loaded', () => {
    storeState.loaded = false
    storeState.loading = true
    render(<WorkItemsPage />)
    expect(load).toHaveBeenCalled()
  })

  it('new button opens create modal bus', () => {
    render(<WorkItemsPage />)
    fireEvent.click(screen.getByTestId('work-item-new'))
    expect(requestCreate).toHaveBeenCalled()
  })

  it('switches to list view and shows rows', () => {
    storeState.items = [
      {
        id: 'wi_1',
        title: 'Ship PR',
        status: 'todo',
        priority: 'high',
        listId: INBOX_LIST_ID,
        tags: [],
        notes: '',
        startOn: '2026-07-25',
        endOn: '2026-07-25',
        createdAt: 1,
        updatedAt: 1,
        completedAt: null,
        archivedAt: null,
        links: {},
      },
    ]
    viewState.viewMode = 'list'
    render(<WorkItemsPage />)
    expect(screen.getByTestId('work-item-list-view')).toBeInTheDocument()
    expect(screen.getByTestId('work-item-row-wi_1')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('work-item-row-wi_1'))
    expect(requestEdit).toHaveBeenCalledWith('wi_1')
  })

  it('calendar paints multi-day bars', () => {
    storeState.items = [
      {
        id: 'wi_span',
        title: 'Span',
        status: 'in_progress',
        priority: 'none',
        listId: INBOX_LIST_ID,
        tags: [],
        notes: '',
        startOn: '2026-07-22',
        endOn: '2026-07-24',
        createdAt: 1,
        updatedAt: 1,
        completedAt: null,
        archivedAt: null,
        links: {},
      },
    ]
    render(<WorkItemsPage />)
    expect(screen.getByTestId('work-item-bar-wi_span')).toBeInTheDocument()
  })
})
