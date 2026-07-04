// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { FloatingAvatarButton } from './FloatingAvatarButton'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

afterEach(() => {
  cleanup()
})

describe('FloatingAvatarButton', () => {
  beforeEach(() => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  it('opens menu on click and shows settings and logout items', () => {
    render(<FloatingAvatarButton onOpenSettings={vi.fn()} onOpenHistory={vi.fn()} onLogout={vi.fn()} />)
    fireEvent.click(screen.getByText('US'))
    expect(screen.getByText('nav.settings')).toBeInTheDocument()
    expect(screen.getByText('common.logout')).toBeInTheDocument()
  })

  it('shows history menu item that calls onOpenHistory', () => {
    const onOpenHistory = vi.fn()
    render(<FloatingAvatarButton onOpenHistory={onOpenHistory} onOpenSettings={() => {}} onLogout={() => {}} />)
    fireEvent.click(screen.getByTestId('account-menu-button'))
    fireEvent.click(screen.getByTestId('account-history-menu-item'))
    expect(onOpenHistory).toHaveBeenCalled()
  })

  it('calls onOpenSettings and closes the menu when settings is clicked', () => {
    const onOpenSettings = vi.fn()
    render(<FloatingAvatarButton onOpenSettings={onOpenSettings} onOpenHistory={vi.fn()} onLogout={vi.fn()} />)
    fireEvent.click(screen.getByText('US'))
    fireEvent.click(screen.getByText('nav.settings'))
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('nav.settings')).not.toBeInTheDocument()
  })

  it('calls onLogout and closes the menu when logout is confirmed', () => {
    const onLogout = vi.fn()
    render(<FloatingAvatarButton onOpenSettings={vi.fn()} onOpenHistory={vi.fn()} onLogout={onLogout} />)
    fireEvent.click(screen.getByText('US'))
    fireEvent.click(screen.getByText('common.logout'))
    expect(window.confirm).toHaveBeenCalled()
    expect(onLogout).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('common.logout')).not.toBeInTheDocument()
  })

  it('does not call onLogout when logout is cancelled', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const onLogout = vi.fn()
    render(<FloatingAvatarButton onOpenSettings={vi.fn()} onOpenHistory={vi.fn()} onLogout={onLogout} />)
    fireEvent.click(screen.getByText('US'))
    fireEvent.click(screen.getByText('common.logout'))
    expect(window.confirm).toHaveBeenCalled()
    expect(onLogout).not.toHaveBeenCalled()
  })
})
