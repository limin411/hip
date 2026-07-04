// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SessionHistory } from './SessionHistory'
import { sessionService } from '@/domain'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/domain', () => ({
  useSessions: () => [
    { id: 's1', title: 'Chat A', preview: 'Hello', updatedAtMs: 1000, config: { surface: 'chat' } },
    { id: 's2', title: 'Code B', preview: 'Refactor', updatedAtMs: 2000, config: { surface: 'code' } },
  ],
  sessionService: {
    selectSession: vi.fn(),
  },
}))

describe('SessionHistory', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders all sessions', () => {
    render(<SessionHistory />)
    expect(screen.getByText('Chat A')).toBeInTheDocument()
    expect(screen.getByText('Code B')).toBeInTheDocument()
  })

  it('filters sessions by search query', () => {
    render(<SessionHistory />)
    fireEvent.change(screen.getByPlaceholderText('history.searchPlaceholder'), { target: { value: 'Code' } })
    expect(screen.queryByText('Chat A')).not.toBeInTheDocument()
    expect(screen.getByText('Code B')).toBeInTheDocument()
  })

  it('opens session on click', () => {
    render(<SessionHistory />)
    fireEvent.click(screen.getByText('Code B'))
    expect(sessionService.selectSession).toHaveBeenCalledWith('s2')
  })
})
