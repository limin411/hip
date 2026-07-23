import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ChatOpenAI } from '@langchain/openai'
import { ChatAnthropic } from '@langchain/anthropic'
import { resolveModelChoice } from './session.js' // pure helper extracted from buildModel
import {
  buildChatModel,
  ReasoningChatOpenAI,
  openAiReasoningEffort,
  anthropicOutputEffort,
  MissingApiKeyError,
  activeKey,
} from './model-factory.js'

vi.mock('../config/catalog.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config/catalog.js')>()
  return {
    ...actual,
    readCatalog: vi.fn(() => ({})),
    clampEffortForModel: vi.fn((_p: string, _m: string, effort: string | undefined) => effort),
  }
})

import { readCatalog } from '../config/catalog.js'

const mockReadCatalog = vi.mocked(readCatalog)

/** Seed HIP keys so buildChatModel tests do not hit MissingApiKeyError. */
const TEST_KEYS = [
  'HIP_MODEL_DEEPSEEK_API_KEY',
  'HIP_MODEL_ANTHROPIC_API_KEY',
  'HIP_MODEL_OPENAI_API_KEY',
  'HIP_MODEL_MINIMAX_CN_CODING_PLAN_API_KEY',
  'HIP_MODEL_MY_GATEWAY_API_KEY',
  'HIP_MODEL_MY_PROXY_API_KEY',
] as const

const savedKeys: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of TEST_KEYS) {
    savedKeys[k] = process.env[k]
    process.env[k] = 'sk-test-build-model'
  }
  // Ensure auth.json tombstone path does not block test env (HIP_AUTH_PATH from vitest.setup).
})

afterEach(() => {
  mockReadCatalog.mockReturnValue({})
  for (const k of TEST_KEYS) {
    if (savedKeys[k] === undefined) delete process.env[k]
    else process.env[k] = savedKeys[k]
  }
})

describe('resolveModelChoice', () => {
  const fallback = { providerID: 'deepseek', modelID: 'deepseek-reasoner', baseURL: 'https://api.deepseek.com/v1' }
  it('uses the session config model when present', () => {
    const c = resolveModelChoice({ llmProvider: 'openai', model: 'gpt-4o', baseURL: 'https://api.openai.com/v1' }, fallback)
    expect(c).toEqual({ providerID: 'openai', modelID: 'gpt-4o', baseURL: 'https://api.openai.com/v1' })
  })
  it('falls back to the global active model when config.model is empty', () => {
    const c = resolveModelChoice({ llmProvider: 'deepseek', model: '' }, fallback)
    expect(c).toEqual(fallback)
  })
  it('falls back to active baseURL when config.baseURL is missing', () => {
    const c = resolveModelChoice({ llmProvider: 'openai', model: 'gpt-4o' }, fallback)
    expect(c).toEqual({ providerID: 'openai', modelID: 'gpt-4o', baseURL: 'https://api.deepseek.com/v1' })
  })
})

describe('effort normalization', () => {
  it('openAiReasoningEffort admits SDK values and drops unknowns', () => {
    expect(openAiReasoningEffort('high')).toBe('high')
    expect(openAiReasoningEffort('none')).toBe('none')
    expect(openAiReasoningEffort('max')).toBeUndefined()
    expect(openAiReasoningEffort(undefined)).toBeUndefined()
  })
  it('anthropicOutputEffort maps minimal→low and drops none', () => {
    expect(anthropicOutputEffort('max')).toBe('max')
    expect(anthropicOutputEffort('minimal')).toBe('low')
    expect(anthropicOutputEffort('none')).toBeUndefined()
    expect(anthropicOutputEffort(undefined)).toBeUndefined()
  })
})

