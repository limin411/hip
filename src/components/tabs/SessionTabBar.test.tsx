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

vi.mock('@/domain', () => ({
  useSessions: () => [
    { id: 's1', title: 'Chat A', config: { surface: 'chat' } },
    { id: 's2', title: 'Code B', config: { surface: 'code' } },
  ],
  useActiveSessionId: () => 's1',
  sessionService: {
    selectSession: vi.fn(),
    closeSession: vi.fn(),
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
})
