// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import type { WorkItem, WorkItemList } from '@/domain/work-items'
import { INBOX_LIST_ID } from '@/domain/work-items'

const load = vi.fn().mockResolvedValue(undefined)
const createItem = vi.fn()
const select = vi.fn()
const complete = vi.fn().mockResolvedValue(undefined)
const reopen = vi.fn().mockResolvedValue(undefined)
const setSearch = vi.fn()
const setFilter = vi.fn()
const updateItem = vi.fn().mockResolvedValue(undefined)
const setStatus = vi.fn().mockResolvedValue(undefined)
const archive = vi.fn().mockResolvedValue(undefined)
const unarchive = vi.fn().mockResolvedValue(undefined)
const cancel = vi.fn().mockResolvedValue(undefined)
const deleteItem = vi.fn().mockResolvedValue(undefined)
const finalizeSelectedItem = vi.fn()
const setNotesDraft = vi.fn()
const commitNotesDraft = vi.fn()

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

vi.mock('@/store/workItemStore', () => {
  const useWorkItemStore = (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      ...storeState,
      load,
      createItem,
      select,
      complete,
      reopen,
      setSearch,
      setFilter,
      updateItem,
      setStatus,
      archive,
      unarchive,
      cancel,
      deleteItem,
      finalizeSelectedItem,
      setNotesDraft,
      commitNotesDraft,
    })
  useWorkItemStore.getState = () => ({
    ...storeState,
    load,
    createItem,
    select,
    complete,
    reopen,
    setSearch,
    setFilter,
    updateItem,
    setStatus,
    archive,
    unarchive,
    cancel,
    deleteItem,
    finalizeSelectedItem,
    setNotesDraft,
    commitNotesDraft,
  })
  return { useWorkItemStore }
})

vi.mock('@/store/uiStore', () => {
  const useUiStore = (sel: (s: { activeView: string }) => unknown) =>
    sel({ activeView: 'tasks' })
  return { useUiStore }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
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
      filterId: 'open',
      search: '',
      selectedId: null,
    }
    load.mockClear().mockResolvedValue(undefined)
    createItem.mockClear().mockResolvedValue('wi_new')
    select.mockClear()
    complete.mockClear().mockResolvedValue(undefined)
    reopen.mockClear().mockResolvedValue(undefined)
    setSearch.mockClear()
    setFilter.mockClear()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders empty catalog state', () => {
    render(<WorkItemsPage />)
    expect(screen.getByTestId('work-items-page')).toBeInTheDocument()
    expect(screen.getByTestId('work-item-empty-catalog')).toBeInTheDocument()
    expect(screen.getByTestId('work-item-detail-empty')).toBeInTheDocument()
  })

  it('loads catalog on mount when not loaded', () => {
    storeState.loaded = false
    storeState.loading = true
    render(<WorkItemsPage />)
    expect(load).toHaveBeenCalled()
  })

  it('creates item from empty-state CTA', async () => {
    render(<WorkItemsPage />)
    const btn = screen.getByRole('button', { name: 'workItems.newItem' })
    fireEvent.click(btn)
    await waitFor(() => {
      expect(createItem).toHaveBeenCalled()
    })
  })

  it('lists items and selects on click', () => {
    storeState.items = [
      {
        id: 'wi_1',
        title: 'Ship PR4',
        status: 'todo',
        priority: 'high',
        listId: INBOX_LIST_ID,
        tags: [],
        notes: '',
        dueOn: '2026-07-26',
        createdAt: 1,
        updatedAt: 1,
        completedAt: null,
        archivedAt: null,
        links: {},
      },
    ]
    render(<WorkItemsPage />)
    expect(screen.queryByTestId('work-item-empty-catalog')).not.toBeInTheDocument()
    expect(screen.getByTestId('work-item-row-wi_1')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('work-item-row-wi_1'))
    expect(select).toHaveBeenCalledWith('wi_1')
  })

  it('toggles complete from row checkbox', () => {
    storeState.items = [
      {
        id: 'wi_2',
        title: 'Done me',
        status: 'todo',
        priority: 'none',
        listId: INBOX_LIST_ID,
        tags: [],
        notes: '',
        dueOn: null,
        createdAt: 1,
        updatedAt: 1,
        completedAt: null,
        archivedAt: null,
        links: {},
      },
    ]
    render(<WorkItemsPage />)
    fireEvent.click(screen.getByTestId('work-item-complete-wi_2'))
    expect(complete).toHaveBeenCalledWith('wi_2')
  })
})
