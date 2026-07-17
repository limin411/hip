// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SidebarAccountFooter } from './SidebarAccountFooter'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

afterEach(() => cleanup())

describe('SidebarAccountFooter', () => {
  it('renders history above settings', () => {
    render(
      <SidebarAccountFooter onOpenHistory={vi.fn()} onOpenSettings={vi.fn()} />,
    )
    const history = screen.getByTestId('account-history-button')
    const settings = screen.getByTestId('account-settings-button')
    expect(history.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('nav.history')).toBeInTheDocument()
    expect(screen.getByText('nav.settings')).toBeInTheDocument()
  })

  it('calls onOpenHistory on click', () => {
    const onOpenHistory = vi.fn()
    render(
      <SidebarAccountFooter onOpenHistory={onOpenHistory} onOpenSettings={vi.fn()} />,
    )
    fireEvent.click(screen.getByTestId('account-history-button'))
    expect(onOpenHistory).toHaveBeenCalledTimes(1)
  })

  it('calls onOpenSettings on click', () => {
    const onOpenSettings = vi.fn()
    render(
      <SidebarAccountFooter onOpenHistory={vi.fn()} onOpenSettings={onOpenSettings} />,
    )
    fireEvent.click(screen.getByTestId('account-settings-button'))
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
  })

  it('marks active destination', () => {
    const { rerender } = render(
      <SidebarAccountFooter onOpenHistory={vi.fn()} onOpenSettings={vi.fn()} active="history" />,
    )
    expect(screen.getByTestId('account-history-button')).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTestId('account-settings-button')).not.toHaveAttribute('aria-current')

    rerender(
      <SidebarAccountFooter onOpenHistory={vi.fn()} onOpenSettings={vi.fn()} active="settings" />,
    )
    expect(screen.getByTestId('account-settings-button')).toHaveAttribute('aria-current', 'page')
  })
})
