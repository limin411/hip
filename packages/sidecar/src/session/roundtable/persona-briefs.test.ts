import { describe, it, expect } from 'vitest'
import { PERSONA_IDS } from './types.js'
import {
  defaultCastSeats,
  getPersonaBrief,
  resolveCast,
  seatTitle,
} from './persona-briefs.js'
import { advisorSystemPrompt, advisorUserPrompt } from './prompts.js'

describe('persona briefs L1', () => {
  it('has complete briefs for all personas', () => {
    for (const id of PERSONA_IDS) {
      const b = getPersonaBrief(id)
      expect(b.mission['zh-CN'].length).toBeGreaterThan(8)
      expect(b.typicalProbes.en.length).toBeGreaterThan(0)
      expect(b.mustNot.en.length).toBeGreaterThan(0)
    }
    expect(defaultCastSeats('en')).toHaveLength(5)
  })
})

describe('resolveCast L3', () => {
  it('falls back to full L1 when empty', () => {
    expect(resolveCast(undefined, 'en')).toHaveLength(5)
    expect(resolveCast([], 'zh-CN')).toHaveLength(5)
  })

  it('keeps issue-specific titles and fills blanks', () => {
    const cast = resolveCast(
      [
        { id: 'skeptic', title: '合规质疑者', lens: '跨境责任', mustCover: ['谁担责'] },
        { id: 'operator', title: '', lens: '', mustCover: [] },
        { id: 'not-a-seat', title: 'x', lens: 'y', mustCover: ['z'] },
      ],
      'zh-CN',
    )
    expect(cast.map((c) => c.id)).toEqual(['skeptic', 'operator'])
    expect(cast[0]?.title).toBe('合规质疑者')
    expect(cast[1]?.title).toBe('执行者')
    expect(cast[1]?.mustCover.length).toBeGreaterThan(0)
  })

  it('pads single seat to at least two', () => {
    const cast = resolveCast(
      [{ id: 'creative', title: 'C', lens: 'L', mustCover: ['m'] }],
      'en',
    )
    expect(cast.length).toBeGreaterThanOrEqual(2)
    expect(cast[0]?.id).toBe('creative')
  })
})

describe('advisor prompts L1+L2', () => {
  it('system prompts differ by persona mission', () => {
    const s = advisorSystemPrompt('strategist', 'en')
    const k = advisorSystemPrompt('skeptic', 'en')
    expect(s).toContain('long-horizon')
    expect(k).toContain('failure modes')
    expect(s).not.toEqual(k)
  })

  it('user prompt injects issue, agenda, focus, mustCover', () => {
    const seat = resolveCast(
      [
        {
          id: 'audience',
          title: 'Trust advocate',
          lens: 'User trust',
          mustCover: ['What erodes trust?'],
        },
      ],
      'en',
    )[0]!
    const user = advisorUserPrompt({
      persona: 'audience',
      lang: 'en',
      issue: 'Ship money-moving agents?',
      agenda: ['Risk', 'UX'],
      focus: 'Trust copy',
      minutes: '(none)',
      priorThisRound: [],
      seat,
    })
    expect(user).toContain('Ship money-moving agents?')
    expect(user).toContain('Trust copy')
    expect(user).toContain('What erodes trust?')
    expect(user).toContain('Risk')
    expect(seatTitle('audience', 'en', [seat])).toBe('Trust advocate')
  })
})
