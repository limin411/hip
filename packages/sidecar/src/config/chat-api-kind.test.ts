import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  anthropicMessagesBase,
  normalizeAnthropicApiUrl,
  resolveChatApiKind,
} from './chat-api-kind.js'

vi.mock('./catalog.js', () => ({
  readCatalog: vi.fn(() => ({})),
}))

import { readCatalog } from './catalog.js'

const mockReadCatalog = vi.mocked(readCatalog)

afterEach(() => {
  mockReadCatalog.mockReturnValue({})
})

describe('resolveChatApiKind', () => {
  it('returns anthropic for the official anthropic provider id', () => {
    expect(resolveChatApiKind('anthropic')).toBe('anthropic')
    expect(resolveChatApiKind('anthropic', 'https://api.anthropic.com/v1')).toBe('anthropic')
  })

  it('returns anthropic when catalog npm is @ai-sdk/anthropic', () => {
    mockReadCatalog.mockReturnValue({
      'minimax-cn-coding-plan': {
        id: 'minimax-cn-coding-plan',
        name: 'MiniMax Token Plan',
        npm: '@ai-sdk/anthropic',
        api: 'https://api.minimaxi.com/anthropic/v1',
        models: {},
      },
    })
    expect(resolveChatApiKind('minimax-cn-coding-plan', 'https://api.minimaxi.com/anthropic/v1')).toBe(
      'anthropic',
    )
  })

  it('returns anthropic for kimi-for-coding via catalog npm (URL has no /anthropic)', () => {
    mockReadCatalog.mockReturnValue({
      'kimi-for-coding': {
        id: 'kimi-for-coding',
        name: 'Kimi for Coding',
        npm: '@ai-sdk/anthropic',
        api: 'https://api.kimi.com/coding/v1',
        models: {},
      },
    })
    expect(resolveChatApiKind('kimi-for-coding', 'https://api.kimi.com/coding/v1')).toBe('anthropic')
  })

  it('returns anthropic for custom providers when baseURL path contains /anthropic', () => {
    expect(
      resolveChatApiKind('my-minimax', 'https://api.minimaxi.com/anthropic/v1'),
    ).toBe('anthropic')
    expect(resolveChatApiKind('my-minimax', 'https://proxy.example/anthropic')).toBe('anthropic')
  })

  it('returns openai for OpenAI-compatible providers', () => {
    mockReadCatalog.mockReturnValue({
      deepseek: {
        id: 'deepseek',
        name: 'DeepSeek',
        npm: '@ai-sdk/openai-compatible',
        api: 'https://api.deepseek.com/v1',
        models: {},
      },
    })
    expect(resolveChatApiKind('deepseek', 'https://api.deepseek.com/v1')).toBe('openai')
    expect(resolveChatApiKind('openai', 'https://api.openai.com/v1')).toBe('openai')
  })

  it('does not treat /anthropic as a hostname substring without path segment', () => {
    // path-based heuristic only; "anthropic" as a subdomain alone is not enough
    expect(resolveChatApiKind('custom', 'https://anthropic.example.com/v1')).toBe('openai')
  })
})

describe('normalizeAnthropicApiUrl', () => {
  it('returns undefined for empty input', () => {
    expect(normalizeAnthropicApiUrl(undefined)).toBeUndefined()
    expect(normalizeAnthropicApiUrl('')).toBeUndefined()
    expect(normalizeAnthropicApiUrl('   ')).toBeUndefined()
  })

  it('strips trailing /v1 for MiniMax-style catalog bases', () => {
    expect(normalizeAnthropicApiUrl('https://api.minimaxi.com/anthropic/v1')).toBe(
      'https://api.minimaxi.com/anthropic',
    )
    expect(normalizeAnthropicApiUrl('https://api.minimaxi.com/anthropic/v1/')).toBe(
      'https://api.minimaxi.com/anthropic',
    )
  })

  it('leaves bases that already omit /v1', () => {
    expect(normalizeAnthropicApiUrl('https://api.minimaxi.com/anthropic')).toBe(
      'https://api.minimaxi.com/anthropic',
    )
  })

  it('strips /v1 from generic Anthropic-compatible hosts', () => {
    expect(normalizeAnthropicApiUrl('https://api.kimi.com/coding/v1')).toBe(
      'https://api.kimi.com/coding',
    )
  })
})

describe('anthropicMessagesBase', () => {
  it('defaults to the official Anthropic /v1 base', () => {
    expect(anthropicMessagesBase()).toBe('https://api.anthropic.com/v1')
    expect(anthropicMessagesBase('')).toBe('https://api.anthropic.com/v1')
  })

  it('keeps catalog bases that already end with /v1', () => {
    expect(anthropicMessagesBase('https://api.minimaxi.com/anthropic/v1')).toBe(
      'https://api.minimaxi.com/anthropic/v1',
    )
  })

  it('appends /v1 when the host omits it (MiniMax env style)', () => {
    expect(anthropicMessagesBase('https://api.minimaxi.com/anthropic')).toBe(
      'https://api.minimaxi.com/anthropic/v1',
    )
  })
})
