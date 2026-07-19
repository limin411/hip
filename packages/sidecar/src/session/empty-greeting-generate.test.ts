import { describe, it, expect } from 'vitest'
import {
  buildEmptyGreetingUserPrompt,
  parseEmptyGreetingJson,
  generateEmptyGreeting,
} from './empty-greeting-generate.js'
import type { EmptyGreetingGenerateContext } from '@hip/protocol'

const baseCtx: EmptyGreetingGenerateContext = {
  language: 'en',
  surface: 'chat',
  timeOfDay: 'afternoon',
  region: 'US',
  tier: 'timeOfDay',
  baseTitle: 'Good afternoon',
  baseSub: 'What shall we tackle?',
  recentSessionTitles: ['Fix login bug', 'Refactor empty state'],
}

describe('parseEmptyGreetingJson', () => {
  it('parses plain JSON', () => {
    expect(parseEmptyGreetingJson('{"title":"Hi there","sub":"Lets build"}')).toEqual({
      title: 'Hi there',
      sub: 'Lets build',
    })
  })

  it('strips markdown fences', () => {
    const raw = '```json\n{"title":"Hello","sub":"World"}\n```'
    expect(parseEmptyGreetingJson(raw)).toEqual({ title: 'Hello', sub: 'World' })
  })

  it('rejects overlong title', () => {
    const title = 'x'.repeat(41)
    expect(parseEmptyGreetingJson(JSON.stringify({ title, sub: 'ok' }))).toBeNull()
  })

  it('collapses whitespace', () => {
    expect(parseEmptyGreetingJson('{"title":"  Hi  there  ","sub":"a\\nb"}')).toEqual({
      title: 'Hi there',
      sub: 'a b',
    })
  })
})

describe('buildEmptyGreetingUserPrompt', () => {
  it('includes language, base copy, and recent titles', () => {
    const p = buildEmptyGreetingUserPrompt(baseCtx)
    expect(p).toContain('language: en')
    expect(p).toContain('baseTitle: Good afternoon')
    expect(p).toContain('Fix login bug')
  })

  it('includes holidayId when present', () => {
    const p = buildEmptyGreetingUserPrompt({
      ...baseCtx,
      tier: 'holiday',
      holidayId: 'cn-national-day',
    })
    expect(p).toContain('holidayId: cn-national-day')
  })

  it('includes memoryHints when provided', () => {
    const p = buildEmptyGreetingUserPrompt({
      ...baseCtx,
      memoryHints: ['prefers concise Chinese replies', 'likes plan mode first'],
    })
    expect(p).toContain('memoryHints')
    expect(p).toContain('prefers concise Chinese replies')
    expect(p).toContain('goal: fun, time-specific, non-generic empty-state copy')
  })

  it('includes weekEdge and toneHint for Sunday late night', () => {
    const p = buildEmptyGreetingUserPrompt({
      ...baseCtx,
      timeOfDay: 'lateNight',
      localHour: 23,
      weekday: 0,
      weekEdge: 'sunday-late',
      toneHint: 'Sunday late night, almost Monday.',
    })
    expect(p).toContain('weekEdge: sunday-late')
    expect(p).toContain('localHour: 23')
    expect(p).toContain('toneHint: Sunday late night')
  })
})

describe('generateEmptyGreeting', () => {
  it('returns ok with valid LLM output', async () => {
    const result = await generateEmptyGreeting({
      context: baseCtx,
      callLLM: async () => JSON.stringify({ title: 'Afternoon spark', sub: 'Ship one small win.' }),
    })
    expect(result).toEqual({
      ok: true,
      title: 'Afternoon spark',
      sub: 'Ship one small win.',
    })
  })

  it('returns error on invalid JSON', async () => {
    const result = await generateEmptyGreeting({
      context: baseCtx,
      callLLM: async () => 'not json',
    })
    expect(result.ok).toBe(false)
  })

  it('returns error when callLLM throws', async () => {
    const result = await generateEmptyGreeting({
      context: baseCtx,
      callLLM: async () => {
        throw new Error('no key')
      },
    })
    expect(result).toEqual({ ok: false, error: 'no key' })
  })
})
