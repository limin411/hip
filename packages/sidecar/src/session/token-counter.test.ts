import { describe, it, expect, vi } from 'vitest'
import { HumanMessage, AIMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages'
import {
  TokenCounter,
  pickStrategy,
  PER_MESSAGE_TOKENS,
  HEURISTIC_CHARS_PER_TOKEN,
  type ModuleLoader,
  type ActiveModelInfo,
} from './token-counter.js'

/** Build a fake HF transformers module whose tokenizer emits a deterministic token count per call. */
function fakeHfModule(tokenCountFor: (text: string) => number): { module: object; calls: string[] } {
  const calls: string[] = []
  const fakeTokenizer = (text: string): { input_ids: { size: number; data: number[] } } => ({
    input_ids: { size: tokenCountFor(text), data: Array.from({ length: tokenCountFor(text) }, (_, i) => 1000 + i) },
  })
  const module = {
    env: { cacheDir: '' },
    AutoTokenizer: {
      async from_pretrained(repo: string): Promise<(text: string) => { input_ids: { size: number; data: number[] } }> {
        calls.push(repo)
        return fakeTokenizer
      },
    },
  }
  return { module, calls }
}

/** Build a fake gpt-tokenizer module that emits deterministic token counts. */
function fakeGptModule(tokenCountFor: (text: string) => number): object {
  return {
    encode: (text: string): number[] => Array.from({ length: tokenCountFor(text) }, (_, i) => 2000 + i),
    decode: (ids: number[]): string => ids.map(() => 'x').join(''),
  }
}

const detectFactory = (info: ActiveModelInfo) => (): ActiveModelInfo => info

describe('pickStrategy', () => {
  it('routes OpenAI provider to gpt-tokenizer BPE', () => {
    expect(pickStrategy({ providerID: 'openai', modelID: 'gpt-4o' })).toBe('openai-bpe')
  })
  it('routes modelID containing gpt- to openai-bpe regardless of provider', () => {
    expect(pickStrategy({ providerID: 'azure', modelID: 'gpt-35-turbo' })).toBe('openai-bpe')
  })
  it('routes DeepSeek provider to deepseek-bpe', () => {
    expect(pickStrategy({ providerID: 'deepseek', modelID: 'deepseek-chat' })).toBe('deepseek-bpe')
  })
  it('routes modelID containing deepseek to deepseek-bpe regardless of provider', () => {
    expect(pickStrategy({ providerID: 'custom', modelID: 'deepseek-v3' })).toBe('deepseek-bpe')
  })
  it('routes Anthropic to heuristic (async API not used)', () => {
    expect(pickStrategy({ providerID: 'anthropic', modelID: 'claude-3-opus' })).toBe('heuristic')
  })
  it('routes unknown providers to heuristic', () => {
    expect(pickStrategy({ providerID: 'mistral', modelID: 'mistral-large' })).toBe('heuristic')
  })
})

describe('TokenCounter.countMessages', () => {
  it('returns 0 for an empty message list (malformed input)', async () => {
    const counter = new TokenCounter(detectFactory({ providerID: 'openai', modelID: 'gpt-4' }))
    expect(await counter.countMessages([])).toBe(0)
  })

  it('returns a positive count for a 5-message conversation', async () => {
    const counter = new TokenCounter(detectFactory({ providerID: 'openai', modelID: 'gpt-4' }))
    const messages: BaseMessage[] = [
      new SystemMessage('you are hip'),
      new HumanMessage('hello world'),
      new AIMessage('hi there'),
      new HumanMessage('write a poem'),
      new AIMessage('roses are red'),
    ]
    const n = await counter.countMessages(messages)
    expect(n).toBeGreaterThan(0)
  })

  it('OpenAI BPE differs from chars/4 heuristic by >10% on realistic text', async () => {
    // Long English text: BPE merges common words, so BPE count < chars/4 by a wide margin.
    const text = 'antidisestablishmentarianism is a long word; tokenization differences are measurable here.'
    const messages: BaseMessage[] = [new HumanMessage(text)]
    const counter = new TokenCounter(detectFactory({ providerID: 'openai', modelID: 'gpt-4' }))
    const bpe = await counter.countMessages(messages)
    // chars/4 baseline for the same body + per-message overhead
    const heuristicBody = Math.ceil(text.length / HEURISTIC_CHARS_PER_TOKEN)
    const heuristic = heuristicBody + PER_MESSAGE_TOKENS
    const diffPct = Math.abs(bpe - heuristic) / heuristic
    expect(diffPct).toBeGreaterThan(0.1)
  })

  it('unknown model is within ±20% of chars/4 heuristic', async () => {
    const text = 'a brown fox jumps over the lazy dog near the riverbank at dawn'
    const messages: BaseMessage[] = [new HumanMessage(text)]
    const counter = new TokenCounter(detectFactory({ providerID: 'mistral', modelID: 'mistral-large' }))
    const n = await counter.countMessages(messages)
    const heuristicBody = Math.ceil(text.length / HEURISTIC_CHARS_PER_TOKEN)
    const heuristic = heuristicBody + PER_MESSAGE_TOKENS
    const diffPct = Math.abs(n - heuristic) / heuristic
    expect(diffPct).toBeLessThanOrEqual(0.2)
  })

  it('adds PER_MESSAGE_TOKENS overhead per message (5 messages → 15 tokens of overhead)', async () => {
    // Empty bodies → the only contribution is the per-message overhead.
    const messages: BaseMessage[] = [
      new HumanMessage(''),
      new HumanMessage(''),
      new HumanMessage(''),
      new HumanMessage(''),
      new HumanMessage(''),
    ]
    const counter = new TokenCounter(detectFactory({ providerID: 'openai', modelID: 'gpt-4' }))
    const n = await counter.countMessages(messages)
    expect(n).toBe(PER_MESSAGE_TOKENS * messages.length)
  })

  it('lazy loading: first DeepSeek call triggers download, second uses cache', async () => {
    const { module, calls } = fakeHfModule((t) => Math.ceil(t.length / 3))
    const loader: ModuleLoader = vi.fn(async (name) =>
      name === '@huggingface/transformers' ? module : fakeGptModule((t) => Math.ceil(t.length / 3)),
    )
    const counter = new TokenCounter(
      detectFactory({ providerID: 'deepseek', modelID: 'deepseek-chat' }),
      { loadModule: loader, cacheDir: '/tmp/hip-test-tokenizers' },
    )
    const msg = [new HumanMessage('你好世界')]
    await counter.countMessages(msg)
    expect(calls).toHaveLength(1)
    await counter.countMessages(msg)
    // Second call must NOT trigger another from_pretrained — cached.
    expect(calls).toHaveLength(1)
  })

  it('stale state: tokenizer cache invalidated on provider switch', async () => {
    const { module: hfModule, calls: hfCalls } = fakeHfModule((t) => Math.ceil(t.length / 3))
    let current: ActiveModelInfo = { providerID: 'deepseek', modelID: 'deepseek-chat' }
    const loader: ModuleLoader = vi.fn(async (name) =>
      name === '@huggingface/transformers' ? hfModule : fakeGptModule((t) => Math.ceil(t.length / 3)),
    )
    const counter = new TokenCounter(() => current, { loadModule: loader, cacheDir: '/tmp/hip-test-tokenizers' })
    const msg = [new HumanMessage('hello')]
    await counter.countMessages(msg)
    expect(hfCalls).toHaveLength(1)
    // Switch provider → strategy changes → HF cache invalidated on next access (not re-fetched unless
    // we go back to DeepSeek).
    current = { providerID: 'openai', modelID: 'gpt-4' }
    await counter.countMessages(msg)
    expect(hfCalls).toHaveLength(1) // not refetched during openai call
    // Switch back to DeepSeek → cache was invalidated → refetch required.
    current = { providerID: 'deepseek', modelID: 'deepseek-chat' }
    await counter.countMessages(msg)
    expect(hfCalls).toHaveLength(2)
  })

  it('hung command: HF download timeout falls back to chars/4 heuristic', async () => {
    // Loader that never resolves. TokenCounter must apply its timeout and fall back.
    const loader: ModuleLoader = vi.fn(async () => new Promise(() => { /* never resolves */ }))
    const counter = new TokenCounter(
      detectFactory({ providerID: 'deepseek', modelID: 'deepseek-chat' }),
      { loadModule: loader, cacheDir: '/tmp/hip-test-tokenizers', loadTimeoutMs: 50 },
    )
    const n = await counter.countMessages([new HumanMessage('hello world')])
    // heuristic body = ceil(11/4) = 3, +3 overhead = 6
    expect(n).toBe(6)
  })

  it('module load failure falls back to heuristic (no crash)', async () => {
    const loader: ModuleLoader = vi.fn(async () => { throw new Error('module missing') })
    const counter = new TokenCounter(
      detectFactory({ providerID: 'openai', modelID: 'gpt-4' }),
      { loadModule: loader },
    )
    const n = await counter.countMessages([new HumanMessage('hello world')])
    // Fallback: ceil(11/4) = 3 + 3 overhead = 6
    expect(n).toBe(6)
  })

  it('handles null/empty content without crashing', async () => {
    const messages: BaseMessage[] = [
      // @langchain allows null-ish content; coerce to empty via the same path.
      new HumanMessage({ content: '' }),
      new AIMessage({ content: '' }),
    ]
    const counter = new TokenCounter(detectFactory({ providerID: 'openai', modelID: 'gpt-4' }))
    const n = await counter.countMessages(messages)
    expect(n).toBe(PER_MESSAGE_TOKENS * 2)
  })

  it('handles a very large message without crashing', async () => {
    const big = 'a'.repeat(100_000)
    const counter = new TokenCounter(detectFactory({ providerID: 'openai', modelID: 'gpt-4' }))
    const n = await counter.countMessages([new HumanMessage(big)])
    // gpt-tokenizer encodes 'a' runs densely; just assert it's positive and proportional.
    expect(n).toBeGreaterThan(big.length / 10)
  })
})
