import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SearchHit } from '@hip/protocol'
import type { SessionVM } from '@/domain/sessionStore'
import { SessionList } from './SessionList'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { resolvedLanguage: 'en', language: 'en' } }),
}))

let mockSearch = ''

vi.mock('@/store/uiStore', () => ({
  useUiStore: (selector: (s: any) => any) =>
    selector({
      activeView: 'chat',
      search: mockSearch,
      setSearch: vi.fn(),
    }),
}))

let mockSessions: SessionVM[] = []
let mockActiveSessionId: string | null = null
let mockHits: SearchHit[] = []

vi.mock('@/domain', () => ({
  useSessions: () => mockSessions,
  useActiveSessionId: () => mockActiveSessionId,
  useSearchHits: () => mockHits,
  useSearching: () => false,
  sessionService: {
    selectSession: vi.fn(),
    deleteSession: vi.fn(),
    search: vi.fn(),
  },
}))

const now = new Date('2026-06-25T14:00:00').getTime()

beforeAll(() => {
  vi.spyOn(Date, 'now').mockReturnValue(now)
})

afterAll(() => {
  vi.restoreAllMocks()
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
      { id: '1', title: 'Today Session', preview: '', updatedAtMs: now - 60_000, config: { llmProvider: 'openai', model: 'gpt-4', tools: [], surface: 'chat' }, loaded: true, messages: [], status: 'idle', error: null },
      { id: '2', title: 'Yesterday Session', preview: '', updatedAtMs: now - 86_400_000, config: { llmProvider: 'openai', model: 'gpt-4', tools: [], surface: 'chat' }, loaded: true, messages: [], status: 'idle', error: null },
      { id: '3', title: 'Older Session', preview: '', updatedAtMs: now - 86_400_000 * 3, config: { llmProvider: 'openai', model: 'gpt-4', tools: [], surface: 'chat' }, loaded: true, messages: [], status: 'idle', error: null },
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

describe('SessionList search results', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSearch = 'query'
    mockSessions = [
      { id: 's1', title: 'query match', preview: '', updatedAtMs: now - 60_000, config: { llmProvider: 'openai', model: 'gpt-4', tools: [], surface: 'chat' }, loaded: true, messages: [], status: 'idle', error: null },
      { id: 's2', title: 'Another chat', preview: '', updatedAtMs: now - 120_000, config: { llmProvider: 'openai', model: 'gpt-4', tools: [], surface: 'chat' }, loaded: true, messages: [], status: 'idle', error: null },
    ]
    mockHits = [
      { sessionId: 's2', messageId: 'm1', title: 'Another chat', snippet: 'this is a <mark>query</mark> hit', timestamp: now - 120_000 },
    ]
    mockActiveSessionId = null
  })

  it('renders flat search results with title match and FTS hit', () => {
    const html = renderToStaticMarkup(<SessionList />)

    expect(html).toContain('sidebar.searchResults')
    expect(html).toContain('query match')
    expect(html).toContain('Another chat')
    expect(html).toContain('this is a')
  })
})
