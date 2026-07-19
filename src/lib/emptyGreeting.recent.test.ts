// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  readRecentTipIds,
  pushRecentTipId,
  clearRecentTipIds,
} from './emptyGreeting.recent'

describe('emptyGreeting.recent', () => {
  beforeEach(() => {
    clearRecentTipIds()
  })

  it('starts empty', () => {
    expect(readRecentTipIds()).toEqual([])
  })

  it('pushes tip ids to the front and dedupes', () => {
    pushRecentTipId('tip:a')
    pushRecentTipId('tip:b')
    pushRecentTipId('tip:a')
    expect(readRecentTipIds()).toEqual(['tip:a', 'tip:b'])
  })

  it('caps at 8', () => {
    for (let i = 0; i < 12; i++) {
      pushRecentTipId(`tip:${i}`)
    }
    const ids = readRecentTipIds()
    expect(ids).toHaveLength(8)
    expect(ids[0]).toBe('tip:11')
  })
})
