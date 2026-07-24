import { describe, it, expect } from 'vitest'
import {
  COMPOSER_OVERFLOW,
  ACTIVITY_LANES,
  CODEBLOCK_STRUCTURE_CRAFT,
  CODEBLOCK_LAZY_HIGHLIGHT,
} from './craftFeature'

describe('craftFeature flags (product bake-in defaults)', () => {
  it('enables craft upgrade flags after full plan implementation', () => {
    expect(COMPOSER_OVERFLOW).toBe(true)
    expect(ACTIVITY_LANES).toBe(true)
    expect(CODEBLOCK_STRUCTURE_CRAFT).toBe(true)
    expect(CODEBLOCK_LAZY_HIGHLIGHT).toBe(true)
  })
})
