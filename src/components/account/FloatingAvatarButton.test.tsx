// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { FloatingAvatarButton } from './FloatingAvatarButton'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/store/uiStore', () => ({
  useUiStore: () => ({ activeView: 'chat' }),
}))

vi.mock('@/store/authStore', () => ({
  useAuthStore: () => ({ logout: vi.fn() }),
}))

afterEach(() => {
  cleanup()
})

describe('FloatingAvatarButton', () => {
  it('opens menu on click and shows settings and logout items', () => {
    render(<FloatingAvatarButton onOpenSettings={vi.fn()} onLogout={vi.fn()} />)
    fireEvent.click(screen.getByText('US'))
    expect(screen.getByText('nav.settings')).toBeInTheDocument()
    expect(screen.getByText('common.logout')).toBeInTheDocument()
  })

  it('calls onOpenSettings and closes the menu when settings is clicked', () => {
    const onOpenSettings = vi.fn()
    render(<FloatingAvatarButton onOpenSettings={onOpenSettings} onLogout={vi.fn()} />)
    fireEvent.click(screen.getByText('US'))
    fireEvent.click(screen.getByText('nav.settings'))
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('nav.settings')).not.toBeInTheDocument()
  })

  it('calls onLogout and closes the menu when logout is clicked', () => {
    const onLogout = vi.fn()
    render(<FloatingAvatarButton onOpenSettings={vi.fn()} onLogout={onLogout} />)
    fireEvent.click(screen.getByText('US'))
    fireEvent.click(screen.getByText('common.logout'))
    expect(onLogout).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('common.logout')).not.toBeInTheDocument()
  })
})
