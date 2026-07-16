// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SidebarAccountFooter } from './SidebarAccountFooter'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

afterEach(() => cleanup())

describe('SidebarAccountFooter', () => {
  beforeEach(() => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  it('opens menu and shows settings and logout', () => {
    render(
      <SidebarAccountFooter onOpenSettings={vi.fn()} onOpenHistory={vi.fn()} onLogout={vi.fn()} />,
    )
    fireEvent.click(screen.getByTestId('account-menu-button'))
    expect(screen.getByTestId('account-settings-menu-item')).toBeInTheDocument()
    expect(screen.getByTestId('account-logout-menu-item')).toBeInTheDocument()
  })

  it('history item calls onOpenHistory', () => {
    const onOpenHistory = vi.fn()
    render(
      <SidebarAccountFooter
        onOpenHistory={onOpenHistory}
        onOpenSettings={() => {}}
        onLogout={() => {}}
      />,
    )
    fireEvent.click(screen.getByTestId('account-menu-button'))
    fireEvent.click(screen.getByTestId('account-history-menu-item'))
    expect(onOpenHistory).toHaveBeenCalled()
  })

  it('settings closes menu', () => {
    const onOpenSettings = vi.fn()
    render(
      <SidebarAccountFooter
        onOpenSettings={onOpenSettings}
        onOpenHistory={vi.fn()}
        onLogout={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByTestId('account-menu-button'))
    fireEvent.click(screen.getByTestId('account-settings-menu-item'))
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('account-settings-menu-item')).not.toBeInTheDocument()
  })

  it('logout confirmed calls onLogout', () => {
    const onLogout = vi.fn()
    render(
      <SidebarAccountFooter onOpenSettings={vi.fn()} onOpenHistory={vi.fn()} onLogout={onLogout} />,
    )
    fireEvent.click(screen.getByTestId('account-menu-button'))
    fireEvent.click(screen.getByTestId('account-logout-menu-item'))
    expect(window.confirm).toHaveBeenCalled()
    expect(onLogout).toHaveBeenCalledTimes(1)
  })

  it('logout cancelled does not call onLogout', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const onLogout = vi.fn()
    render(
      <SidebarAccountFooter onOpenSettings={vi.fn()} onOpenHistory={vi.fn()} onLogout={onLogout} />,
    )
    fireEvent.click(screen.getByTestId('account-menu-button'))
    fireEvent.click(screen.getByTestId('account-logout-menu-item'))
    expect(onLogout).not.toHaveBeenCalled()
  })
})
