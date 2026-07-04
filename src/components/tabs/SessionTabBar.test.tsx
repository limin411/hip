// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SessionTabBar } from './SessionTabBar'
import { useUiStore } from '@/store/uiStore'
import { sessionService } from '@/domain'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@radix-ui/react-dropdown-menu', () => ({
  Root: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Trigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Portal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Content: ({ children }: { children: React.ReactNode }) => <div data-testid="dropdown-content">{children}</div>,
  Item: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
  Separator: () => <hr />,
  Group: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Label: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/domain', () => ({
  useSessions: () => [
    { id: 's1', title: 'Chat A', config: { surface: 'chat' } },
    { id: 's2', title: 'Code B', config: { surface: 'code' } },
  ],
  useActiveSessionId: () => 's1',
  sessionService: {
    selectSession: vi.fn(),
    closeSession: vi.fn(),
    newConversation: vi.fn(),
  },
}))

describe('SessionTabBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useUiStore.setState({ openSessionIds: ['s1', 's2'] })
  })

  afterEach(() => {
    cleanup()
    useUiStore.setState({ openSessionIds: [] })
  })

  it('renders one tab per open session', () => {
    render(<SessionTabBar onNewSession={() => {}} />)
    expect(screen.getByText('Chat A')).toBeInTheDocument()
    expect(screen.getByText('Code B')).toBeInTheDocument()
  })

  it('calls selectSession when a tab is clicked', () => {
    render(<SessionTabBar onNewSession={() => {}} />)
    fireEvent.click(screen.getByText('Code B', { selector: 'span' }))
    expect(sessionService.selectSession).toHaveBeenCalledWith('s2')
  })

  it('calls closeSession when a tab close button is clicked', () => {
    render(<SessionTabBar onNewSession={() => {}} />)
    fireEvent.click(screen.getAllByRole('button', { name: /close/i }).at(-1)!)
    expect(sessionService.closeSession).toHaveBeenCalledWith('s2')
  })

  it('renders chat and code dropdown options', () => {
    render(<SessionTabBar onNewSession={() => {}} />)
    expect(screen.getByText('dropdown.newChat')).toBeInTheDocument()
    expect(screen.getByText('dropdown.newCode')).toBeInTheDocument()
  })

  it('calls newConversation with "chat" when new chat is clicked', () => {
    render(<SessionTabBar onNewSession={() => {}} />)
    fireEvent.click(screen.getByText('dropdown.newChat'))
    expect(sessionService.newConversation).toHaveBeenCalledWith('chat')
  })

  it('calls newConversation with "code" when new code is clicked', () => {
    render(<SessionTabBar onNewSession={() => {}} />)
    fireEvent.click(screen.getByText('dropdown.newCode'))
    expect(sessionService.newConversation).toHaveBeenCalledWith('code')
  })
})
