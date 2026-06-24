import { describe, it, expect, vi, beforeEach } from 'vitest'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }))

beforeEach(() => invoke.mockReset())

describe('hipConfig IPC', () => {
  it('getHipConfig parses a valid config', async () => {
    const { getHipConfig } = await import('./hipConfig.js')
    invoke.mockResolvedValueOnce(
      JSON.stringify({
        version: 1,
        providers: [{ id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' }],
        mcpServers: [
          { id: 's1', name: 'Files', transport: 'stdio', command: 'srv', args: [], enabled: true },
        ],
      }),
    )
    const cfg = await getHipConfig()
    expect(cfg.version).toBe(1)
    expect(cfg.providers).toHaveLength(1)
    expect(cfg.mcpServers).toHaveLength(1)
    expect(invoke).toHaveBeenCalledWith('get_hip_config')
  })

  it('getHipConfig returns defaults on empty response', async () => {
    const { getHipConfig } = await import('./hipConfig.js')
    invoke.mockResolvedValueOnce('')
    expect(await getHipConfig()).toEqual({ version: 1 })
  })

  it('getHipConfig returns defaults on corrupt JSON', async () => {
    const { getHipConfig } = await import('./hipConfig.js')
    invoke.mockResolvedValueOnce('{ broken')
    expect(await getHipConfig()).toEqual({ version: 1 })
  })

  it('getHipConfig returns defaults when version is missing', async () => {
    const { getHipConfig } = await import('./hipConfig.js')
    invoke.mockResolvedValueOnce(JSON.stringify({ providers: [] }))
    expect(await getHipConfig()).toEqual({ version: 1 })
  })

  it('getHipConfig returns defaults on IPC error', async () => {
    const { getHipConfig } = await import('./hipConfig.js')
    invoke.mockRejectedValueOnce(new Error('IPC error'))
    expect(await getHipConfig()).toEqual({ version: 1 })
  })

  it('setHipConfig invokes set_hip_config with the config', async () => {
    const { setHipConfig } = await import('./hipConfig.js')
    invoke.mockResolvedValueOnce(undefined)
    const config = {
      version: 1,
      providers: [{ id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', enabled: true }],
    }
    await setHipConfig(config)
    expect(invoke).toHaveBeenCalledWith('set_hip_config', { json: JSON.stringify(config) })
  })

  it('setHipConfig propagates IPC errors', async () => {
    const { setHipConfig } = await import('./hipConfig.js')
    invoke.mockRejectedValueOnce(new Error('permission denied'))
    await expect(setHipConfig({ version: 1 })).rejects.toThrow('permission denied')
  })
})
