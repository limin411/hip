// @vitest-environment happy-dom
/**
 * Regression: editing a past-dated item must allow date changes and Today.
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
  it('can open start date popover and pick a day', async () => {
    render(<WorkItemEditorModal />)
    expect(screen.getByTestId('work-item-editor-body')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('work-item-start-input-trigger'))
    const day = await screen.findByTestId('date-field-day-2020-03-15')
    fireEvent.pointerDown(day, { button: 0 })

    const start = screen.getByTestId('work-item-start-input') as HTMLInputElement
    expect(start.value).toBe('2020-03-15')
    // end auto-clamped to keep start ≤ end
    const end = screen.getByTestId('work-item-end-input') as HTMLInputElement
    expect(end.value).toBe('2020-03-15')
  })

  it('today is clickable for a past-dated item', async () => {
    render(<WorkItemEditorModal />)
    fireEvent.click(screen.getByTestId('work-item-start-input-trigger'))
    const todayBtn = await screen.findByTestId('date-field-today')
    expect(todayBtn).not.toBeDisabled()
    fireEvent.pointerDown(todayBtn, { button: 0 })
    const start = screen.getByTestId('work-item-start-input') as HTMLInputElement
    expect(start.value).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(start.value).not.toBe('2020-03-10')
  })
})
