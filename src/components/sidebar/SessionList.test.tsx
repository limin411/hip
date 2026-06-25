import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SessionList } from './SessionList'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/store/uiStore', () => ({
  useUiStore: (selector: (s: any) => any) =>
    selector({
      activeView: 'chat',
      search: '',
      setSearch: vi.fn(),
    }),
}))

vi.mock('@/domain', () => ({
  useSessions: () => [],
  useActiveSessionId: () => null,
  useSearchHits: () => [],
  useSearching: () => false,
  sessionService: {
    selectSession: vi.fn(),
    deleteSession: vi.fn(),
    search: vi.fn(),
  },
}))

describe('SessionList empty', () => {
  it('renders no matches state', () => {
    const html = renderToStaticMarkup(<SessionList />)
    expect(html).toContain('sidebar.noMatches')
  })
})
