import { describe, expect, it } from 'vitest'
import { AUTOMATION_PAGE } from './feature'

describe('AUTOMATION_PAGE flag', () => {
  it('is true when UI wiring is enabled (PR4)', () => {
    expect(AUTOMATION_PAGE).toBe(true)
    // `as const` narrows for PlaceholderSidebarSection conditional types
    const flag: true = AUTOMATION_PAGE
    expect(flag).toBe(true)
  })
})
