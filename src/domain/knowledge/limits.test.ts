import { describe, expect, it } from 'vitest'
import { KNOWLEDGE_VERSION_CAP, localDayKey } from './limits'

describe('knowledge limits', () => {
  it('version cap is 30', () => {
    expect(KNOWLEDGE_VERSION_CAP).toBe(30)
  })

  it('localDayKey formats YYYY-MM-DD in local TZ', () => {
    const d = new Date(2026, 6, 14, 15, 30, 0) // July is month 6
    expect(localDayKey(d)).toBe('2026-07-14')
  })
})
