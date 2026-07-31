// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@/i18n'
import {
  WORK_ITEM_SMART_FILTERS,
  WorkItemSidebarLists,
} from './WorkItemSidebarLists'

const setFilter = vi.fn()

let filterId = 'todo'

vi.mock('@/store/workItemStore', () => {
  const useWorkItemStore = (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      filterId,
      setFilter,
    })
  useWorkItemStore.getState = () => ({
    filterId,
    setFilter,
  })
  return { useWorkItemStore }
})

vi.mock('@/store/workItemUiPrefsStore', () => {
  const useWorkItemUiPrefsStore = (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      loaded: true,
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

describe('WorkItemSidebarLists', () => {
  beforeEach(() => {
    setFilter.mockClear()
    filterId = 'todo'
  })

  afterEach(() => {
    cleanup()
  })

  it('renders five smart filters in design order with active rail on todo', () => {
    render(<WorkItemSidebarLists />)
    const filterRows = screen.getAllByTestId(/^sidebar-work-item-filter-/)
    expect(filterRows.map((el) => el.getAttribute('data-testid'))).toEqual(
      WORK_ITEM_SMART_FILTERS.map((id) => `sidebar-work-item-filter-${id}`),
    )
    expect([...WORK_ITEM_SMART_FILTERS]).toEqual([
      'all',
      'todo',
      'in_progress',
      'done',
      'archived',
    ])
    expect(screen.getByTestId('sidebar-work-item-filter-todo')).not.toHaveClass('before:bg-accent')
    expect(screen.getByTestId('sidebar-work-item-filter-todo')).toHaveClass('bg-state-active')
    expect(screen.getByTestId('sidebar-work-item-filter-todo')).toHaveAttribute(
      'aria-current',
      'true',
    )
  })

  it('clicking a filter sets filterId', () => {
    render(<WorkItemSidebarLists />)
    fireEvent.click(screen.getByTestId('sidebar-work-item-filter-done'))
    expect(setFilter).toHaveBeenCalledWith('done')
  })

  it('clicking all sets filterId to all', () => {
    render(<WorkItemSidebarLists />)
    fireEvent.click(screen.getByTestId('sidebar-work-item-filter-all'))
    expect(setFilter).toHaveBeenCalledWith('all')
  })

  it('does not render user lists UI', () => {
    render(<WorkItemSidebarLists />)
    expect(screen.queryByTestId('sidebar-work-item-lists')).not.toBeInTheDocument()
    expect(screen.queryByTestId('sidebar-new-work-item-list')).not.toBeInTheDocument()
    expect(screen.queryByTestId(/^sidebar-work-item-list-/)).not.toBeInTheDocument()
  })
})
