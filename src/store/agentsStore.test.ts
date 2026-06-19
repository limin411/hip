import { describe, it, expect, vi, beforeEach } from 'vitest'

const getAgentsConfig = vi.fn()
const setAgentsConfig = vi.fn()
vi.mock('@/ipc/agentsConfig', () => ({
  getAgentsConfig: (...a: unknown[]) => getAgentsConfig(...a),
  setAgentsConfig: (...a: unknown[]) => setAgentsConfig(...a),
}))

beforeEach(async () => {
  getAgentsConfig.mockReset().mockResolvedValue({ agents: [] })
  setAgentsConfig.mockReset().mockResolvedValue(undefined)
  const { useAgentsStore } = await import('./agentsStore.js')
  useAgentsStore.setState({ agents: [], loaded: false })
})

describe('agentsStore', () => {
  it('load() hydrates from the IPC config (no auto-injected agents)', async () => {
    getAgentsConfig.mockResolvedValueOnce({ agents: [{ id: 'a', name: 'A', kind: 'acp', command: 'x', args: [], enabled: true }] })
    const { useAgentsStore } = await import('./agentsStore.js')
    await useAgentsStore.getState().load()
    const agents = useAgentsStore.getState().agents
    expect(agents.map((a) => a.id)).toEqual(['a'])
    expect(useAgentsStore.getState().loaded).toBe(true)
  })
  it('addAgent persists and returns an id', async () => {
    const { useAgentsStore } = await import('./agentsStore.js')
    const id = await useAgentsStore.getState().addAgent({ name: 'New', kind: 'acp', command: 'mybin', args: [], enabled: true })
    expect(typeof id).toBe('string')
    expect(useAgentsStore.getState().agents[0]).toMatchObject({ id, name: 'New' })
    expect(setAgentsConfig).toHaveBeenCalledWith({ agents: [expect.objectContaining({ id, name: 'New' })] })
  })
  it('updateAgent patches the matching agent', async () => {
    const { useAgentsStore } = await import('./agentsStore.js')
    const id = await useAgentsStore.getState().addAgent({ name: 'X', kind: 'acp', command: 'b', args: [], enabled: true })
    await useAgentsStore.getState().updateAgent(id, { enabled: false })
    expect(useAgentsStore.getState().agents.find((a) => a.id === id)!.enabled).toBe(false)
  })
  it('removeAgent drops it', async () => {
    const { useAgentsStore } = await import('./agentsStore.js')
    const id = await useAgentsStore.getState().addAgent({ name: 'X', kind: 'acp', command: 'b', args: [], enabled: true })
    await useAgentsStore.getState().removeAgent(id)
    expect(useAgentsStore.getState().agents).toHaveLength(0)
  })
})

