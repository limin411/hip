import { describe, expect, it } from 'vitest'
import { scheduledSessionIds } from './sessionFlags'
import type { Automation } from './types'

function automation(patch: Partial<Automation> & Pick<Automation, 'id'>): Automation {
  return {
    name: `task-${patch.id}`,
    prompt: 'do the thing',
    enabled: true,
    trigger: { kind: 'daily', hour: 9, minute: 0 },
    createdAt: 0,
    updatedAt: 0,
    ...patch,
  }
}

describe('scheduledSessionIds', () => {
  it('collects sessions owning an enabled task', () => {
    const ids = scheduledSessionIds([
      automation({ id: 'a1', sessionId: 's1' }),
      automation({ id: 'a2', sessionId: 's2' }),
    ])
    expect(ids).toEqual(new Set(['s1', 's2']))
  })

  it('ignores disabled tasks — they never fire', () => {
    const ids = scheduledSessionIds([automation({ id: 'a1', sessionId: 's1', enabled: false })])
    expect(ids.size).toBe(0)
  })

  it('ignores tasks that are not conversation-scoped', () => {
    const ids = scheduledSessionIds([
      automation({ id: 'a1', sessionId: null }),
      automation({ id: 'a2' }),
    ])
    expect(ids.size).toBe(0)
  })

  it('deduplicates sessions with several tasks', () => {
    const ids = scheduledSessionIds([
      automation({ id: 'a1', sessionId: 's1' }),
      automation({ id: 'a2', sessionId: 's1' }),
    ])
    expect([...ids]).toEqual(['s1'])
  })

  it('returns an empty set for an empty catalog', () => {
    expect(scheduledSessionIds([]).size).toBe(0)
  })
})
