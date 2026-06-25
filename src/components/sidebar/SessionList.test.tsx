import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SessionVM } from '@/domain/sessionStore'
import { SessionList } from './SessionList'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { resolvedLanguage: 'en', language: 'en' } }),
}))

vi.mock('@/store/uiStore', () => ({
  useUiStore: (selector: (s: any) => any) =>
    selector({
      activeView: 'chat',
      search: '',
      setSearch: vi.fn(),
    }),
}))

let mockSessions: SessionVM[] = []
let mockActiveSessionId: string | null = null

vi.mock('@/domain', () => ({
  useSessions: () => mockSessions,
  useActiveSessionId: () => mockActiveSessionId,
  useSearchHits: () => [],
  useSearching: () => false,
  sessionService: {
    selectSession: vi.fn(),
    deleteSession: vi.fn(),
    search: vi.fn(),
  },
}))

vi.mock('@/lib/sessions', async () => {
  const actual = await vi.importActual('@/lib/sessions')
  return {
    ...actual,
    groupSessionsByRelativeDate: vi.fn((sessions: SessionVM[]) => [
      { key: 'today', sessions: sessions.filter((s) => s.title === 'Today Session') },
      { key: 'yesterday', sessions: sessions.filter((s) => s.title === 'Yesterday Session') },
      { key: 'older', sessions: sessions.filter((s) => s.title === 'Older Session') },
    ]),
  }
})

describe('SessionList empty', () => {
  beforeEach(() => {
    mockSessions = []
    mockActiveSessionId = null
  })

  it('renders no matches state', () => {
    const html = renderToStaticMarkup(<SessionList />)
    expect(html).toContain('sidebar.noMatches')
  })
})

describe('SessionList grouped', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSessions = []
    mockActiveSessionId = null
  })

  it('renders sessions inside date groups', () => {
    mockSessions = [
      { id: '1', title: 'Today Session', preview: '', updatedAtMs: 0, config: { llmProvider: 'openai', model: 'gpt-4', tools: [], surface: 'chat' }, loaded: true, messages: [], status: 'idle', error: null },
      { id: '2', title: 'Yesterday Session', preview: '', updatedAtMs: 0, config: { llmProvider: 'openai', model: 'gpt-4', tools: [], surface: 'chat' }, loaded: true, messages: [], status: 'idle', error: null },
      { id: '3', title: 'Older Session', preview: '', updatedAtMs: 0, config: { llmProvider: 'openai', model: 'gpt-4', tools: [], surface: 'chat' }, loaded: true, messages: [], status: 'idle', error: null },
    ]

    const html = renderToStaticMarkup(<SessionList />)

    expect(html).toContain('sidebar.dateGroup.today')
    expect(html).toContain('sidebar.dateGroup.yesterday')
    expect(html).toContain('sidebar.dateGroup.older')
    expect(html).toContain('Today Session')
    expect(html).toContain('Yesterday Session')
    expect(html).toContain('Older Session')
  })
})
