// @vitest-environment happy-dom
/**
 * Opening soft-delete confirm from the editor must hide the editor Modal
 * (no stacked Radix overlays / double-dialog).
 */
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { WorkItemEditorModal } from './WorkItemEditorModal'
import {
  closeWorkItemDeleteDialog,
  getWorkItemDeleteDialog,
  resetWorkItemDeleteDialogStore,
} from './workItemDeleteDialogStore'
import { INBOX_LIST_ID, type WorkItem } from '@/domain/work-items'

const closeModal = vi.fn()

const item: WorkItem = {
  id: 'wi_1',
  title: 'Ship menus',
  status: 'todo',
  priority: 'none',
  listId: INBOX_LIST_ID,
  tags: [],
  notes: '',
  startOn: '2026-07-01',
  endOn: '2026-07-01',
  createdAt: 1,
  updatedAt: 1,
  completedAt: null,
  archivedAt: null,
  links: {},
}

const modalSession = { mode: 'edit' as const, itemId: 'wi_1' }

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}))

vi.mock('@/components/ui/Modal', () => ({
  Modal: ({
    children,
    open,
    footer,
  }: {
    children: React.ReactNode
    open: boolean
    footer?: React.ReactNode
  }) =>
    open ? (
      <div data-testid="mock-modal">
        {children}
        {footer}
      </div>
    ) : null,
}))

vi.mock('@/store/workItemViewStore', () => {
  const useWorkItemViewStore = (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      modal: modalSession,
      closeModal,
    })
  return { useWorkItemViewStore }
})

vi.mock('@/store/workItemStore', () => {
  const useWorkItemStore = (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      items: [item],
      commitItemDraft: vi.fn(),
      archive: vi.fn(),
      unarchive: vi.fn(),
      deleteItem: vi.fn(),
    })
  return { useWorkItemStore }
})

beforeEach(() => {
  resetWorkItemDeleteDialogStore()
  closeModal.mockClear()
})

afterEach(() => {
  cleanup()
  resetWorkItemDeleteDialogStore()
})

describe('WorkItemEditorModal delete stacking', () => {
  it('hides editor when delete confirm opens; restores on cancel', () => {
    render(<WorkItemEditorModal />)
    expect(screen.getByTestId('mock-modal')).toBeInTheDocument()
    expect(screen.getByTestId('work-item-delete')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('work-item-delete'))
    expect(getWorkItemDeleteDialog()).toEqual({ itemId: 'wi_1', title: 'Ship menus' })
    // Editor Modal open=false while sibling confirm is active
    expect(screen.queryByTestId('mock-modal')).not.toBeInTheDocument()
    expect(closeModal).not.toHaveBeenCalled()

    act(() => {
      closeWorkItemDeleteDialog()
    })
    expect(screen.getByTestId('mock-modal')).toBeInTheDocument()
    expect(closeModal).not.toHaveBeenCalled()
  })
})
