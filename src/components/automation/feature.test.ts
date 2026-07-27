import { describe, expect, it } from 'vitest'
import { AUTOMATION_PAGE } from './feature'

describe('AUTOMATION_PAGE flag', () => {
  it('is false until UI wiring (PR4)', () => {
    expect(AUTOMATION_PAGE).toBe(false)
    // `as const` narrows for PlaceholderSidebarSection conditional types
    const flag: false = AUTOMATION_PAGE
    expect(flag).toBe(false)
  })
})
