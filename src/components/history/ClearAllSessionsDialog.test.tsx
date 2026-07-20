// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ClearAllSessionsDialog } from './ClearAllSessionsDialog'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (params) return `${key}:${JSON.stringify(params)}`
      return key
    },
  }),
}))

describe('ClearAllSessionsDialog', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders title and body with count/scope', () => {
    render(
      <ClearAllSessionsDialog count={3} scope="code" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    )
    expect(screen.getByText('history.clearAllConfirmTitle')).toBeInTheDocument()
    // Body interpolates count, scope label, and trash retention days.
    expect(
      screen.getByText(
        /^history\.clearAllConfirmBody:\{"count":3,"scope":"history\.clearAllScope\.code","days":\d+\}$/,
      ),
    ).toBeInTheDocument()
  })

  it('calls onConfirm when clear button is clicked', () => {
    const onConfirm = vi.fn()
    render(
      <ClearAllSessionsDialog count={1} scope="all" onConfirm={onConfirm} onCancel={vi.fn()} />,
    )
    fireEvent.click(screen.getByText('history.clearAllConfirmAction'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('calls onCancel when cancel button is clicked', () => {
    const onCancel = vi.fn()
    render(
      <ClearAllSessionsDialog count={1} scope="chat" onConfirm={vi.fn()} onCancel={onCancel} />,
    )
    fireEvent.click(screen.getByText('common.cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
