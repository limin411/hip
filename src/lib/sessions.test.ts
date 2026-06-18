import { describe, it, expect } from 'vitest'
import { filterSessions, surfaceOf, filterBySurface } from './sessions'

interface TestSession {
  id: string
  title: string
  preview: string
  updatedAt: string
}

const data: TestSession[] = [
  { id: '1', title: 'WebSocket 重构', preview: 'ws client', updatedAt: '' },
  { id: '2', title: '布局', preview: '三栏 layout', updatedAt: '' },
]

describe('filterSessions', () => {
  it('returns all when query empty', () => {
    expect(filterSessions(data, '')).toHaveLength(2)
  })

  it('matches title case-insensitively', () => {
    expect(filterSessions(data, 'websocket')).toHaveLength(1)
  })

  it('matches preview text', () => {
    expect(filterSessions(data, 'layout')).toHaveLength(1)
  })

  it('returns empty on no match', () => {
    expect(filterSessions(data, 'zzz')).toHaveLength(0)
  })
})

describe('surfaceOf (frontend)', () => {
  it('returns the explicit surface', () => {
    expect(surfaceOf({ surface: 'chat' })).toBe('chat')
    expect(surfaceOf({ surface: 'code' })).toBe('code')
  })
  it('defaults to code when absent (the sidecar normally stamps it)', () => {
    expect(surfaceOf({})).toBe('code')
    expect(surfaceOf({ surface: undefined })).toBe('code')
  })
})

describe('filterBySurface', () => {
  const mk = (id: string, surface?: 'chat' | 'code') => ({ id, config: { surface } })
  it('keeps only sessions whose surface matches', () => {
    const list = [mk('a', 'chat'), mk('b', 'code'), mk('c', 'chat')]
    expect(filterBySurface(list, 'chat').map((s) => s.id)).toEqual(['a', 'c'])
    expect(filterBySurface(list, 'code').map((s) => s.id)).toEqual(['b'])
  })
  it('treats a missing surface as code', () => {
    const list = [mk('a'), mk('b', 'chat')]
    expect(filterBySurface(list, 'code').map((s) => s.id)).toEqual(['a'])
  })
})
