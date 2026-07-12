// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ConfirmDeleteSessionsDialog } from './ConfirmDeleteSessionsDialog'
import { SessionMenuDialogHost } from './SessionMenuDialogHost'
import {
  openConfirmDeleteSessionsDialog,
  resetSessionMenuDialogStore,
} from './sessionMenuDialogStore'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (params) return `${key}:${JSON.stringify(params)}`
      return key
    },
  }),
}))

const closeSession = vi.fn()

vi.mock('@/domain', () => ({
  sessionService: {
    closeSession: (...args: unknown[]) => closeSession(...args),
    renameSession: vi.fn(),
    deleteSession: vi.fn(),
  },
}))

describe('ConfirmDeleteSessionsDialog', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    resetSessionMenuDialogStore()
  })

  it('renders permanent-delete copy with count', () => {
    render(<ConfirmDeleteSessionsDialog count={3} onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(
      screen.getByText('contextMenu.confirmDeleteSessions.title:{"count":3}'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('contextMenu.confirmDeleteSessions.body:{"count":3}'),
    ).toBeInTheDocument()
  })

  it('calls onConfirm only when delete is accepted', () => {
    const onConfirm = vi.fn()
    render(<ConfirmDeleteSessionsDialog count={2} onConfirm={onConfirm} onCancel={vi.fn()} />)
    expect(onConfirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('confirm-delete-sessions'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('calls onCancel without deleting', () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    render(<ConfirmDeleteSessionsDialog count={2} onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.click(screen.getByText('common.cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})

describe('SessionMenuDialogHost bulk delete', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    resetSessionMenuDialogStore()
  })

  it('does not run closeSession until confirm is accepted', () => {
    openConfirmDeleteSessionsDialog(['a', 'b'])
    render(<SessionMenuDialogHost />)
    expect(closeSession).not.toHaveBeenCalled()
    expect(screen.getByTestId('confirm-delete-sessions')).toBeInTheDocument()

    fireEvent.click(screen.getByText('common.cancel'))
    expect(closeSession).not.toHaveBeenCalled()
  })

  it('closeSession each id after accept', () => {
    openConfirmDeleteSessionsDialog(['a', 'b'])
    render(<SessionMenuDialogHost />)
    fireEvent.click(screen.getByTestId('confirm-delete-sessions'))
    expect(closeSession).toHaveBeenCalledTimes(2)
    expect(closeSession).toHaveBeenNthCalledWith(1, 'a')
    expect(closeSession).toHaveBeenNthCalledWith(2, 'b')
  })
})
