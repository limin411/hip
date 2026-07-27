// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { WorkItemDeleteConfirmHost } from './WorkItemDeleteConfirmHost'
import {
  openWorkItemDeleteDialog,
  resetWorkItemDeleteDialogStore,
  getWorkItemDeleteDialog,
} from './workItemDeleteDialogStore'

const deleteItem = vi.fn().mockResolvedValue(undefined)
const closeModal = vi.fn()

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

vi.mock('@/store/workItemStore', () => {
  const useWorkItemStore = (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ deleteItem })
  useWorkItemStore.getState = () => ({ deleteItem })
  return { useWorkItemStore }
})

vi.mock('@/store/workItemViewStore', () => {
  const useWorkItemViewStore = Object.assign(
    (sel: (s: Record<string, unknown>) => unknown) =>
      sel({
        modal: { mode: 'closed' as const },
        closeModal,
      }),
    {
      getState: () => ({
        modal: { mode: 'closed' as const },
        closeModal,
      }),
    },
  )
  return { useWorkItemViewStore }
})

beforeEach(() => {
  resetWorkItemDeleteDialogStore()
  deleteItem.mockClear()
  closeModal.mockClear()
})

afterEach(() => {
  cleanup()
  resetWorkItemDeleteDialogStore()
})

describe('WorkItemDeleteConfirmHost', () => {
  it('renders nothing when dialog is closed', () => {
    render(<WorkItemDeleteConfirmHost />)
    expect(screen.queryByTestId('mock-modal')).not.toBeInTheDocument()
  })

  it('Enter confirms soft-delete (same as danger button)', async () => {
    render(<WorkItemDeleteConfirmHost />)
    act(() => {
      openWorkItemDeleteDialog('wi_1', 'Ship menus')
    })
    expect(screen.getByTestId('work-item-delete-confirm')).toBeInTheDocument()

    await act(async () => {
      fireEvent.keyDown(window, { key: 'Enter' })
    })

    expect(deleteItem).toHaveBeenCalledWith('wi_1')
    expect(getWorkItemDeleteDialog()).toBeNull()
  })

  it('ignores Enter while busy (no double delete)', async () => {
    let resolveDelete!: () => void
    deleteItem.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = resolve
        }),
    )

    render(<WorkItemDeleteConfirmHost />)
    act(() => {
      openWorkItemDeleteDialog('wi_2', 'Busy item')
    })

    await act(async () => {
      fireEvent.keyDown(window, { key: 'Enter' })
    })
    expect(deleteItem).toHaveBeenCalledTimes(1)

    await act(async () => {
      fireEvent.keyDown(window, { key: 'Enter' })
    })
    expect(deleteItem).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveDelete()
    })
  })

  it('danger button click still confirms', async () => {
    render(<WorkItemDeleteConfirmHost />)
    act(() => {
      openWorkItemDeleteDialog('wi_3', 'Click me')
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId('work-item-delete-confirm'))
    })
    expect(deleteItem).toHaveBeenCalledWith('wi_3')
    expect(getWorkItemDeleteDialog()).toBeNull()
  })
})
