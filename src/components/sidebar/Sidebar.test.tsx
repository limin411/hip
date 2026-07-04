// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { Sidebar } from './Sidebar'

afterEach(cleanup)

vi.mock('@/components/sessions/SessionsDialog', () => ({
  SessionsDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="sessions-dialog">sidebar.allSessions</div> : null,
}))

vi.mock('@/store/uiStore', () => ({
  useUiStore: (selector: (s: { activeView: string }) => string) => selector({ activeView: 'chat' }),
}))

vi.mock('@/domain', () => ({
  sessionService: {
    setSurface: vi.fn(),
  },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('./SurfaceTabs', () => ({
  SurfaceTabs: () => <div data-testid="surface-tabs" />,
}))

vi.mock('./NewSessionButton', () => ({
  NewSessionButton: () => <div data-testid="new-session-button" />,
}))

vi.mock('./SessionSearch', () => ({
  SessionSearch: () => <div data-testid="session-search" />,
}))

vi.mock('./SessionList', () => ({
  SessionList: () => <div data-testid="session-list" />,
}))

vi.mock('./AccountFooter', () => ({
  AccountFooter: () => <div data-testid="account-footer" />,
}))

describe('Sidebar glass styling', () => {
  it('renders the sidebar root with glass background, right border, and blur', () => {
    render(<Sidebar />)
    const root = screen.getByTestId('sidebar-root')
    expect(root).toHaveClass('bg-[var(--glass-bg)]')
    expect(root).toHaveClass('border-r')
    expect(root).toHaveClass('border-[var(--glass-border)]')
    expect(root).toHaveClass('backdrop-blur-xl')
  })
})

describe('Sidebar session manager entry', () => {
  it('opens the sessions dialog when "查看全部会话" is clicked', () => {
    render(<Sidebar />)
    fireEvent.click(screen.getByText('sidebar.viewAllSessions'))
    expect(screen.getByTestId('sessions-dialog')).toBeInTheDocument()
  })
})
