// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { DEFAULT_STATUS_COLORS } from '@/domain/work-items'

const setSearch = vi.fn()
const setFilter = vi.fn()
const setListPage = vi.fn()
const setHighlightId = vi.fn()
const requestCreate = vi.fn()
const requestEdit = vi.fn()
const complete = vi.fn()
const reopen = vi.fn()

let search = 'zzz-no-match'
let filterId = 'all'

vi.mock('@/store/workItemStore', () => {
  const useWorkItemStore = (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      search,
      filterId,
      setSearch,
      setFilter,
      complete,
      reopen,
    })
  useWorkItemStore.getState = () => ({
    search,
    filterId,
    setSearch,
    setFilter,
  })
  return { useWorkItemStore }
})

vi.mock('@/store/workItemViewStore', () => {
  const useWorkItemViewStore = (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      highlightId: null,
      listPage: 1,
      setListPage,
      setHighlightId,
      requestEdit,
      requestCreate,
    })
  return { useWorkItemViewStore }
})

vi.mock('@/store/workItemUiPrefsStore', () => {
  const useWorkItemUiPrefsStore = (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      statusColors: { ...DEFAULT_STATUS_COLORS },
    })
  return { useWorkItemUiPrefsStore }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/components/context-menu', () => ({
  DeclarativeContextMenu: ({ children }: { children: unknown }) => children,
}))

import { WorkItemListView } from './WorkItemListView'

describe('WorkItemListView empty search trap', () => {
  beforeEach(() => {
    search = 'zzz-no-match'
    filterId = 'all'
    setSearch.mockClear()
    setFilter.mockClear()
    requestCreate.mockClear()
  })
  afterEach(() => cleanup())

  it('keeps the search input when filtered results are empty', () => {
    render(<WorkItemListView items={[]} />)
    expect(screen.getByTestId('work-item-search')).toBeInTheDocument()
    expect(screen.getByTestId('work-item-search')).toHaveValue('zzz-no-match')
    expect(screen.getByTestId('work-item-search-clear')).toBeInTheDocument()
    expect(screen.getByText('workItems.emptyFilterTitle')).toBeInTheDocument()
  })

  it('clear search button resets the query so the user can leave the empty trap', () => {
    render(<WorkItemListView items={[]} />)
    fireEvent.click(screen.getByTestId('work-item-search-clear'))
    expect(setSearch).toHaveBeenCalledWith('')
  })

  it('status-filter empty offers show-all without hiding search', () => {
    search = ''
    filterId = 'done'
    render(<WorkItemListView items={[]} />)
    expect(screen.getByTestId('work-item-search')).toBeInTheDocument()
    // EmptyState primary action
    fireEvent.click(screen.getByRole('button', { name: 'workItems.showAll' }))
    expect(setFilter).toHaveBeenCalledWith('all')
  })
})
