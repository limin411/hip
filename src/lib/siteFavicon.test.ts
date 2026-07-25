import { describe, it, expect } from 'vitest'
import { faviconCandidatesFor } from './siteFavicon'

describe('faviconCandidatesFor', () => {
  it('returns origin favicon then DuckDuckGo cache', () => {
    expect(faviconCandidatesFor('https://react.dev/learn')).toEqual([
      'https://react.dev/favicon.ico',
      'https://icons.duckduckgo.com/ip3/react.dev.ico',
    ])
  })

  it('normalizes http pages to https icon hosts', () => {
    expect(faviconCandidatesFor('http://example.com/a')).toEqual([
      'https://example.com/favicon.ico',
      'https://icons.duckduckgo.com/ip3/example.com.ico',
    ])
  })

  it('returns empty for invalid or non-http URLs', () => {
    expect(faviconCandidatesFor('not a url')).toEqual([])
    expect(faviconCandidatesFor('file:///tmp/x')).toEqual([])
  })
})
