import { describe, it, expect, vi, beforeEach } from 'vitest'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }))

beforeEach(() => invoke.mockReset())

describe('networkPolicy IPC', () => {
  it('getNetworkPolicy parses a valid config', async () => {
    const { getNetworkPolicy } = await import('./networkPolicy.js')
    invoke.mockResolvedValueOnce(
      JSON.stringify({
        allowlist: ['*.github.com'],
        denylist: ['evil.com'],
        maxRequestsPerMinute: 20,
        maxResponseBytes: 5 * 1024 * 1024,
      }),
    )
    const cfg = await getNetworkPolicy()
    expect(cfg.allowlist).toEqual(['*.github.com'])
    expect(cfg.denylist).toEqual(['evil.com'])
    expect(cfg.maxRequestsPerMinute).toBe(20)
    expect(cfg.maxResponseBytes).toBe(5 * 1024 * 1024)
    expect(invoke).toHaveBeenCalledWith('get_network_policy')
  })

  it('getNetworkPolicy returns defaults on empty response', async () => {
    const { getNetworkPolicy } = await import('./networkPolicy.js')
    invoke.mockResolvedValueOnce('')
    expect(await getNetworkPolicy()).toEqual({})
  })

  it('getNetworkPolicy returns defaults on corrupt JSON', async () => {
    const { getNetworkPolicy } = await import('./networkPolicy.js')
    invoke.mockResolvedValueOnce('{ broken')
    expect(await getNetworkPolicy()).toEqual({})
  })

  it('getNetworkPolicy returns defaults on IPC error', async () => {
    const { getNetworkPolicy } = await import('./networkPolicy.js')
    invoke.mockRejectedValueOnce(new Error('IPC error'))
    expect(await getNetworkPolicy()).toEqual({})
  })

  it('setNetworkPolicy invokes set_network_policy with the config', async () => {
    const { setNetworkPolicy } = await import('./networkPolicy.js')
    invoke.mockResolvedValueOnce(undefined)
    const config = { allowlist: ['api.openai.com'], maxRequestsPerMinute: 5 }
    await setNetworkPolicy(config)
    expect(invoke).toHaveBeenCalledWith('set_network_policy', { json: JSON.stringify(config) })
  })

  it('setNetworkPolicy propagates IPC errors', async () => {
    const { setNetworkPolicy } = await import('./networkPolicy.js')
    invoke.mockRejectedValueOnce(new Error('permission denied'))
    await expect(setNetworkPolicy({})).rejects.toThrow('permission denied')
  })
})
