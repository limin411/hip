import { describe, it, expect, vi, beforeEach } from 'vitest'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}))

import {
  isProviderKeyConfigured,
  areProviderKeysConfigured,
  hasSecretKeys,
  setSecretRaw,
  deleteSecretRaw,
  sshPasswordKey,
  sshPassphraseKey,
  saveProviderKey,
  clearProviderKey,
} from './secrets'

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

  it('saveProviderKey maps provider id through providerKeyEnv', async () => {
    invoke.mockResolvedValueOnce(undefined)
    await saveProviderKey('deepseek', 'sk-test')
    expect(invoke).toHaveBeenCalledWith('set_secret', {
      key: 'HIP_MODEL_DEEPSEEK_API_KEY',
      value: 'sk-test',
    })
  })

  it('clearProviderKey maps provider id through providerKeyEnv', async () => {
    invoke.mockResolvedValueOnce(undefined)
    await clearProviderKey('openai')
    expect(invoke).toHaveBeenCalledWith('delete_secret', {
      key: 'HIP_MODEL_OPENAI_API_KEY',
    })
  })

  it('sshPasswordKey / sshPassphraseKey format raw auth.json keys', () => {
    expect(sshPasswordKey('hst_1')).toBe('hip.ssh.hst_1.password')
    expect(sshPassphraseKey('hst_1')).toBe('hip.ssh.hst_1.passphrase')
  })

  it('hasSecretKeys uses has_secret_keys (raw) not has_secrets (provider-mapped)', async () => {
    invoke.mockResolvedValueOnce([true, false])
    const keys = ['hip.ssh.hst_1.password', 'hip.ssh.hst_1.passphrase']
    await expect(hasSecretKeys(keys)).resolves.toEqual({
      'hip.ssh.hst_1.password': true,
      'hip.ssh.hst_1.passphrase': false,
    })
    expect(invoke).toHaveBeenCalledWith('has_secret_keys', { keys })
    expect(invoke).not.toHaveBeenCalledWith('has_secrets', expect.anything())
  })

  it('setSecretRaw / deleteSecretRaw call existing raw set_secret / delete_secret', async () => {
    invoke.mockResolvedValue(undefined)
    await setSecretRaw('hip.ssh.hst_1.password', 's3cret')
    await deleteSecretRaw('hip.ssh.hst_1.password')
    expect(invoke).toHaveBeenNthCalledWith(1, 'set_secret', {
      key: 'hip.ssh.hst_1.password',
      value: 's3cret',
    })
    expect(invoke).toHaveBeenNthCalledWith(2, 'delete_secret', {
      key: 'hip.ssh.hst_1.password',
    })
  })
})
