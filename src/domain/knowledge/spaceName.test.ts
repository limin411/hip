import { describe, expect, it } from 'vitest'
import { isSpaceNameTaken, normalizeSpaceName } from './spaceName'

const spaces = [
  { id: 'a', name: '产品' },
  { id: 'b', name: 'Notes' },
]

describe('normalizeSpaceName', () => {
  it('trims whitespace', () => {
    expect(normalizeSpaceName('  产品  ')).toBe('产品')
  })
})

describe('isSpaceNameTaken', () => {
  it('detects exact and case-insensitive match after trim', () => {
    expect(isSpaceNameTaken(spaces, '产品')).toBe(true)
    expect(isSpaceNameTaken(spaces, '  产品  ')).toBe(true)
    expect(isSpaceNameTaken(spaces, 'notes')).toBe(true)
    expect(isSpaceNameTaken(spaces, 'NOTES')).toBe(true)
  })

  it('allows unused names and empty after trim', () => {
    expect(isSpaceNameTaken(spaces, '新空间')).toBe(false)
    expect(isSpaceNameTaken(spaces, '   ')).toBe(false)
  })

  it('excludes the space being renamed', () => {
    expect(isSpaceNameTaken(spaces, '产品', 'a')).toBe(false)
    expect(isSpaceNameTaken(spaces, '产品', 'b')).toBe(true)
  })
})
