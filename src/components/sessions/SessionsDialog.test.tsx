// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SessionsDialog } from './SessionsDialog'
import { sessionService } from '@/domain'
import type { SessionVM } from '@/domain/sessionStore'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { resolvedLanguage: 'en', language: 'en' } }),
}))

let mockSessions: SessionVM[] = []
let mockActiveSessionId: string | null = null

vi.mock('@/domain', () => ({
  useSessions: () => mockSessions,
  useActiveSessionId: () => mockActiveSessionId,
  sessionService: {
    selectSession: vi.fn(),
    deleteSession: vi.fn(),
  },
}))

const baseSession = (id: string, surface: 'chat' | 'code', updatedAtMs: number): SessionVM => ({
  id,
  title: id,
  preview: '',
  updatedAtMs,
  config: { llmProvider: 'openai', model: 'gpt-4', tools: [], surface },
  loaded: true,
  messages: [],
  status: 'idle',
  error: null,
})

describe('SessionsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSessions = []
    mockActiveSessionId = null
  })

  afterEach(() => {
    cleanup()
  })

  it('filters by surface', () => {
    mockSessions = [
      baseSession('chat-1', 'chat', Date.now()),
      baseSession('code-1', 'code', Date.now()),
    ]
    render(<SessionsDialog open onOpenChange={vi.fn()} />)
    fireEvent.mouseDown(screen.getByText('sidebar.filterCode'))
    expect(screen.queryByText('chat-1')).not.toBeInTheDocument()
    expect(screen.getByText('code-1')).toBeInTheDocument()
  })

  it('paginates results', () => {
    mockSessions = Array.from({ length: 25 }, (_, i) => baseSession(`s-${i}`, 'chat', Date.now() - i))
    render(<SessionsDialog open onOpenChange={vi.fn()} />)
    expect(screen.getByText('s-0')).toBeInTheDocument()
    expect(screen.getByText('s-19')).toBeInTheDocument()
    expect(screen.queryByText('s-20')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByText('s-20')).toBeInTheDocument()
  })

  it('selects a session and closes', () => {
    const onOpenChange = vi.fn()
    mockSessions = [baseSession('chat-1', 'chat', Date.now())]
    render(<SessionsDialog open onOpenChange={onOpenChange} />)
    fireEvent.click(screen.getByText('chat-1'))
    expect(sessionService.selectSession).toHaveBeenCalledWith('chat-1')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
