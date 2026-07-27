import { describe, expect, it } from 'vitest'
import {
  clampSidebarWidth,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
} from './sidebarWidth'

describe('clampSidebarWidth', () => {
  it('returns default for non-finite input', () => {
    expect(clampSidebarWidth(undefined)).toBe(SIDEBAR_WIDTH_DEFAULT)
    expect(clampSidebarWidth(null)).toBe(SIDEBAR_WIDTH_DEFAULT)
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_WIDTH_DEFAULT)
    expect(clampSidebarWidth('260')).toBe(SIDEBAR_WIDTH_DEFAULT)
  })

  it('clamps to min and max', () => {
    expect(clampSidebarWidth(SIDEBAR_WIDTH_MIN - 40)).toBe(SIDEBAR_WIDTH_MIN)
    expect(clampSidebarWidth(SIDEBAR_WIDTH_MAX + 80)).toBe(SIDEBAR_WIDTH_MAX)
    expect(clampSidebarWidth(320)).toBe(320)
  })

  it('respects a live max below the absolute max', () => {
    expect(clampSidebarWidth(400, 300)).toBe(300)
    expect(clampSidebarWidth(180, 300)).toBe(SIDEBAR_WIDTH_MIN)
  })

  it('rounds to whole pixels', () => {
    expect(clampSidebarWidth(260.6)).toBe(261)
  })
})
