import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  DEFAULT_MODELS_LOGO_BASE,
  providerLogoUrl,
  shouldLoadProviderLogo,
  getCachedProviderLogo,
} from './providerLogo'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/core'
const mockInvoke = vi.mocked(invoke)

beforeEach(() => {
  mockInvoke.mockReset()
  mockInvoke.mockResolvedValue('data:image/svg+xml;base64,QUJD')
})

describe('providerLogoUrl', () => {
  it('builds models.dev logo URL for a normal id', () => {
    expect(providerLogoUrl('openai')).toBe('https://models.dev/logos/openai.svg')
    expect(providerLogoUrl('anthropic')).toBe(`${DEFAULT_MODELS_LOGO_BASE}/anthropic.svg`)
  })

  it('trims whitespace on id', () => {
    expect(providerLogoUrl('  groq  ')).toBe('https://models.dev/logos/groq.svg')
  })

  it('returns empty for empty id', () => {
    expect(providerLogoUrl('')).toBe('')
    expect(providerLogoUrl('   ')).toBe('')
  })

  it('rejects path separators and traversal', () => {
    expect(providerLogoUrl('../openai')).toBe('')
    expect(providerLogoUrl('a/b')).toBe('')
    expect(providerLogoUrl('foo\\bar')).toBe('')
    expect(providerLogoUrl('..')).toBe('')
  })

  it('encodeURIComponent for special characters', () => {
    expect(providerLogoUrl('foo bar')).toBe('https://models.dev/logos/foo%20bar.svg')
  })

  it('strips trailing slash from base', () => {
    expect(providerLogoUrl('openai', 'https://mirror.example/logos/')).toBe(
      'https://mirror.example/logos/openai.svg',
    )
  })
})

describe('shouldLoadProviderLogo', () => {
  it('is false for custom providers', () => {
    expect(shouldLoadProviderLogo({ id: 'my-proxy', custom: true })).toBe(false)
  })

  it('is true for catalog providers with safe ids', () => {
    expect(shouldLoadProviderLogo({ id: 'openai' })).toBe(true)
    expect(shouldLoadProviderLogo({ id: 'openai', custom: false })).toBe(true)
  })

  it('is false for empty or path-like ids (same gate as providerLogoUrl)', () => {
    expect(shouldLoadProviderLogo({ id: '' })).toBe(false)
    expect(shouldLoadProviderLogo({ id: 'a/b' })).toBe(false)
    expect(shouldLoadProviderLogo({ id: '../x' })).toBe(false)
    expect(shouldLoadProviderLogo({ id: 'foo\\bar' })).toBe(false)
  })

  it('respects custom logoBase for validation', () => {
    expect(shouldLoadProviderLogo({ id: 'openai' }, 'https://mirror.example/logos')).toBe(true)
  })
})

describe('getCachedProviderLogo', () => {
  it('invokes provider_logo once per provider and memoizes', async () => {
    await expect(getCachedProviderLogo('openai')).resolves.toBe('data:image/svg+xml;base64,QUJD')
    await expect(getCachedProviderLogo('openai')).resolves.toBe('data:image/svg+xml;base64,QUJD')
    expect(mockInvoke).toHaveBeenCalledTimes(1)
    expect(mockInvoke).toHaveBeenCalledWith('provider_logo', { providerId: 'openai' })
  })

  it('returns null for unsafe ids without invoking', async () => {
    await expect(getCachedProviderLogo('a/b')).resolves.toBeNull()
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('coerces invoke failures to null', async () => {
    mockInvoke.mockRejectedValue(new Error('command not registered'))
    await expect(getCachedProviderLogo('deepseek')).resolves.toBeNull()
  })
})
