import { describe, expect, it } from 'vitest'
import { normalizeSpaceIcon, SPACE_ICON_PRESETS } from './spaceIcons'

describe('normalizeSpaceIcon', () => {
  it('returns undefined for empty / whitespace', () => {
    expect(normalizeSpaceIcon(undefined)).toBeUndefined()
    expect(normalizeSpaceIcon(null)).toBeUndefined()
    expect(normalizeSpaceIcon('')).toBeUndefined()
    expect(normalizeSpaceIcon('   ')).toBeUndefined()
  })

  it('trims and keeps emoji', () => {
    expect(normalizeSpaceIcon('  📈  ')).toBe('📈')
  })

  it('caps long strings', () => {
    const long = 'x'.repeat(40)
    expect(normalizeSpaceIcon(long)?.length).toBe(16)
  })

  it('presets are non-empty unique strings', () => {
    expect(SPACE_ICON_PRESETS.length).toBeGreaterThan(8)
    expect(new Set(SPACE_ICON_PRESETS).size).toBe(SPACE_ICON_PRESETS.length)
  })
})
