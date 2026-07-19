// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SidebarAccountFooter } from './SidebarAccountFooter'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

afterEach(() => cleanup())

const noop = () => {}

describe('SidebarAccountFooter', () => {
  it('renders trash above history above settings', () => {
    render(
      <SidebarAccountFooter
        onOpenTrash={noop}
        onOpenHistory={noop}
        onOpenSettings={noop}
      />,
    )
    const trash = screen.getByTestId('account-trash-button')
    const history = screen.getByTestId('account-history-button')
    const settings = screen.getByTestId('account-settings-button')
    expect(trash.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(history.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('nav.trash')).toBeInTheDocument()
    expect(screen.getByText('nav.history')).toBeInTheDocument()
    expect(screen.getByText('nav.settings')).toBeInTheDocument()
  })

  it('calls onOpenTrash on click', () => {
    const onOpenTrash = vi.fn()
    render(
      <SidebarAccountFooter
        onOpenTrash={onOpenTrash}
        onOpenHistory={noop}
        onOpenSettings={noop}
      />,
    )
    fireEvent.click(screen.getByTestId('account-trash-button'))
    expect(onOpenTrash).toHaveBeenCalledTimes(1)
  })

  it('calls onOpenHistory on click', () => {
    const onOpenHistory = vi.fn()
    render(
      <SidebarAccountFooter
        onOpenTrash={noop}
        onOpenHistory={onOpenHistory}
        onOpenSettings={noop}
      />,
    )
    fireEvent.click(screen.getByTestId('account-history-button'))
    expect(onOpenHistory).toHaveBeenCalledTimes(1)
  })

  it('calls onOpenSettings on click', () => {
    const onOpenSettings = vi.fn()
    render(
      <SidebarAccountFooter
        onOpenTrash={noop}
        onOpenHistory={noop}
        onOpenSettings={onOpenSettings}
      />,
    )
    fireEvent.click(screen.getByTestId('account-settings-button'))
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
  })

  it('marks active destination', () => {
    const { rerender } = render(
      <SidebarAccountFooter
        onOpenTrash={noop}
        onOpenHistory={noop}
        onOpenSettings={noop}
        active="trash"
      />,
    )
    expect(screen.getByTestId('account-trash-button')).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTestId('account-history-button')).not.toHaveAttribute('aria-current')

    rerender(
      <SidebarAccountFooter
        onOpenTrash={noop}
        onOpenHistory={noop}
        onOpenSettings={noop}
        active="history"
      />,
    )
    expect(screen.getByTestId('account-history-button')).toHaveAttribute('aria-current', 'page')

    rerender(
      <SidebarAccountFooter
        onOpenTrash={noop}
        onOpenHistory={noop}
        onOpenSettings={noop}
        active="settings"
      />,
    )
    expect(screen.getByTestId('account-settings-button')).toHaveAttribute('aria-current', 'page')
  })

  it('active footer uses sage rail without hairline ring', () => {
    render(
      <SidebarAccountFooter
        onOpenTrash={noop}
        onOpenHistory={noop}
        onOpenSettings={noop}
        active="settings"
      />,
    )
    const settings = screen.getByTestId('account-settings-button')
    expect(settings).toHaveClass('before:bg-accent')
    expect(settings).toHaveClass('bg-surface')
    expect(settings.className).not.toMatch(/shadow-\[0_0_0_1px/)
    expect(settings).not.toHaveClass('bg-state-active')

    const history = screen.getByTestId('account-history-button')
    expect(history).not.toHaveClass('before:bg-accent')
    expect(history).toHaveClass('hover:bg-state-hover')
  })
})
