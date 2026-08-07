import { describe, expect, it } from 'vitest'
import {
  hasInlineMath,
  segmentsToText,
  splitInlineMath,
} from './mathInlineConvert'

describe('splitInlineMath', () => {
  it('converts a single $…$ run', () => {
    const segs = splitInlineMath('Inline $e^{i\\pi} + 1 = 0$ here.')
    expect(segs).toEqual([
      { type: 'text', text: 'Inline ' },
      { type: 'mathInline', src: 'e^{i\\pi} + 1 = 0' },
      { type: 'text', text: ' here.' },
    ])
  })

  it('converts multiple runs and preserves text order', () => {
    const segs = splitInlineMath('$a$ and $b$')
    expect(segs).toEqual([
      { type: 'mathInline', src: 'a' },
      { type: 'text', text: ' and ' },
      { type: 'mathInline', src: 'b' },
    ])
  })

  it('leaves ambiguous $a$$b$ as plain text', () => {
    const segs = splitInlineMath('$a$$b$')
    expect(segs).toEqual([{ type: 'text', text: '$a$$b$' }])
  })

  it('does not convert currency-like "$5 and $10"', () => {
    expect(hasInlineMath('It costs $5 and $10.')).toBe(false)
    expect(splitInlineMath('It costs $5 and $10.')).toEqual([
      { type: 'text', text: 'It costs $5 and $10.' },
    ])
  })

  it('does not convert escaped \\$ or mid-word $', () => {
    expect(hasInlineMath('price \\$5 now')).toBe(false)
    expect(hasInlineMath('a$b$c')).toBe(false)
  })

  it('does not convert empty or space-padded src', () => {
    expect(hasInlineMath('$$')).toBe(false)
    expect(hasInlineMath('$ x $')).toBe(false)
  })

  it('requires closing $ before whitespace or punctuation', () => {
    expect(hasInlineMath('$x$5')).toBe(false)
    expect(hasInlineMath('($x$); done')).toBe(true)
  })

  it('round-trips via segmentsToText', () => {
    const text = 'A $x^2$ and $y_1$ tail'
    expect(segmentsToText(splitInlineMath(text))).toBe(text)
  })
})
