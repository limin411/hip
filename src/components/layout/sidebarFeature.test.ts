import { describe, it, expect } from 'vitest'
import { SIDEBAR_NAV_SLIM } from './sidebarFeature'

describe('sidebarFeature flags (first_merge defaults)', () => {
  it('keeps SIDEBAR_NAV_SLIM false (unfinished nav stays visible)', () => {
    expect(SIDEBAR_NAV_SLIM).toBe(false)
  })
})
