import { describe, it, expect } from 'vitest'
import { PLAN_MARKDOWN_WIRE_CAP, clipPlanMarkdown } from './plan-markdown-wire.js'

describe('clipPlanMarkdown', () => {
  it('returns empty for empty/falsy input', () => {
    expect(clipPlanMarkdown('')).toEqual({ text: '', truncated: false })
  })

  it('passes through text under the cap unchanged', () => {
    const raw = '# Plan\n\n- step one\n- step two'
    expect(clipPlanMarkdown(raw)).toEqual({ text: raw, truncated: false })
  })

  it('passes through text exactly at the cap', () => {
    const raw = 'x'.repeat(PLAN_MARKDOWN_WIRE_CAP)
    expect(clipPlanMarkdown(raw)).toEqual({ text: raw, truncated: false })
  })

  it('truncates with suffix inside cap when over limit', () => {
    const raw = 'y'.repeat(PLAN_MARKDOWN_WIRE_CAP + 500)
    const { text, truncated } = clipPlanMarkdown(raw)
    expect(truncated).toBe(true)
    expect(text.length).toBe(PLAN_MARKDOWN_WIRE_CAP)
    expect(text.endsWith('\n\n…(truncated)')).toBe(true)
    expect(text.startsWith('y')).toBe(true)
  })

  it('final length is always <= PLAN_MARKDOWN_WIRE_CAP', () => {
    for (const n of [0, 1, PLAN_MARKDOWN_WIRE_CAP - 1, PLAN_MARKDOWN_WIRE_CAP, PLAN_MARKDOWN_WIRE_CAP + 1, PLAN_MARKDOWN_WIRE_CAP * 2]) {
      const { text } = clipPlanMarkdown('z'.repeat(n))
      expect(text.length).toBeLessThanOrEqual(PLAN_MARKDOWN_WIRE_CAP)
    }
  })
})
