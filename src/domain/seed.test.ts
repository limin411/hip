// src/domain/seed.test.ts
import { describe, it, expect } from 'vitest'
import { seedSessions } from './seed'

describe('seedSessions', () => {
  it('produces all 8 mock sessions preserving display strings', () => {
    const sessions = seedSessions()
    expect(sessions).toHaveLength(8)
    expect(sessions[0]).toMatchObject({ id: 's1', title: '重构 WebSocket 客户端', updatedAt: '2m ago' })
    expect(typeof sessions[0].preview).toBe('string')
  })

  it('seeds the first session with its message history and agents', () => {
    const s1 = seedSessions()[0]
    expect(s1.messages.length).toBeGreaterThan(0)
    expect(s1.messages[0]).toMatchObject({ role: 'user' })
    expect(s1.agents.map((a) => a.role)).toEqual(['supervisor', 'planner', 'coder', 'reviewer'])
  })

  it('leaves non-first sessions empty', () => {
    const s2 = seedSessions()[1]
    expect(s2.messages).toHaveLength(0)
    expect(s2.agents).toHaveLength(0)
  })
})
