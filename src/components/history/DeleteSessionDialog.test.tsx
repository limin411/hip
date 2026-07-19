// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { DeleteSessionDialog } from './DeleteSessionDialog'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (params) return `${key}:${JSON.stringify(params)}`
      return key
    },
  }),
}))

describe('DeleteSessionDialog', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })
  it('renders title and body', () => {
    render(<DeleteSessionDialog title="Session A" onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByText('history.deleteSessionConfirmTitle:{"title":"Session A"}')).toBeInTheDocument()
    expect(
      screen.getByText('history.deleteSessionConfirmBody:{"title":"Session A","days":7}'),
    ).toBeInTheDocument()
  })

  it('calls onConfirm when delete button is clicked', () => {
    const onConfirm = vi.fn()
    render(<DeleteSessionDialog title="Session A" onConfirm={onConfirm} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByText('history.delete'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledWith(undefined)
  })

  it('passes deleteDerivedMemories when checkbox is checked', () => {
    const onConfirm = vi.fn()
    render(<DeleteSessionDialog title="Session A" onConfirm={onConfirm} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByTestId('delete-derived-memories'))
    fireEvent.click(screen.getByText('history.delete'))
    expect(onConfirm).toHaveBeenCalledWith({ deleteDerivedMemories: true })
  })

  it('calls onCancel when cancel button is clicked', () => {
    const onCancel = vi.fn()
    render(<DeleteSessionDialog title="Session A" onConfirm={vi.fn()} onCancel={onCancel} />)
    fireEvent.click(screen.getByText('common.cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
