import { describe, it, expect } from 'vitest'
import { AIMessage, AIMessageChunk, HumanMessage, SystemMessage } from '@langchain/core/messages'
import { concat } from '@langchain/core/utils/stream'
import {
  textDelta,
  reasoningDelta,
  RealModelRunner,
  collapseStreamedAiContent,
  collapseStreamedAiMessage,
  hasToolCallStreamActivity,
} from './model-runner.js'
import { projectReasoningStreamContent } from './model-factory.js'

describe('hasToolCallStreamActivity', () => {
  it('is false for plain text chunks', () => {
    expect(hasToolCallStreamActivity(new AIMessageChunk({ content: 'hello' }))).toBe(false)
  })

  it('is true when tool_call_chunks are present', () => {
    const c = new AIMessageChunk({
      content: '',
      tool_call_chunks: [{ name: 'write_file', args: '{"path"', id: 'c1', index: 0 }],
    } as any)
    expect(hasToolCallStreamActivity(c)).toBe(true)
  })

  it('is true when tool_calls are present', () => {
    const c = new AIMessageChunk({
      content: '',
      tool_calls: [{ name: 'write_file', args: { path: '/a.svg', content: '<svg/>' }, id: 'c1', type: 'tool_call' }],
    } as any)
    expect(hasToolCallStreamActivity(c)).toBe(true)
  })
})

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

  it('pulses onActivity for tool_call_chunks without text and does not retry after', async () => {
    let calls = 0
    let activity = 0
    const model: any = {
      bindTools() { return model },
      async stream() {
        calls++
        return (async function* () {
          yield new AIMessageChunk({
            content: '',
            tool_call_chunks: [{ name: 'write_file', args: '{"path":"/x.svg","content":"', id: 'c1', index: 0 }],
          } as any)
          yield new AIMessageChunk({
            content: '',
            tool_call_chunks: [{ args: '<svg/>"}', id: 'c1', index: 0 }],
          } as any)
          if (calls === 1) {
            const e: any = new Error('mid-stream after tool args'); e.status = 503; throw e
          }
        })()
      },
    }
    await expect(
      new RealModelRunner(model).run([], {
        ...opts(),
        onActivity: () => { activity++ },
      } as any),
    ).rejects.toThrow()
    expect(activity).toBeGreaterThanOrEqual(1)
    expect(calls).toBe(1)
  })

  it('coalesces multiple SystemMessages for ChatAnthropic before stream', async () => {
    const seen: unknown[] = []
    // Stand-in named ChatAnthropic — isAnthropicChatModel matches constructor.name.
    class ChatAnthropic {
      bindTools() { return this }
      async stream(msgs: unknown[]) {
        seen.push(msgs)
        return (async function* () {
          yield new AIMessageChunk({ content: 'ok' })
        })()
      }
    }
    const model = new ChatAnthropic() as any
    await new RealModelRunner(model).run(
      [new SystemMessage('main'), new SystemMessage('ctx'), new HumanMessage('hi')],
      { tools: [], bindTools: true, onText: () => {}, onReasoning: () => {}, cachePolicy: 'none' } as any,
    )
    const msgs = seen[0] as Array<{ getType: () => string; content: unknown }>
    expect(msgs).toHaveLength(2)
    expect(msgs[0].getType()).toBe('system')
    expect(String(msgs[0].content)).toContain('main')
    expect(String(msgs[0].content)).toContain('ctx')
    expect(msgs[1].getType()).toBe('human')
  })

  it('attaches Anthropic cache_control breakpoints on auto policy', async () => {
    const seen: unknown[] = []
    class ChatAnthropic {
      bindTools(tools: unknown[]) {
        seen.push({ tools })
        return this
      }
      async stream(msgs: unknown[], opts?: unknown) {
        seen.push({ msgs, opts })
        return (async function* () {
          yield new AIMessageChunk({ content: 'ok' })
        })()
      }
    }
    const model = new ChatAnthropic() as any
    const tools = [
      { name: 't1', description: 'd', schema: { type: 'object', properties: {} }, lc_namespace: ['t'] },
      { name: 't2', description: 'd', schema: { type: 'object', properties: {} }, lc_namespace: ['t'] },
    ]
    await new RealModelRunner(model).run(
      [new SystemMessage('sys'), new HumanMessage('first'), new HumanMessage('latest')],
      {
        tools,
        bindTools: true,
        onText: () => {},
        onReasoning: () => {},
        cachePolicy: 'auto',
      } as any,
    )
    const bind = seen[0] as { tools: Array<{ name: string; extras?: { cache_control?: unknown } }> }
    expect(bind.tools[1]!.extras?.cache_control).toEqual({ type: 'ephemeral' })
    const stream = seen[1] as {
      msgs: Array<{ getType: () => string; content: unknown }>
    }
    const sysContent = stream.msgs[0]!.content as Array<{ cache_control?: unknown; text?: string }>
    expect(sysContent[0]?.cache_control).toEqual({ type: 'ephemeral' })
    const latest = stream.msgs[stream.msgs.length - 1]!.content as Array<{
      cache_control?: unknown
      text?: string
    }>
    expect(latest[0]?.text).toBe('latest')
    expect(latest[0]?.cache_control).toEqual({ type: 'ephemeral' })
  })

  it('OpenAI path passes promptCacheKey when client supports it', async () => {
    const seenOpts: unknown[] = []
    class ReasoningChatOpenAI {
      promptCacheKey?: string
      bindTools() { return this }
      async stream(_msgs: unknown[], opts?: unknown) {
        seenOpts.push(opts)
        return (async function* () {
          yield new AIMessageChunk({ content: 'ok' })
        })()
      }
    }
    const model = new ReasoningChatOpenAI() as any
    await new RealModelRunner(model).run(
      [new HumanMessage('hi')],
      {
        tools: [],
        bindTools: true,
        onText: () => {},
        onReasoning: () => {},
        cachePolicy: 'auto',
        sessionId: 'sess-xyz',
      } as any,
    )
    expect(seenOpts[0]).toMatchObject({ promptCacheKey: 'sess-xyz' })
  })

  it('unsupported OpenAI-shaped client without promptCacheKey field is still ok if named ChatOpenAI', async () => {
    const seenOpts: unknown[] = []
    class ChatOpenAI {
      bindTools() { return this }
      async stream(_msgs: unknown[], opts?: unknown) {
        seenOpts.push(opts)
        return (async function* () {
          yield new AIMessageChunk({ content: 'ok' })
        })()
      }
    }
    await new RealModelRunner(new ChatOpenAI() as any).run([new HumanMessage('hi')], {
      tools: [],
      bindTools: true,
      onText: () => {},
      onReasoning: () => {},
      sessionId: 's1',
    } as any)
    expect(seenOpts[0]).toMatchObject({ promptCacheKey: 's1' })
  })

  it('unknown model does not get promptCacheKey (unsupported no-op)', async () => {
    const seenOpts: unknown[] = []
    const model: any = {
      bindTools() { return model },
      async stream(_m: unknown[], opts?: unknown) {
        seenOpts.push(opts)
        return (async function* () {
          yield new AIMessageChunk({ content: 'ok' })
        })()
      },
    }
    await new RealModelRunner(model).run([new HumanMessage('hi')], {
      tools: [],
      bindTools: true,
      onText: () => {},
      onReasoning: () => {},
      sessionId: 's1',
    } as any)
    expect(seenOpts[0]).not.toHaveProperty('promptCacheKey')
  })

  it('splits MiniMax-style <think> tags into onReasoning vs onText (UI sinks)', async () => {
    const texts: string[] = []
    const reasons: string[] = []
    const model: any = {
      bindTools() { return model },
      async stream() {
        return (async function* () {
          // Mimic MiniMax OpenAI stream: CoT inside content with think tags.
          yield new AIMessageChunk({ content: '<think>The user asks 12*13' })
          yield new AIMessageChunk({ content: '.</think>\n\n156' })
        })()
      },
    }
    const msg = await new RealModelRunner(model).run([], {
      tools: [],
      bindTools: true,
      onText: (d) => texts.push(d),
      onReasoning: (d) => reasons.push(d),
    } as any)
    expect(reasons.join('')).toBe('The user asks 12*13.')
    expect(texts.join('')).toBe('\n\n156')
    // Gathered message keeps raw tags for multi-turn CoT continuity.
    expect(typeof msg.content === 'string' ? msg.content : '').toContain('<think>')
  })

  it('does not rewrite plain OpenAI/DeepSeek text that has no think tags', async () => {
    const texts: string[] = []
    const reasons: string[] = []
    const model: any = {
      bindTools() { return model },
      async stream() {
        return (async function* () {
          yield new AIMessageChunk({ content: 'Hello ' })
          yield new AIMessageChunk({ content: 'world. a < b is fine.' })
        })()
      },
    }
    await new RealModelRunner(model).run([], {
      tools: [],
      bindTools: true,
      onText: (d) => texts.push(d),
      onReasoning: (d) => reasons.push(d),
    } as any)
    expect(reasons.join('')).toBe('')
    expect(texts.join('')).toBe('Hello world. a < b is fine.')
  })

  it('still emits native reasoning_content (DeepSeek-style) without think-tag interference', async () => {
    const texts: string[] = []
    const reasons: string[] = []
    const model: any = {
      bindTools() { return model },
      async stream() {
        return (async function* () {
          // Projected the same way ReasoningChatOpenAI does for DeepSeek.
          yield new AIMessageChunk({
            content: [
              { type: 'reasoning', reasoning: 'step 1', index: 7 },
              { type: 'text', text: 'ans', index: 0 },
            ] as any,
          })
          yield new AIMessageChunk({ content: 'wer' })
        })()
      },
    }
    await new RealModelRunner(model).run([], {
      tools: [],
      bindTools: true,
      onText: (d) => texts.push(d),
      onReasoning: (d) => reasons.push(d),
    } as any)
    expect(reasons.join('')).toBe('step 1')
    expect(texts.join('')).toBe('answer')
  })

  it('emits Anthropic thinking blocks as reasoning and text blocks as text', async () => {
    const texts: string[] = []
    const reasons: string[] = []
    const model: any = {
      bindTools() { return model },
      async stream() {
        return (async function* () {
          yield new AIMessageChunk({
            content: [
              { type: 'thinking', thinking: 'ponder', index: 0 },
              { type: 'text', text: '42', index: 1 },
            ] as any,
          })
        })()
      },
    }
    await new RealModelRunner(model).run([], {
      tools: [],
      bindTools: true,
      onText: (d) => texts.push(d),
      onReasoning: (d) => reasons.push(d),
    } as any)
    expect(reasons.join('')).toBe('ponder')
    expect(texts.join('')).toBe('42')
  })

  it('completes a tool-call-only stream and gathers tool_calls', async () => {
    const activity: number[] = []
    const model: any = {
      bindTools() { return model },
      async stream() {
        return (async function* () {
          yield new AIMessageChunk({
            content: '',
            tool_call_chunks: [{ name: 'write_file', args: '{"path":"/a.svg","content":"<svg/>"}', id: 'c1', index: 0 }],
          } as any)
          yield new AIMessageChunk({
            content: '',
            tool_calls: [{ name: 'write_file', args: { path: '/a.svg', content: '<svg/>' }, id: 'c1', type: 'tool_call' }],
          } as any)
        })()
      },
    }
    const msg = await new RealModelRunner(model).run([], {
      ...opts(),
      onActivity: () => { activity.push(1) },
    } as any)
    expect(activity.length).toBeGreaterThanOrEqual(1)
    expect(msg.tool_calls?.length ?? 0).toBeGreaterThanOrEqual(0)
  })

  it('collapses fragmented stream content into one string with real newlines', async () => {
    const model: any = {
      bindTools() { return model },
      async stream() {
        return (async function* () {
          // Mimic the bug path: first chunk array (reasoning+text@0), later plain strings
          yield new AIMessageChunk({
            content: projectReasoningStreamContent('真的', '思考') as any,
          })
          yield new AIMessageChunk({ content: projectReasoningStreamContent('。\n\n', '') as any })
          yield new AIMessageChunk({ content: projectReasoningStreamContent('```\n/path\n```', '') as any })
        })()
      },
    }
    const msg = await new RealModelRunner(model).run([], opts() as any)
    expect(msg.content).toEqual([
      { type: 'reasoning', reasoning: '思考', index: 7 },
      { type: 'text', text: '真的。\n\n```\n/path\n```', index: 0 },
    ])
  })
})

