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

  it('updateSection() TOCTOU race: concurrent calls overwrite each other', async () => {
    const { useHipConfigStore } = await import('./hipConfigStore.js')
    useHipConfigStore.setState({
      config: { version: 1, agents: [] },
    })

    // Widen the race window by making setHipConfig slow
    setHipConfig.mockImplementation(() => new Promise(r => setTimeout(r, 10)))

    const p1 = useHipConfigStore.getState().updateSection('agents', (prev) => [
      ...(prev ?? []),
      { id: 'a1', name: 'Alpha', kind: 'custom', command: 'echo', args: [], enabled: true },
    ])
    const p2 = useHipConfigStore.getState().updateSection('agents', (prev) => [
      ...(prev ?? []),
      { id: 'a2', name: 'Beta', kind: 'custom', command: 'echo', args: [], enabled: true },
    ])
    await Promise.all([p1, p2])

    // The LAST setHipConfig call should contain BOTH agents
    const calls = setHipConfig.mock.calls
    const lastCallArg = calls[calls.length - 1][0] as { agents: unknown[] }
    expect(lastCallArg.agents).toHaveLength(2)
  })

  it('updateSections() merges a multi-section patch into the latest state without clobbering a concurrent updateSection', async () => {
    const { useHipConfigStore } = await import('./hipConfigStore.js')
    useHipConfigStore.setState({ config: { version: 1, agents: [], providers: [] } })

    // Widen the race window so the concurrent section write lands during the persist await.
    setHipConfig.mockImplementation(() => new Promise((r) => setTimeout(r, 10)))

    // A multi-section write (providers + activeModel), exactly what providersStore persists.
    const pA = useHipConfigStore.getState().updateSections({
      providers: [
        { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', enabled: true },
      ],
      activeModel: { providerID: 'deepseek', modelID: 'deepseek-reasoner', baseURL: 'https://api.deepseek.com/v1' },
    })
    // A concurrent single-section write to a DIFFERENT section must survive.
    const pB = useHipConfigStore.getState().updateSection('agents', (prev) => [
      ...(prev ?? []),
      { id: 'a1', name: 'Alpha', kind: 'custom', command: 'echo', args: [], enabled: true },
    ])
    await Promise.all([pA, pB])

    const cfg = useHipConfigStore.getState().config
    expect(cfg.providers).toHaveLength(1)
    expect(cfg.activeModel?.providerID).toBe('deepseek')
    expect(cfg.agents).toHaveLength(1) // not clobbered by the multi-section write
  })

  it('updateSection() functional updater merges with existing state', async () => {
    const { useHipConfigStore } = await import('./hipConfigStore.js')
    // Seed with an existing mcpServer
    useHipConfigStore.setState({
      config: {
        version: 1,
        mcpServers: [
          { id: 'old', name: 'Old', transport: 'stdio' as McpTransport, command: 'cmd', enabled: true },
        ],
      },
    })

    await useHipConfigStore.getState().updateSection('mcpServers', (prev) => [
      ...(prev ?? []),
      { id: 'new', name: 'New', transport: 'http' as McpTransport, url: 'https://t', enabled: true },
    ])

    const lastCallArg = setHipConfig.mock.calls[setHipConfig.mock.calls.length - 1][0] as {
      mcpServers: unknown[]
    }
    expect(lastCallArg.mcpServers).toHaveLength(2)
    expect(useHipConfigStore.getState().config.mcpServers).toHaveLength(2)
  })

  it('updateSection() functional updater handles undefined prev gracefully', async () => {
    const { useHipConfigStore } = await import('./hipConfigStore.js')
    // No seed — skills is absent from config
    useHipConfigStore.setState({ config: { version: 1 } })

    await useHipConfigStore.getState().updateSection('skills', (prev) => [
      ...(prev ?? []),
      { id: 's1', enabled: true },
    ])

    expect(useHipConfigStore.getState().config.skills).toHaveLength(1)
    expect(useHipConfigStore.getState().config.skills?.[0]).toMatchObject({
      id: 's1',
      enabled: true,
    })
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
    })

    const { useHipConfigStore } = await import('./hipConfigStore.js')
    await useHipConfigStore.getState().load()

    // Validate selector-equivalent logic via getState (hooks require React DOM)
    const state = useHipConfigStore.getState()
    expect(state.config.mcpServers ?? []).toHaveLength(1)
    expect(state.config.skills ?? []).toHaveLength(1)
    expect(state.config.providers ?? []).toHaveLength(1)
    expect(state.config.agents ?? []).toHaveLength(1)
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
  })
})
