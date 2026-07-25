// @vitest-environment happy-dom
/**
 * Editing a past-dated item must accept date changes via the native DateField input.
 */
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { WorkItemEditorModal } from './WorkItemEditorModal'
import { INBOX_LIST_ID, type WorkItem } from '@/domain/work-items'

const closeModal = vi.fn()
const commitItemDraft = vi.fn().mockResolvedValue('wi_old')

const oldItem: WorkItem = {
  id: 'wi_old',
  title: 'Old item',
  status: 'todo',
  priority: 'none',
  listId: INBOX_LIST_ID,
  tags: [],
  notes: '',
  startOn: '2020-03-10',
  endOn: '2020-03-12',
  createdAt: 1,
  updatedAt: 1,
  completedAt: null,
  archivedAt: null,
  links: {},
}

/** Stable reference — new object each selector call would re-fire draft sync forever. */
const modalSession = { mode: 'edit' as const, itemId: 'wi_old' }

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
      items: [oldItem],
      commitItemDraft,
      archive: vi.fn(),
      unarchive: vi.fn(),
      deleteItem: vi.fn(),
    })
  return { useWorkItemStore }
})

afterEach(() => {
  cleanup()
  closeModal.mockClear()
  commitItemDraft.mockClear()
})

describe('WorkItemEditorModal date pick (old item)', () => {
  it('updates start via native date input (past item)', () => {
    render(<WorkItemEditorModal />)
    expect(screen.getByTestId('work-item-editor-body')).toBeInTheDocument()

    const start = screen.getByTestId('work-item-start-input') as HTMLInputElement
    expect(start.value).toBe('2020-03-10')
    fireEvent.change(start, { target: { value: '2020-03-15' } })
    expect((screen.getByTestId('work-item-start-input') as HTMLInputElement).value).toBe(
      '2020-03-15',
    )
    // end auto-clamped
    expect((screen.getByTestId('work-item-end-input') as HTMLInputElement).value).toBe(
      '2020-03-15',
    )
  })

  it('can jump start to today for a past-dated item', () => {
    render(<WorkItemEditorModal />)
    const start = screen.getByTestId('work-item-start-input') as HTMLInputElement
    const today = new Date()
    const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    fireEvent.change(start, { target: { value: ymd } })
    expect((screen.getByTestId('work-item-start-input') as HTMLInputElement).value).toBe(ymd)
  })
})
