import { describe, expect, it } from 'vitest'
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages'
import {
  EPHEMERAL_CACHE_CONTROL,
  applyAnthropicMessageCacheBreakpoints,
  applyAnthropicToolCacheBreakpoints,
  resolveCachePolicy,
  resolveOpenAiPromptCacheKey,
  resolvePromptCacheKeyMode,
  sessionIdFromMetadata,
  supportsOpenAiPromptCacheKey,
  withEphemeralCacheControl,
} from './cache-policy.js'
import { prepareAnthropicMessages } from './anthropic-messages.js'

function textBlockCache(content: unknown): unknown {
  if (!Array.isArray(content)) return undefined
  const lastText = [...content].reverse().find(
    (b) => b && typeof b === 'object' && (b as { type?: string }).type === 'text',
  )
  return lastText && typeof lastText === 'object'
    ? (lastText as { cache_control?: unknown }).cache_control
    : undefined
}

describe('resolveCachePolicy', () => {
  it('defaults to auto', () => {
    expect(resolveCachePolicy()).toBe('auto')
    expect(resolveCachePolicy(undefined)).toBe('auto')
    expect(resolveCachePolicy(null)).toBe('auto')
    expect(resolveCachePolicy('')).toBe('auto')
    expect(resolveCachePolicy('auto')).toBe('auto')
  })

  it('accepts none and off aliases', () => {
    expect(resolveCachePolicy('none')).toBe('none')
    expect(resolveCachePolicy('off')).toBe('none')
    expect(resolveCachePolicy('OFF')).toBe('none')
    expect(resolveCachePolicy('0')).toBe('none')
    expect(resolveCachePolicy('false')).toBe('none')
  })
})

describe('resolvePromptCacheKeyMode', () => {
  it('defaults to session; none disables', () => {
    expect(resolvePromptCacheKeyMode()).toBe('session')
    expect(resolvePromptCacheKeyMode('session')).toBe('session')
    expect(resolvePromptCacheKeyMode('none')).toBe('none')
    expect(resolvePromptCacheKeyMode('off')).toBe('none')
  })
})

describe('applyAnthropicMessageCacheBreakpoints', () => {
  it('auto marks last system and latest user with ephemeral cache_control', () => {
    const out = applyAnthropicMessageCacheBreakpoints(
      [
        new SystemMessage('sys'),
        new HumanMessage('first user'),
        new AIMessage('assistant'),
        new HumanMessage('latest user'),
      ],
      'auto',
    )
    expect(out).toHaveLength(4)
    expect(textBlockCache(out[0]!.content)).toEqual(EPHEMERAL_CACHE_CONTROL)
    expect(textBlockCache(out[1]!.content)).toBeUndefined()
    expect(textBlockCache(out[3]!.content)).toEqual(EPHEMERAL_CACHE_CONTROL)
    // system text preserved
    const sys = out[0]!.content as Array<{ text?: string }>
    expect(sys[0]?.text).toBe('sys')
    const user = out[3]!.content as Array<{ text?: string }>
    expect(user[0]?.text).toBe('latest user')
  })

  it('none is a no-op (identity)', () => {
    const msgs = [new SystemMessage('sys'), new HumanMessage('hi')]
    const out = applyAnthropicMessageCacheBreakpoints(msgs, 'none')
    expect(out).toBe(msgs)
    expect(typeof out[0]!.content).toBe('string')
  })

  it('off alias is a no-op', () => {
    const msgs = [new SystemMessage('sys'), new HumanMessage('hi')]
    expect(applyAnthropicMessageCacheBreakpoints(msgs, 'off')).toBe(msgs)
  })

  it('preserves existing cache_control without duplicating', () => {
    const marked = new SystemMessage({
      content: [{ type: 'text', text: 'sys', cache_control: { type: 'ephemeral', ttl: '1h' } }],
    })
    const out = applyAnthropicMessageCacheBreakpoints([marked, new HumanMessage('hi')], 'auto')
    // system already marked → same content reference path for system
    expect((out[0]!.content as Array<{ cache_control?: unknown }>)[0]?.cache_control).toEqual({
      type: 'ephemeral',
      ttl: '1h',
    })
    expect(textBlockCache(out[1]!.content)).toEqual(EPHEMERAL_CACHE_CONTROL)
  })
})

describe('prepareAnthropicMessages (serialization boundary)', () => {
  it('coalesces multi-system then attaches breakpoints', () => {
    const out = prepareAnthropicMessages(
      [
        new SystemMessage('main'),
        new SystemMessage('ctx'),
        new HumanMessage('hi'),
      ],
      { cachePolicy: 'auto' },
    )
    expect(out).toHaveLength(2)
    expect(out[0]!.getType()).toBe('system')
    const sys = out[0]!.content as Array<{ type: string; text: string; cache_control?: unknown }>
    expect(sys).toHaveLength(1)
    expect(sys[0]!.text).toContain('main')
    expect(sys[0]!.text).toContain('ctx')
    expect(sys[0]!.cache_control).toEqual(EPHEMERAL_CACHE_CONTROL)
    expect(textBlockCache(out[1]!.content)).toEqual(EPHEMERAL_CACHE_CONTROL)
  })

  it('cachePolicy none coalesces without breakpoints', () => {
    const out = prepareAnthropicMessages(
      [new SystemMessage('a'), new SystemMessage('b'), new HumanMessage('hi')],
      { cachePolicy: 'none' },
    )
    expect(out).toHaveLength(2)
    expect(typeof out[0]!.content).toBe('string')
    expect(String(out[0]!.content)).toBe('a\n\nb')
    expect(typeof out[1]!.content).toBe('string')
  })
})

