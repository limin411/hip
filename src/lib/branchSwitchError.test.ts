import { describe, expect, it } from 'vitest'
import { parseCheckedOutPath } from './branchSwitchError'

describe('parseCheckedOutPath', () => {
  it('parses the quoted git ≥2.19 form', () => {
    expect(
      parseCheckedOutPath("fatal: 'feature-x' is already checked out at '/work/isolated'"),
    ).toBe('/work/isolated')
  })

  it('parses the bare (unquoted) form', () => {
    expect(parseCheckedOutPath('fatal: feature-x is already checked out at /work/isolated')).toBe(
      '/work/isolated',
    )
  })

  it('returns the first path when several appear', () => {
    expect(
      parseCheckedOutPath(
        "fatal: 'a' is already checked out at '/x'; also checked out at '/y'",
      ),
    ).toBe('/x')
  })

  it('returns null for unrelated git errors', () => {
    expect(parseCheckedOutPath('fatal: invalid branch name: foo..bar')).toBeNull()
    expect(parseCheckedOutPath('fatal: branch feature-x not found')).toBeNull()
  })

  it('returns null for empty / missing input', () => {
    expect(parseCheckedOutPath('')).toBeNull()
    expect(parseCheckedOutPath(null)).toBeNull()
    expect(parseCheckedOutPath(undefined)).toBeNull()
  })
})
