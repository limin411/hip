import { describe, it, expect } from 'vitest'
import {
  memoryModelKey,
  memoryModelRefFromKey,
} from './memoryModelRef.js'

describe('memoryModelKey', () => {
  it('formats ref and string keys', () => {
    expect(memoryModelKey(undefined)).toBe('')
    expect(memoryModelKey('openai/gpt-4o-mini')).toBe('openai/gpt-4o-mini')
    expect(memoryModelKey({ providerID: 'openai', modelID: 'gpt-4o-mini' })).toBe('openai/gpt-4o-mini')
  })
})

describe('memoryModelRefFromKey', () => {
  it('builds ref and clears empty', () => {
    expect(memoryModelRefFromKey('')).toBeUndefined()
    expect(memoryModelRefFromKey('openai/gpt-4o-mini')).toEqual({
      providerID: 'openai',
      modelID: 'gpt-4o-mini',
    })
    expect(memoryModelRefFromKey('openai/gpt-4o-mini', 'https://api.openai.com/v1')).toEqual({
      providerID: 'openai',
      modelID: 'gpt-4o-mini',
      baseURL: 'https://api.openai.com/v1',
    })
  })
})

