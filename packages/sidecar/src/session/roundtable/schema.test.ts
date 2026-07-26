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
    const v = extractJsonObject(
      'Here you go:\n{"type":"decide","verdict":"Ship it now with guardrails.","decision":"Ship with phased rollout and monitoring.","residual":[],"nextSteps":["1"]}\n',
    )
    expect((v as { type: string }).type).toBe('decide')
  })

  it('parses plan cast and normalizes empty fields from L1', () => {
    const a = parseChairAction(
      {
        type: 'plan',
        rounds: 2,
        agenda: ['a', 'b'],
        rationale: 'hard',
        cast: [
          { id: 'skeptic', title: 'Risk lead', lens: 'Downside', mustCover: ['worst case'] },
          { id: 'operator', title: '', lens: '', mustCover: [] },
        ],
      },
      { lang: 'en' },
    )
    expect(a.type).toBe('plan')
    if (a.type === 'plan') {
      expect(a.cast?.length).toBe(2)
      expect(a.cast?.[0]?.title).toBe('Risk lead')
      expect(a.cast?.[1]?.title).toBe('Operator')
      expect(a.cast?.[1]?.lens.length).toBeGreaterThan(10)
      expect(a.cast?.[1]?.mustCover.length).toBeGreaterThan(0)
    }
  })

  it('requires decide.verdict unless softVerdict', () => {
    expect(() =>
      parseChairAction({
        type: 'decide',
        decision: 'A long enough decision body for soft derive path testing here.',
        residual: [],
        nextSteps: ['x'],
      }),
    ).toThrow(/verdict/)
    const soft = parseChairAction(
      {
        type: 'decide',
        decision: 'A long enough decision body for soft derive path testing here.',
        residual: [],
        nextSteps: ['x'],
      },
      { softVerdict: true },
    )
    expect(soft.type).toBe('decide')
    if (soft.type === 'decide') {
      expect(soft.verdict.length).toBeGreaterThan(10)
      expect(soft.keyTradeoffs).toEqual([])
    }
  })
})
