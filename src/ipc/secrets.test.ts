import { describe, it, expect, vi, beforeEach } from 'vitest'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}))

import { isProviderKeyConfigured, areProviderKeysConfigured } from './secrets'

describe('secrets IPC', () => {
  beforeEach(() => {
    invoke.mockReset()
  })

  it('isProviderKeyConfigured uses has_secrets with provider id (not env key / has_secret)', async () => {
    invoke.mockResolvedValueOnce({ deepseek: true })
    await expect(isProviderKeyConfigured('deepseek')).resolves.toBe(true)
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('has_secrets', { keys: ['deepseek'] })
  })

  it('isProviderKeyConfigured returns false when key missing', async () => {
    invoke.mockResolvedValueOnce({ openai: false })
    await expect(isProviderKeyConfigured('openai')).resolves.toBe(false)
  })

  it('areProviderKeysConfigured batches provider ids', async () => {
    invoke.mockResolvedValueOnce({ deepseek: true, openai: false })
    await expect(areProviderKeysConfigured(['deepseek', 'openai'])).resolves.toEqual({
      deepseek: true,
      openai: false,
    })
    expect(invoke).toHaveBeenCalledWith('has_secrets', { keys: ['deepseek', 'openai'] })
  })
})
