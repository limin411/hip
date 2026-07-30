// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LegacyBoardReplaceConfirmHost } from './LegacyBoardReplaceConfirmHost'
import {
  getLegacyBoardReplaceDialog,
  requestLegacyBoardReplaceConfirm,
  resetLegacyBoardReplaceDialogStore,
} from './legacyBoardReplaceDialogStore'

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

beforeEach(() => {
  resetLegacyBoardReplaceDialogStore()
})

afterEach(() => {
  resetLegacyBoardReplaceDialogStore()
  cleanup()
})

describe('LegacyBoardReplaceConfirmHost', () => {
  it('renders nothing when dialog is closed', () => {
    render(<LegacyBoardReplaceConfirmHost />)
    expect(screen.queryByTestId('mock-modal')).not.toBeInTheDocument()
  })

  it('confirm resolves true and closes', async () => {
    render(<LegacyBoardReplaceConfirmHost />)
    let result: boolean | undefined
    await act(async () => {
      void requestLegacyBoardReplaceConfirm('brd_1').then((ok) => {
        result = ok
      })
    })
    expect(screen.getByTestId('legacy-board-replace-confirm')).toBeInTheDocument()
    expect(getLegacyBoardReplaceDialog()?.boardId).toBe('brd_1')

    await act(async () => {
      fireEvent.click(screen.getByTestId('legacy-board-replace-confirm'))
    })
    expect(result).toBe(true)
    expect(getLegacyBoardReplaceDialog()).toBeNull()
  })

  it('cancel resolves false', async () => {
    render(<LegacyBoardReplaceConfirmHost />)
    let result: boolean | undefined
    await act(async () => {
      void requestLegacyBoardReplaceConfirm('brd_2').then((ok) => {
        result = ok
      })
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('legacy-board-replace-cancel'))
    })
    expect(result).toBe(false)
    expect(getLegacyBoardReplaceDialog()).toBeNull()
  })

  it('Enter confirms', async () => {
    render(<LegacyBoardReplaceConfirmHost />)
    let result: boolean | undefined
    await act(async () => {
      void requestLegacyBoardReplaceConfirm('brd_3').then((ok) => {
        result = ok
      })
    })

    await act(async () => {
      fireEvent.keyDown(window, { key: 'Enter' })
    })
    expect(result).toBe(true)
    expect(getLegacyBoardReplaceDialog()).toBeNull()
  })
})