describe('applyAnthropicToolCacheBreakpoints', () => {
  it('marks last native anthropic-shaped tool', () => {
    const tools = [
      { name: 't1', description: 'd1', input_schema: { type: 'object', properties: {} } },
      { name: 't2', description: 'd2', input_schema: { type: 'object', properties: {} } },
    ]
    const out = applyAnthropicToolCacheBreakpoints(tools, 'auto')
    expect(out[0]).not.toHaveProperty('cache_control')
    expect(out[1]).toMatchObject({ name: 't2', cache_control: EPHEMERAL_CACHE_CONTROL })
    // non-mutating
    expect(tools[1]).not.toHaveProperty('cache_control')
  })

  it('marks last LangChain-like tool via extras', () => {
    const tools = [
      { name: 'a', description: 'a', schema: { type: 'object' }, lc_namespace: ['x'] },
      { name: 'b', description: 'b', schema: { type: 'object' }, lc_namespace: ['x'] },
    ]
    const out = applyAnthropicToolCacheBreakpoints(tools, 'auto')
    expect((out[1] as { extras?: { cache_control?: unknown } }).extras?.cache_control).toEqual(
      EPHEMERAL_CACHE_CONTROL,
    )
    expect((tools[1] as { extras?: unknown }).extras).toBeUndefined()
  })

  it('none is a no-op', () => {
    const tools = [{ name: 't', description: 'd', input_schema: { type: 'object' } }]
    expect(applyAnthropicToolCacheBreakpoints(tools, 'none')).toBe(tools)
  })
})

describe('OpenAI prompt_cache_key feature-detect', () => {
  it('supports ChatOpenAI / ReasoningChatOpenAI by constructor name', () => {
    class ChatOpenAI {}
    class ReasoningChatOpenAI {}
    class ChatAnthropic {}
    expect(supportsOpenAiPromptCacheKey(new ChatOpenAI())).toBe(true)
    expect(supportsOpenAiPromptCacheKey(new ReasoningChatOpenAI())).toBe(true)
    expect(supportsOpenAiPromptCacheKey(new ChatAnthropic())).toBe(false)
    expect(supportsOpenAiPromptCacheKey({})).toBe(false)
    expect(supportsOpenAiPromptCacheKey(null)).toBe(false)
  })

  it('resolves session id when supported + auto', () => {
    class ChatOpenAI {
      promptCacheKey?: string
    }
    expect(
      resolveOpenAiPromptCacheKey({
        model: new ChatOpenAI(),
        sessionId: 'sess-1',
        cachePolicy: 'auto',
      }),
    ).toBe('sess-1')
  })

  it('unsupported client → no-op (undefined)', () => {
    class ChatAnthropic {}
    expect(
      resolveOpenAiPromptCacheKey({
        model: new ChatAnthropic(),
        sessionId: 'sess-1',
        cachePolicy: 'auto',
      }),
    ).toBeUndefined()
    expect(
      resolveOpenAiPromptCacheKey({
        model: { totally: 'unknown' },
        sessionId: 'sess-1',
        cachePolicy: 'auto',
      }),
    ).toBeUndefined()
  })

  it('none policy or missing sessionId → no-op', () => {
    class ChatOpenAI {
      promptCacheKey?: string
    }
    const model = new ChatOpenAI()
    expect(
      resolveOpenAiPromptCacheKey({ model, sessionId: 's', cachePolicy: 'none' }),
    ).toBeUndefined()
    expect(
      resolveOpenAiPromptCacheKey({ model, sessionId: '', cachePolicy: 'auto' }),
    ).toBeUndefined()
    expect(
      resolveOpenAiPromptCacheKey({
        model,
        sessionId: 's',
        cachePolicy: 'auto',
        promptCacheKeyMode: 'none',
      }),
    ).toBeUndefined()
  })

  it('sessionIdFromMetadata reads sessionId / session_id', () => {
    expect(sessionIdFromMetadata({ sessionId: 'a' })).toBe('a')
    expect(sessionIdFromMetadata({ session_id: 'b' })).toBe('b')
    expect(sessionIdFromMetadata({})).toBeUndefined()
  })
})

describe('withEphemeralCacheControl', () => {
  it('wraps string content as text block with cache_control', () => {
    expect(withEphemeralCacheControl('hello')).toEqual([
      { type: 'text', text: 'hello', cache_control: EPHEMERAL_CACHE_CONTROL },
    ])
  })
})
