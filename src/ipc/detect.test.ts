import { describe, it, expect, vi, beforeEach } from 'vitest'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }))

beforeEach(() => invoke.mockReset())

describe('detectBinaries', () => {
  it('passes names through and returns the install map', async () => {
    invoke.mockResolvedValueOnce({ opencode: true, kimi: false })
    const { detectBinaries } = await import('./detect')
    const got = await detectBinaries(['opencode', 'kimi'])
    expect(invoke).toHaveBeenCalledWith('which_binaries', { names: ['opencode', 'kimi'] })
    expect(got).toEqual({ opencode: true, kimi: false })
  })

  it('fails closed (returns {}) when the command errors', async () => {
    invoke.mockRejectedValueOnce(new Error('boom'))
    const { detectBinaries } = await import('./detect')
    expect(await detectBinaries(['opencode'])).toEqual({})
  })
})
