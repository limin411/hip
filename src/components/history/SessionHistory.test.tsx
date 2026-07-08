// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SessionHistory } from './SessionHistory'
import { sessionService } from '@/domain'

const createMockSessions = () =>
  Array.from({ length: 45 }, (_, i) => ({
    id: `s${i + 1}`,
    title: `Session ${i + 1}`,
    preview: `Preview ${i + 1}`,
    updatedAtMs: (45 - i) * 1000,
    config: { surface: i < 20 ? 'chat' : 'code' },
  }))

let mockSessions = createMockSessions()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === 'history.pageInfo' && params) {
        return `Page ${params.page} of ${params.total}`
      }
      return key
    },
  }),
}))

vi.mock('@/domain', () => ({
  useSessions: () => mockSessions,
  sessionService: {
    selectSession: vi.fn(),
  },
}))

vi.mock('@/components/ui/Tabs', async () => {
  const React = await import('react')
  const TabsContext = React.createContext<{ onValueChange?: (value: string) => void }>({})

  return {
    Tabs: ({ children, onValueChange }: { children: React.ReactNode; onValueChange?: (value: string) => void }) => (
      <TabsContext.Provider value={{ onValueChange }}>{children}</TabsContext.Provider>
    ),
    TabsList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    TabsTrigger: ({ children, value }: { children: React.ReactNode; value: string }) => {
      const ctx = React.useContext(TabsContext)
      return <button onClick={() => ctx.onValueChange?.(value)}>{children}</button>
    },
  }
})

describe('SessionHistory', () => {
  beforeEach(() => {
    mockSessions = createMockSessions()
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders first page of sessions', () => {
    render(<SessionHistory />)
    expect(screen.getByText('Session 1')).toBeInTheDocument()
    expect(screen.getByText('Session 20')).toBeInTheDocument()
    expect(screen.queryByText('Session 21')).not.toBeInTheDocument()
  })

  it('filters sessions by search query', () => {
    render(<SessionHistory />)
    fireEvent.change(screen.getByPlaceholderText('history.searchPlaceholder'), {
      target: { value: 'Session 25' },
    })
    expect(screen.getByText('Session 25')).toBeInTheDocument()
    expect(screen.queryByText('Session 1')).not.toBeInTheDocument()
  })

  it('filters sessions by surface tab', () => {
    render(<SessionHistory />)
    fireEvent.click(screen.getByText('history.filterCode'))
    expect(screen.queryByText('Session 1')).not.toBeInTheDocument()
    expect(screen.getByText('Session 21')).toBeInTheDocument()
  })

  it('combines search and surface filter', () => {
    render(<SessionHistory />)
    fireEvent.click(screen.getByText('history.filterCode'))
    fireEvent.change(screen.getByPlaceholderText('history.searchPlaceholder'), {
      target: { value: 'Session 25' },
    })
    expect(screen.getByText('Session 25')).toBeInTheDocument()
    expect(screen.queryByText('Session 13')).not.toBeInTheDocument()
  })

  it('paginates to the next page', () => {
    render(<SessionHistory />)
    expect(screen.queryByText('Session 21')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('2'))
    expect(screen.getByText('Session 21')).toBeInTheDocument()
    expect(screen.queryByText('Session 1')).not.toBeInTheDocument()
  })

  it('resets to page 1 when filter changes', () => {
    render(<SessionHistory />)
    fireEvent.click(screen.getByText('2'))
    expect(screen.getByText('Session 21')).toBeInTheDocument()
    fireEvent.click(screen.getByText('history.filterCode'))
    expect(screen.queryByText('Session 1')).not.toBeInTheDocument()
    expect(screen.queryByText('Session 41')).not.toBeInTheDocument()
    expect(screen.getByText('Session 21')).toBeInTheDocument()
  })

  it('opens session on click', () => {
    render(<SessionHistory />)
    fireEvent.click(screen.getByText('Session 5'))
    expect(sessionService.selectSession).toHaveBeenCalledWith('s5')
  })

  it('shows empty state when filtered results are empty', () => {
    render(<SessionHistory />)
    fireEvent.change(screen.getByPlaceholderText('history.searchPlaceholder'), {
      target: { value: 'nonexistent' },
    })
    expect(screen.getByText('history.empty')).toBeInTheDocument()
  })

  it('renders pageInfo with current and total pages', () => {
    render(<SessionHistory />)
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
  })

  it('resets to page 1 when search query changes after navigating', () => {
    render(<SessionHistory />)
    fireEvent.click(screen.getByText('2'))
    expect(screen.getByText('Session 21')).toBeInTheDocument()
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('history.searchPlaceholder'), {
      target: { value: 'Session' },
    })
    expect(screen.getByText('Session 1')).toBeInTheDocument()
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
  })

  it('clamps to page 1 when the filtered list shrinks while on a later page', () => {
    const { rerender } = render(<SessionHistory />)
    fireEvent.click(screen.getByText('2'))
    expect(screen.getByText('Session 21')).toBeInTheDocument()
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()

    // Shrink the session list so only one page remains.
    mockSessions = createMockSessions().slice(0, 20)
    rerender(<SessionHistory />)

    expect(screen.queryByText('Session 21')).not.toBeInTheDocument()
    expect(screen.getByText('Session 1')).toBeInTheDocument()
  })
})
