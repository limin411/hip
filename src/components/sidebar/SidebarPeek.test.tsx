// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SidebarPeek } from './SidebarPeek'

vi.mock('@/store/uiStore', () => ({
  useUiStore: (selector: (s: { collapsed: boolean; activeView: string }) => unknown) =>
    selector({ collapsed: true, activeView: 'chat' }),
}))

vi.mock('@/domain', () => ({
  sessionService: {
    setSurface: vi.fn(),
  },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('./Sidebar', () => ({
  Sidebar: () => <div data-testid="sidebar-mock" />,
}))

describe('SidebarPeek glass styling', () => {
  it('renders the peek panel with glass background, right border, and blur', () => {
    render(<SidebarPeek />)
    const peek = screen.getByTestId('sidebar-peek')
    expect(peek).toHaveClass('bg-[var(--glass-bg)]')
    expect(peek).toHaveClass('border-r')
    expect(peek).toHaveClass('border-[var(--glass-border)]')
    expect(peek).toHaveClass('backdrop-blur-xl')
  })
})
