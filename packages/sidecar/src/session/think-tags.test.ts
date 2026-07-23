import { describe, expect, it } from 'vitest'
import { createThinkTagStreamSplitter, splitThinkTags } from './think-tags.js'

describe('splitThinkTags', () => {
  it('returns plain text unchanged', () => {
    expect(splitThinkTags('hello')).toEqual({ text: 'hello', reasoning: '' })
  })

  it('splits MiniMax-style think block', () => {
    expect(splitThinkTags('<think>calc 2+2</think>\n\n4')).toEqual({
      text: '\n\n4',
      reasoning: 'calc 2+2',
    })
  })

  it('handles think-only content', () => {
    expect(splitThinkTags('<think>only thought</think>')).toEqual({
      text: '',
      reasoning: 'only thought',
    })
  })

  it('treats unclosed think as reasoning', () => {
    expect(splitThinkTags('<think>truncated thought')).toEqual({
      text: '',
      reasoning: 'truncated thought',
    })
  })

  it('supports multiple think blocks', () => {
    expect(splitThinkTags('a<think>r1</think>b<think>r2</think>c')).toEqual({
      text: 'abc',
      reasoning: 'r1r2',
    })
  })
})

describe('createThinkTagStreamSplitter', () => {
  it('splits across chunk boundaries (tag open/close mid-stream)', () => {
    const s = createThinkTagStreamSplitter()
    expect(s.push('<thi')).toEqual({ text: '', reasoning: '' })
    expect(s.push('nk>hello ')).toEqual({ text: '', reasoning: 'hello ' })
    expect(s.push('world</th')).toEqual({ text: '', reasoning: 'world' })
    expect(s.push('ink>\nanswer')).toEqual({ text: '\nanswer', reasoning: '' })
    expect(s.flush()).toEqual({ text: '', reasoning: '' })
  })

  it('matches MiniMax stream pattern: think then answer', () => {
    const s = createThinkTagStreamSplitter()
    const parts = [
      s.push('<think>The user asks "What is 12*13? Brief'),
      s.push('." They want a brief answer'),
      s.push('.\n\n12*13 = 156.'),
      s.push('</think>\n\n156.'),
    ]
    expect(parts.map((p) => p.reasoning).join('')).toBe(
      'The user asks "What is 12*13? Brief." They want a brief answer.\n\n12*13 = 156.',
    )
    expect(parts.map((p) => p.text).join('')).toBe('\n\n156.')
  })

  it('holds partial open tag then emits as text if not completed', () => {
    const s = createThinkTagStreamSplitter()
    expect(s.push('before <thi')).toEqual({ text: 'before ', reasoning: '' })
    // flush incomplete prefix as text
    expect(s.flush()).toEqual({ text: '<thi', reasoning: '' })
  })

  it('does not treat plain less-than as a tag', () => {
    const s = createThinkTagStreamSplitter()
    expect(s.push('a < b')).toEqual({ text: 'a < b', reasoning: '' })
  })
})
