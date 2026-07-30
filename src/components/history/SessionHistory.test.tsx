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
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === 'history.pageInfo' && params) {
        return `Page ${params.page} of ${params.total}`
      }
      if (params) return `${key}:${JSON.stringify(params)}`
      return key
    },
  }),
}))

vi.mock('@/domain', () => ({
  useSessions: () => mockSessions,
  sessionService: {
    selectSession: vi.fn(),
    deleteSession: vi.fn(),
  },
}))

const selectSessionFromSidebar = vi.fn(async (_id: string) => {})
vi.mock('@/components/layout/sidebarActions', () => ({
  selectSessionFromSidebar: (id: string) => selectSessionFromSidebar(id),
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

  it('opens session on click via selectSessionFromSidebar (closes overlay)', () => {
    selectSessionFromSidebar.mockClear()
    render(<SessionHistory />)
    fireEvent.click(screen.getByText('Session 5'))
    expect(selectSessionFromSidebar).toHaveBeenCalledWith('s5')
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

  it('renders pagination in the same toolbar row as surface tabs', () => {
    render(<SessionHistory />)
    const toolbar = screen.getByTestId('session-history-toolbar')
    expect(toolbar).toContainElement(screen.getByRole('navigation'))
    expect(toolbar).toContainElement(screen.getByText('history.filterAll'))
    expect(toolbar).toContainElement(screen.getByText('Page 1 of 3'))
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

  it('renders a delete button for each session', () => {
    render(<SessionHistory />)
    expect(screen.getAllByLabelText('history.deleteSession')).toHaveLength(20)
  })

  it('renders delete buttons on page 2', () => {
    render(<SessionHistory />)
    fireEvent.click(screen.getByText('2'))
    expect(screen.getAllByLabelText('history.deleteSession')).toHaveLength(20)
    expect(screen.getByText('Session 21')).toBeInTheDocument()
  })

  it('renders clear-all button when sessions exist', () => {
    render(<SessionHistory />)
    expect(screen.getByText('history.clearAll')).toBeInTheDocument()
  })

  it('hides clear-all button when there are no sessions', () => {
    mockSessions = []
    render(<SessionHistory />)
    expect(screen.queryByText('history.clearAll')).not.toBeInTheDocument()
  })

  it('deletes a session after confirming in dialog', () => {
    render(<SessionHistory />)
    fireEvent.click(screen.getAllByLabelText('history.deleteSession')[4])
    expect(screen.getByText('history.deleteSessionConfirmTitle:{"title":"Session 5"}')).toBeInTheDocument()
    fireEvent.click(screen.getByText('history.delete'))
    expect(sessionService.deleteSession).toHaveBeenCalledWith(
      's5',
      expect.objectContaining({ reason: 'user' }),
    )
  })

  it('does not delete a session when dialog is cancelled', () => {
    render(<SessionHistory />)
    fireEvent.click(screen.getAllByLabelText('history.deleteSession')[4])
    fireEvent.click(screen.getByText('common.cancel'))
    expect(sessionService.deleteSession).not.toHaveBeenCalled()
  })

  it('clears all listed sessions after confirming in dialog', () => {
    render(<SessionHistory />)
    fireEvent.click(screen.getByText('history.clearAll'))
    expect(screen.getByText('history.clearAllConfirmTitle')).toBeInTheDocument()
    fireEvent.click(screen.getByText('history.clearAllConfirmAction'))
    expect(sessionService.deleteSession).toHaveBeenCalledTimes(mockSessions.length)
    mockSessions.forEach((s) => {
      expect(sessionService.deleteSession).toHaveBeenCalledWith(
        s.id,
        expect.objectContaining({ reason: 'clearAll' }),
      )
    })
  })

  it('clear-all only deletes the current surface filter (not the other surface)', () => {
    render(<SessionHistory />)
    fireEvent.click(screen.getByText('history.filterCode'))
    fireEvent.click(screen.getByText('history.clearAll'))
    fireEvent.click(screen.getByText('history.clearAllConfirmAction'))
    const codeIds = mockSessions.filter((s) => s.config.surface === 'code').map((s) => s.id)
    const chatIds = mockSessions.filter((s) => s.config.surface === 'chat').map((s) => s.id)
    expect(sessionService.deleteSession).toHaveBeenCalledTimes(codeIds.length)
    for (const id of codeIds) {
      expect(sessionService.deleteSession).toHaveBeenCalledWith(
        id,
        expect.objectContaining({ reason: 'clearAll' }),
      )
    }
    for (const id of chatIds) {
      expect(sessionService.deleteSession).not.toHaveBeenCalledWith(
        id,
        expect.anything(),
      )
    }
  })

  it('does not clear sessions when clear-all dialog is cancelled', () => {
    render(<SessionHistory />)
    fireEvent.click(screen.getByText('history.clearAll'))
    fireEvent.click(screen.getByText('common.cancel'))
    expect(sessionService.deleteSession).not.toHaveBeenCalled()
  })
})
