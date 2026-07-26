import { describe, it, expect } from 'vitest'
import { extractJsonObject, parseChairAction, parseChairActionFromText } from './schema.js'

describe('roundtable schema', () => {
  it('parses fenced JSON route skip', () => {
    const a = parseChairActionFromText(
      '```json\n{"type":"route","convene":false,"reply":"Hello"}\n```',
    )
    expect(a).toEqual({ type: 'route', convene: false, reply: 'Hello' })
  })

  it('parses plan and clamps rounds', () => {
    const a = parseChairAction({
      type: 'plan',
      rounds: 9,
      agenda: ['a'],
      rationale: 'hard',
    })
    expect(a.type).toBe('plan')
    if (a.type === 'plan') {
      expect(a.rounds).toBe(4)
      expect(a.agenda).toHaveLength(4)
    }
  })

  it('defaults speakers when empty on open_round', () => {
    const a = parseChairAction({
      type: 'open_round',
      round: 1,
      focus: 'cost',
      speakers: [],
    })
    expect(a.type).toBe('open_round')
    if (a.type === 'open_round') {
      expect(a.speakers.length).toBeGreaterThan(0)
    }
  })

  it('extractJsonObject finds bare object among prose', () => {
    const v = extractJsonObject('Here you go:\n{"type":"decide","decision":"ship","residual":[],"nextSteps":["1"]}\n')
    expect((v as { type: string }).type).toBe('decide')
  })
})
