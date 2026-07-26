import { describe, it, expect } from 'vitest'
import { parseSpeechEnvelope, formatSpeechOutput } from './speech-schema.js'
import { edgesFromEnvelope } from './edges.js'

describe('speech-schema', () => {
  it('parses JSON envelope with rebut', () => {
    const env = parseSpeechEnvelope(
      JSON.stringify({
        prose: 'I disagree with the strategist on timeline.',
        acts: [
          {
            kind: 'rebut',
            claim: 'Timeline is too aggressive',
            target: 'strategist',
            attack: 'ignores migration risk',
          },
        ],
      }),
    )
    expect(env.prose).toContain('disagree')
    expect(env.acts[0]?.kind).toBe('rebut')
    expect(env.acts[0]?.target).toBe('strategist')
    const edges = edgesFromEnvelope(1, 'skeptic', env)
    expect(edges).toHaveLength(1)
    expect(edges[0]?.relation).toBe('rebut')
  })

  it('demotes rebut without target to open', () => {
    const env = parseSpeechEnvelope(
      JSON.stringify({
        prose: 'x',
        acts: [{ kind: 'rebut', claim: 'bad' }],
      }),
    )
    expect(env.acts[0]?.kind).toBe('open')
  })

  it('falls back for plain prose', () => {
    const env = parseSpeechEnvelope('Just ship it already.')
    expect(env.prose).toContain('ship')
    expect(env.acts[0]?.kind).toBe('open')
  })

  it('formatSpeechOutput embeds acts', () => {
    const s = formatSpeechOutput({
      prose: 'hello',
      acts: [{ kind: 'open', claim: 'hello' }],
    })
    expect(s).toContain('hip.speech_acts')
    expect(s).toContain('hello')
  })
})