describe('buildChatModel routing', () => {
  it('returns ReasoningChatOpenAI for deepseek provider', () => {
    const model = buildChatModel({
      providerID: 'deepseek',
      modelID: 'deepseek-chat',
      baseURL: 'https://api.deepseek.com/v1',
    })
    expect(model).toBeInstanceOf(ChatOpenAI)
    expect(model).toBeInstanceOf(ReasoningChatOpenAI)
  })

  it('returns ChatAnthropic for anthropic provider', () => {
    const model = buildChatModel({
      providerID: 'anthropic',
      modelID: 'claude-3-haiku-20240307',
      baseURL: '',
    })
    expect(model).toBeInstanceOf(ChatAnthropic)
  })

  it('returns ReasoningChatOpenAI for openai-compatible providers (default branch)', () => {
    const model = buildChatModel({
      providerID: 'openai',
      modelID: 'gpt-4o',
      baseURL: 'https://api.openai.com/v1',
    })
    expect(model).toBeInstanceOf(ReasoningChatOpenAI)
  })

  it('applies reasoning.effort on OpenAI-compatible models when effort is set', () => {
    const model = buildChatModel({
      providerID: 'openai',
      modelID: 'gpt-5.4',
      baseURL: 'https://api.openai.com/v1',
      effort: 'high',
    }) as ReasoningChatOpenAI
    expect(model).toBeInstanceOf(ReasoningChatOpenAI)
    const fields = (model as unknown as { fields?: { reasoning?: { effort?: string } } }).fields
    expect(fields?.reasoning?.effort).toBe('high')
  })

  it('applies outputConfig.effort on Anthropic when effort is set', () => {
    const model = buildChatModel({
      providerID: 'anthropic',
      modelID: 'claude-opus-4-8',
      baseURL: '',
      effort: 'max',
    }) as ChatAnthropic
    expect(model).toBeInstanceOf(ChatAnthropic)
    const m = model as unknown as { outputConfig?: { effort?: string }; thinking?: { type?: string } }
    expect(m.outputConfig?.effort).toBe('max')
    expect(m.thinking?.type).toBe('adaptive')
  })

  it('returns ChatAnthropic for catalog @ai-sdk/anthropic providers (MiniMax)', () => {
    mockReadCatalog.mockReturnValue({
      'minimax-cn-coding-plan': {
        id: 'minimax-cn-coding-plan',
        name: 'MiniMax Token Plan',
        npm: '@ai-sdk/anthropic',
        api: 'https://api.minimaxi.com/anthropic/v1',
        models: { 'MiniMax-M3': { id: 'MiniMax-M3', name: 'MiniMax-M3' } },
      },
    })
    const model = buildChatModel({
      providerID: 'minimax-cn-coding-plan',
      modelID: 'MiniMax-M3',
      baseURL: 'https://api.minimaxi.com/anthropic/v1',
    }) as ChatAnthropic
    expect(model).toBeInstanceOf(ChatAnthropic)
    // Catalog api ends with /v1; SDK base must omit it to avoid …/v1/v1/messages.
    expect(model.apiUrl).toBe('https://api.minimaxi.com/anthropic')
    // Claude-only effort knobs must not be forced on third-party Anthropic hosts.
    const m = model as unknown as { outputConfig?: { effort?: string }; thinking?: { type?: string } }
    expect(m.outputConfig).toBeUndefined()
    // LangChain defaults thinking to { type: 'disabled' }; we must not force adaptive.
    expect(m.thinking?.type).not.toBe('adaptive')
  })

  it('returns ChatAnthropic for custom baseURL with /anthropic path', () => {
    const model = buildChatModel({
      providerID: 'my-gateway',
      modelID: 'MiniMax-M3',
      baseURL: 'https://api.minimaxi.com/anthropic/v1',
    }) as ChatAnthropic
    expect(model).toBeInstanceOf(ChatAnthropic)
    expect(model.apiUrl).toBe('https://api.minimaxi.com/anthropic')
  })

  it('keeps openai-compatible catalog providers on ReasoningChatOpenAI (deepseek/openai)', () => {
    mockReadCatalog.mockReturnValue({
      deepseek: {
        id: 'deepseek',
        name: 'DeepSeek',
        npm: '@ai-sdk/openai-compatible',
        api: 'https://api.deepseek.com/v1',
        models: {},
      },
      openai: {
        id: 'openai',
        name: 'OpenAI',
        npm: '@ai-sdk/openai',
        api: 'https://api.openai.com/v1',
        models: {},
      },
    })
    expect(
      buildChatModel({
        providerID: 'deepseek',
        modelID: 'deepseek-chat',
        baseURL: 'https://api.deepseek.com/v1',
      }),
    ).toBeInstanceOf(ReasoningChatOpenAI)
    expect(
      buildChatModel({
        providerID: 'openai',
        modelID: 'gpt-4o',
        baseURL: 'https://api.openai.com/v1',
      }),
    ).toBeInstanceOf(ReasoningChatOpenAI)
  })

  it('does not treat a custom OpenAI base URL as Anthropic without /anthropic path', () => {
    const model = buildChatModel({
      providerID: 'my-proxy',
      modelID: 'gpt-4o',
      baseURL: 'https://gateway.example.com/v1',
    })
    expect(model).toBeInstanceOf(ReasoningChatOpenAI)
    expect(model).not.toBeInstanceOf(ChatAnthropic)
  })

  it('throws MissingApiKeyError instead of using sk-missing', () => {
    delete process.env.HIP_MODEL_DEEPSEEK_API_KEY
    delete process.env.DEEPSEEK_API_KEY
    // Point at an empty auth file so no file / standard / hip key remains.
    const prevAuth = process.env.HIP_AUTH_PATH
    process.env.HIP_AUTH_PATH = join(tmpdir(), '__hip_no_auth_missing_key__', 'auth.json')
    try {
      expect(() => activeKey('deepseek')).toThrow(MissingApiKeyError)
      expect(() =>
        buildChatModel({
          providerID: 'deepseek',
          modelID: 'deepseek-chat',
          baseURL: 'https://api.deepseek.com/v1',
        }),
      ).toThrow(MissingApiKeyError)
    } finally {
      if (prevAuth === undefined) delete process.env.HIP_AUTH_PATH
      else process.env.HIP_AUTH_PATH = prevAuth
    }
  })
})
