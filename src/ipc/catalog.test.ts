import { describe, it, expect } from 'vitest'
import { isCompatible } from './catalog'

describe('isCompatible', () => {
  it('accepts OpenAI + openai-compatible npm packages', () => {
    expect(isCompatible({ id: 'openai', name: 'OpenAI', npm: '@ai-sdk/openai', models: {}, env: [] })).toBe(true)
    expect(isCompatible({ id: 'x', name: 'X', npm: '@ai-sdk/openai-compatible', models: {}, env: [] })).toBe(true)
  })
  it('accepts allowlisted ids regardless of npm', () => {
    expect(isCompatible({ id: 'groq', name: 'Groq', npm: 'whatever', models: {}, env: [] })).toBe(true)
  })
  it('always accepts custom providers', () => {
    expect(isCompatible({ id: 'mine', name: 'Mine', models: {}, env: [], custom: true })).toBe(true)
  })
  it('rejects native-only vendors', () => {
    expect(isCompatible({ id: 'anthropic', name: 'Anthropic', npm: '@ai-sdk/anthropic', models: {}, env: [] })).toBe(false)
  })
})
