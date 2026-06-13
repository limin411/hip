import { describe, it, expect } from 'vitest'
import { AIMessageChunk } from '@langchain/core/messages'
import { textDelta, reasoningDelta, RealModelRunner } from './model-runner.js'

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

describe('RealModelRunner retry', () => {
  const opts = () => ({ tools: [], bindTools: true, onText: () => {}, onReasoning: () => {} })

  it('retries a transient pre-stream failure then succeeds', async () => {
    let calls = 0
    const model: any = {
      bindTools() { return model },
      async stream() {
        calls++
        if (calls <= 2) { const e: any = new Error('transient'); e.status = 503; throw e }
        return (async function* () { yield new AIMessageChunk({ content: 'hi' }) })()
      },
    }
    const msg = await new RealModelRunner(model).run([], opts() as any)
    expect(typeof msg.content === 'string' ? msg.content : '').toBe('hi')
    expect(calls).toBe(3)
  })

  it('does not retry after a delta has already been emitted', async () => {
    let calls = 0
    const model: any = {
      bindTools() { return model },
      async stream() {
        calls++
        return (async function* () {
          yield new AIMessageChunk({ content: 'partial' })
          const e: any = new Error('mid-stream'); e.status = 503; throw e
        })()
      },
    }
    await expect(new RealModelRunner(model).run([], opts() as any)).rejects.toThrow()
    expect(calls).toBe(1)
  })
})
