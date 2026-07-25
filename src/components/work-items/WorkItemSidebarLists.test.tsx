// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@/i18n'
import { INBOX_LIST_ID, type WorkItemList } from '@/domain/work-items'
import {
  orderListsForSidebar,
  WORK_ITEM_SMART_FILTERS,
  WorkItemSidebarLists,
} from './WorkItemSidebarLists'

const setFilter = vi.fn()
const createList = vi.fn(async (_name: string) => 'wl_new')
const renameList = vi.fn(async () => {})
const deleteList = vi.fn(async () => {})

const listsFixture: WorkItemList[] = [
  {
    id: 'wl_z',
    name: 'Zebra',
    sortOrder: 2,
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: INBOX_LIST_ID,
    name: 'Inbox',
    sortOrder: 0,
    createdAt: 1,
    updatedAt: 1,
    system: 'inbox',
  },
  {
    id: 'wl_a',
    name: 'Alpha',
    sortOrder: 1,
    createdAt: 1,
    updatedAt: 1,
  },
]

let filterId = 'open'
let lists = listsFixture

vi.mock('@/store/workItemStore', () => {
  const useWorkItemStore = (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      filterId,
      lists,
      setFilter,
      createList,
      renameList,
      deleteList,
    })
  useWorkItemStore.getState = () => ({
    filterId,
    lists,
    setFilter,
    createList,
    renameList,
    deleteList,
  })
  return { useWorkItemStore }
})

describe('orderListsForSidebar', () => {
  it('puts Inbox first then user lists by sortOrder', () => {
    const ordered = orderListsForSidebar(listsFixture)
    expect(ordered.map((l) => l.id)).toEqual([INBOX_LIST_ID, 'wl_a', 'wl_z'])
  })
})

describe('WorkItemSidebarLists', () => {
  beforeEach(() => {
    setFilter.mockClear()
    createList.mockClear()
    renameList.mockClear()
    deleteList.mockClear()
    filterId = 'open'
    lists = listsFixture
  })

  afterEach(() => {
    cleanup()
  })

  it('renders smart filters in design order with active rail on open', () => {
    render(<WorkItemSidebarLists />)
    const filterRows = screen.getAllByTestId(/^sidebar-work-item-filter-/)
    expect(filterRows.map((el) => el.getAttribute('data-testid'))).toEqual(
      WORK_ITEM_SMART_FILTERS.map((id) => `sidebar-work-item-filter-${id}`),
    )
    expect(screen.getByTestId('sidebar-work-item-filter-open')).toHaveClass('before:bg-accent')
    expect(screen.getByTestId('sidebar-work-item-filter-open')).toHaveAttribute(
      'aria-current',
      'true',
    )
  })

  it('clicking a filter sets filterId', () => {
    render(<WorkItemSidebarLists />)
    fireEvent.click(screen.getByTestId('sidebar-work-item-filter-cancelled'))
    expect(setFilter).toHaveBeenCalledWith('cancelled')
  })

  it('lists Inbox first with i18n label and user lists after', () => {
    render(<WorkItemSidebarLists />)
    const listRows = screen.getAllByTestId(/^sidebar-work-item-list-/)
    expect(listRows.map((el) => el.getAttribute('data-testid'))).toEqual([
      `sidebar-work-item-list-${INBOX_LIST_ID}`,
      'sidebar-work-item-list-wl_a',
      'sidebar-work-item-list-wl_z',
    ])
    expect(screen.getByTestId(`sidebar-work-item-list-${INBOX_LIST_ID}`)).toHaveTextContent(
      'Inbox',
    )
  })

  it('clicking a list sets list: filter', () => {
    render(<WorkItemSidebarLists />)
    fireEvent.click(screen.getByTestId('sidebar-work-item-list-wl_a'))
    expect(setFilter).toHaveBeenCalledWith('list:wl_a')
  })

  it('new list button prompts and creates', async () => {
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('  My List  ')
    render(<WorkItemSidebarLists />)
    fireEvent.click(screen.getByTestId('sidebar-new-work-item-list'))
    expect(prompt).toHaveBeenCalled()
    expect(createList).toHaveBeenCalledWith('My List')
    // createList resolves → setFilter list:id
    await vi.waitFor(() => {
      expect(setFilter).toHaveBeenCalledWith('list:wl_new')
    })
    prompt.mockRestore()
  })

  it('double-click renames non-inbox list', () => {
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('Renamed')
    render(<WorkItemSidebarLists />)
    fireEvent.doubleClick(screen.getByTestId('sidebar-work-item-list-wl_a'))
    expect(renameList).toHaveBeenCalledWith('wl_a', 'Renamed')
    prompt.mockRestore()
  })

  it('context menu confirms delete on non-inbox list', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<WorkItemSidebarLists />)
    fireEvent.contextMenu(screen.getByTestId('sidebar-work-item-list-wl_a'))
    expect(confirm).toHaveBeenCalled()
    expect(deleteList).toHaveBeenCalledWith('wl_a')
    confirm.mockRestore()
  })

  it('does not delete Inbox on context menu', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<WorkItemSidebarLists />)
    fireEvent.contextMenu(screen.getByTestId(`sidebar-work-item-list-${INBOX_LIST_ID}`))
    expect(confirm).not.toHaveBeenCalled()
    expect(deleteList).not.toHaveBeenCalled()
    confirm.mockRestore()
  })
})
