// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { RenameSessionDialog } from './RenameSessionDialog'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

describe('RenameSessionDialog', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('confirms trimmed non-empty title', () => {
    const onConfirm = vi.fn()
    render(<RenameSessionDialog title="Old" onConfirm={onConfirm} onCancel={vi.fn()} />)
    const input = screen.getByTestId('rename-session-input')
    fireEvent.change(input, { target: { value: '  New Title  ' } })
    fireEvent.click(screen.getByTestId('rename-session-confirm'))
    expect(onConfirm).toHaveBeenCalledWith('New Title')
  })

  it('disables save when title is empty/whitespace', () => {
    const onConfirm = vi.fn()
    render(<RenameSessionDialog title="Old" onConfirm={onConfirm} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByTestId('rename-session-input'), { target: { value: '   ' } })
    expect(screen.getByTestId('rename-session-confirm')).toBeDisabled()
    fireEvent.click(screen.getByTestId('rename-session-confirm'))
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('cancel does not confirm', () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    render(<RenameSessionDialog title="Old" onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.click(screen.getByText('common.cancel'))
    expect(onCancel).toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
