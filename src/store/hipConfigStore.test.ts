import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { McpTransport } from '@hip/protocol'

const getHipConfig = vi.fn()
const setHipConfig = vi.fn()
vi.mock('@/ipc/hipConfig', () => ({
  getHipConfig: (...a: unknown[]) => getHipConfig(...a),
  setHipConfig: (...a: unknown[]) => setHipConfig(...a),
}))

beforeEach(async () => {
  getHipConfig.mockReset().mockResolvedValue({ version: 1 })
  setHipConfig.mockReset().mockResolvedValue(undefined)
  const { useHipConfigStore } = await import('./hipConfigStore.js')
  useHipConfigStore.setState({ config: { version: 1 }, loaded: false, error: null })
})

describe('hipConfigStore', () => {
  it('load() hydrates from IPC', async () => {
    getHipConfig.mockResolvedValueOnce({
      version: 1,
      providers: [{ id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' }],
      mcpServers: [
        { id: 's1', name: 'Files', transport: 'stdio', command: 'srv', args: [], enabled: true },
      ],
      skills: [{ id: 'my-skill', enabled: true }],
      agents: [
        { id: 'a1', name: 'Helper', kind: 'custom', command: 'echo', args: [], enabled: true },
      ],
      permissions: { coarseMode: 'edit' as const },
    })

    const { useHipConfigStore } = await import('./hipConfigStore.js')
    await useHipConfigStore.getState().load()

    const state = useHipConfigStore.getState()
    expect(state.loaded).toBe(true)
    expect(state.error).toBeNull()
    expect(state.config.version).toBe(1)
    expect(state.config.providers).toHaveLength(1)
    expect(state.config.mcpServers).toHaveLength(1)
    expect(state.config.skills).toHaveLength(1)
    expect(state.config.agents).toHaveLength(1)
    expect(state.config.permissions).toMatchObject({ coarseMode: 'edit' })
  })

  it('load() sets error on IPC failure', async () => {
    getHipConfig.mockRejectedValueOnce(new Error('IPC down'))

    const { useHipConfigStore } = await import('./hipConfigStore.js')
    await useHipConfigStore.getState().load()

    const state = useHipConfigStore.getState()
    expect(state.loaded).toBe(true)
    expect(state.error).toBe('IPC down')
    expect(state.config).toEqual({ version: 1 }) // preserved defaults
  })

  it('save() persists via IPC and updates local state', async () => {
    const { useHipConfigStore } = await import('./hipConfigStore.js')
    const newConfig = {
      version: 1,
      skills: [{ id: 'new-skill', enabled: false }],
    }
    await useHipConfigStore.getState().save(newConfig)

    expect(setHipConfig).toHaveBeenCalledWith(newConfig)
    expect(useHipConfigStore.getState().config).toEqual(newConfig)
    expect(useHipConfigStore.getState().error).toBeNull()
  })

  it('updateSection() updates a single section', async () => {
    const { useHipConfigStore } = await import('./hipConfigStore.js')
    // Seed with existing config
    useHipConfigStore.setState({
      config: {
        version: 1,
        mcpServers: [
          { id: 'old', name: 'Old', transport: 'stdio' as McpTransport, command: 'cmd', enabled: true },
        ],
      },
    })

    const newMcp = [
      { id: 'new', name: 'New', transport: 'http' as McpTransport, url: 'https://example.test', enabled: true },
    ]
    await useHipConfigStore.getState().updateSection('mcpServers', newMcp)

    expect(setHipConfig).toHaveBeenCalledWith({
      version: 1,
      mcpServers: newMcp,
    })
    expect(useHipConfigStore.getState().config.mcpServers).toEqual(newMcp)
  })

  it('updateSection() merges new section with existing config', async () => {
    const { useHipConfigStore } = await import('./hipConfigStore.js')
    useHipConfigStore.setState({
      config: {
        version: 1,
        providers: [{ id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' }],
      },
    })

    await useHipConfigStore.getState().updateSection('permissions', { coarseMode: 'full' as const })

    const cfg = useHipConfigStore.getState().config
    expect(cfg.providers).toHaveLength(1)
    expect(cfg.permissions).toMatchObject({ coarseMode: 'full' })
  })

  it('selectors extract correct sections', async () => {
    getHipConfig.mockResolvedValueOnce({
      version: 1,
      mcpServers: [
        { id: 's1', name: 'Files', transport: 'stdio', command: 'srv', args: [], enabled: true },
      ],
      skills: [{ id: 'sk1', enabled: true }],
      providers: [{ id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' }],
      agents: [
        { id: 'a1', name: 'Helper', kind: 'custom', command: 'echo', args: [], enabled: true },
      ],
      permissions: { coarseMode: 'chat' as const },
    })

    const { useHipConfigStore } = await import('./hipConfigStore.js')
    await useHipConfigStore.getState().load()

    // Validate selector-equivalent logic via getState (hooks require React DOM)
    const state = useHipConfigStore.getState()
    expect(state.config.mcpServers ?? []).toHaveLength(1)
    expect(state.config.skills ?? []).toHaveLength(1)
    expect(state.config.providers ?? []).toHaveLength(1)
    expect(state.config.agents ?? []).toHaveLength(1)
    expect(state.config.permissions).toMatchObject({ coarseMode: 'chat' })
  })

  it('selectors return empty arrays/undefined when section is absent', async () => {
    getHipConfig.mockResolvedValueOnce({ version: 1 })

    const { useHipConfigStore } = await import('./hipConfigStore.js')
    await useHipConfigStore.getState().load()

    const state = useHipConfigStore.getState()
    expect(state.config.mcpServers ?? []).toEqual([])
    expect(state.config.skills ?? []).toEqual([])
    expect(state.config.providers ?? []).toEqual([])
    expect(state.config.agents ?? []).toEqual([])
    expect(state.config.permissions).toBeUndefined()
  })
})
