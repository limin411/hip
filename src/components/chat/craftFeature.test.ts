import { describe, it, expect } from 'vitest'
import {
  COMPOSER_OVERFLOW,
  ACTIVITY_LANES,
  CODEBLOCK_STRUCTURE_CRAFT,
  CODEBLOCK_LAZY_HIGHLIGHT,
} from './craftFeature'

describe('craftFeature flags', () => {
  it('keeps composer flat; other craft flags remain on', () => {
    expect(COMPOSER_OVERFLOW).toBe(false)
    expect(ACTIVITY_LANES).toBe(true)
    expect(CODEBLOCK_STRUCTURE_CRAFT).toBe(true)
    expect(CODEBLOCK_LAZY_HIGHLIGHT).toBe(true)
  })
})