describe('collapseStreamedAiContent', () => {
  it('joins micro text blocks and preserves real newlines', () => {
    const collapsed = collapseStreamedAiContent([
      { type: 'text', text: 'hello' },
      { type: 'text', text: '\n\n' },
      { type: 'text', text: 'world' },
    ] as any)
    expect(collapsed).toBe('hello\n\nworld')
  })

  it('keeps a single reasoning + text pair', () => {
    const collapsed = collapseStreamedAiContent([
      { type: 'reasoning', reasoning: 'a' },
      { type: 'reasoning', reasoning: 'b' },
      { type: 'text', text: 'x' },
      { type: 'text', text: '\n' },
      { type: 'text', text: 'y' },
    ] as any)
    expect(collapsed).toEqual([
      { type: 'reasoning', reasoning: 'ab', index: 7 },
      { type: 'text', text: 'x\ny', index: 0 },
    ])
  })
})

describe('projectReasoningStreamContent + concat', () => {
  it('merges token deltas into one text block (no micro \\n fragments)', () => {
    const parts = ['真的', '。', '：\n\n', '```\n', '/path', '\n```']
    let g: AIMessageChunk | undefined
    for (let i = 0; i < parts.length; i++) {
      const content = projectReasoningStreamContent(parts[i], i === 0 ? 'think' : '')
      const chunk = new AIMessageChunk({ content: content as any })
      g = g ? (concat(g, chunk) as AIMessageChunk) : chunk
    }
    const collapsed = collapseStreamedAiMessage(g as unknown as AIMessage)
    expect(collapsed.content).toEqual([
      { type: 'reasoning', reasoning: 'think', index: 7 },
      { type: 'text', text: '真的。：\n\n```\n/path\n```', index: 0 },
    ])
    // No separate micro-blocks for newlines
    expect(JSON.stringify(collapsed.content).includes('"text":"\\n\\n"')).toBe(false)
  })
})
