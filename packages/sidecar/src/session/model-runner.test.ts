import { describe, it, expect } from 'vitest'
import { AIMessageChunk } from '@langchain/core/messages'
import { textDelta, reasoningDelta } from './model-runner.js'

describe('delta extractors', () => {
  it('textDelta reads plain-string content', () => {
    expect(textDelta(new AIMessageChunk({ content: 'hello' }))).toBe('hello')
  })

  it('textDelta reads text blocks from array content', () => {
    const c = new AIMessageChunk({ content: [{ type: 'text', text: 'hi' } as any] })
    expect(textDelta(c)).toBe('hi')
  })

  it('reasoningDelta reads reasoning blocks from array content', () => {
    const c = new AIMessageChunk({ content: [{ type: 'reasoning', reasoning: 'because' } as any] })
    expect(reasoningDelta(c)).toBe('because')
  })

  it('reasoningDelta falls back to additional_kwargs.reasoning_content for string content', () => {
    const c = new AIMessageChunk({ content: '', additional_kwargs: { reasoning_content: 'why' } as any })
    expect(reasoningDelta(c)).toBe('why')
  })

  it('reasoningDelta is empty for plain text', () => {
    expect(reasoningDelta(new AIMessageChunk({ content: 'hi' }))).toBe('')
  })
})
