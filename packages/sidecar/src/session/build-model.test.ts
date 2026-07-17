import { describe, it, expect } from 'vitest'
import { ChatOpenAI } from '@langchain/openai'
import { ChatAnthropic } from '@langchain/anthropic'
import { resolveModelChoice } from './session.js' // pure helper extracted from buildModel
import {
  buildChatModel,
  ReasoningChatOpenAI,
  openAiReasoningEffort,
  anthropicOutputEffort,
} from './model-factory.js'

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
})
