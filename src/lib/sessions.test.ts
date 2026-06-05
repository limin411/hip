import { describe, it, expect } from 'vitest'
import { filterSessions } from './sessions'
import type { MockSession } from '@/mock/types'

const data: MockSession[] = [
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
