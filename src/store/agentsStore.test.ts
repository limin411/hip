import { describe, it, expect, vi, beforeEach } from 'vitest'

const updateSection = vi.fn()
const load = vi.fn()
vi.mock('@/store/hipConfigStore', () => ({
  useHipConfigStore: {
    getState: () => ({
      load: (...a: unknown[]) => load(...a),
      updateSection: (...a: unknown[]) => updateSection(...a),
    }),
    setState: vi.fn(),
  },
  useAgents: vi.fn(() => []),
}))

beforeEach(async () => {
  updateSection.mockReset().mockResolvedValue(undefined)
  load.mockReset().mockResolvedValue(undefined)
  const { useAgentsStore } = await import('./agentsStore.js')
  useAgentsStore.setState({ agents: [], loaded: false })
})

describe('agentsStore', () => {
  it('load() hydrates from hipConfigStore (no auto-injected agents)', async () => {
    const { useAgentsStore } = await import('./agentsStore.js')
    await useAgentsStore.getState().load()
    expect(load).toHaveBeenCalled()
    expect(useAgentsStore.getState().loaded).toBe(true)
  })

	  it('addAgent persists and returns an id', async () => {
	    const { useAgentsStore } = await import('./agentsStore.js')
	    const id = await useAgentsStore.getState().addAgent({ name: 'New', kind: 'acp', command: 'mybin', args: [], enabled: true })
	    expect(typeof id).toBe('string')
	    expect(useAgentsStore.getState().agents[0]).toMatchObject({ id, name: 'New' })
	    expect(updateSection).toHaveBeenCalledWith('agents', expect.any(Function))
	    // Verify the updater function's behavior
	    const updaterFn = updateSection.mock.calls[0][1] as (prev: unknown[]) => unknown[]
	    expect(updaterFn([])).toEqual([{ name: 'New', kind: 'acp', command: 'mybin', args: [], enabled: true, id: expect.any(String) }])
	  })

	  it('updateAgent patches the matching agent', async () => {
	    const { useAgentsStore } = await import('./agentsStore.js')
	    const id = await useAgentsStore.getState().addAgent({ name: 'X', kind: 'acp', command: 'b', args: [], enabled: true })
	    await useAgentsStore.getState().updateAgent(id, { enabled: false })
	    expect(useAgentsStore.getState().agents.find((a) => a.id === id)!.enabled).toBe(false)
	    expect(updateSection).toHaveBeenLastCalledWith('agents', expect.any(Function))
	    const updaterFn = updateSection.mock.lastCall![1] as (prev: unknown[]) => unknown[]
	    const result = updaterFn([{ id, name: 'X', kind: 'acp', command: 'b', args: [], enabled: true }])
	    expect((result[0] as { enabled: boolean }).enabled).toBe(false)
	  })

  it('removeAgent drops it', async () => {
    const { useAgentsStore } = await import('./agentsStore.js')
    const id = await useAgentsStore.getState().addAgent({ name: 'X', kind: 'acp', command: 'b', args: [], enabled: true })
    await useAgentsStore.getState().removeAgent(id)
    expect(useAgentsStore.getState().agents).toHaveLength(0)
    expect(updateSection).toHaveBeenLastCalledWith('agents', expect.any(Function))
    const updaterFn = updateSection.mock.lastCall![1] as (prev: unknown[]) => unknown[]
    expect(updaterFn([{ id, name: 'X', kind: 'acp', command: 'b', args: [], enabled: true }])).toEqual([])
  })

  it('concurrent addAgent calls do not lose data', async () => {
    const { useAgentsStore } = await import('./agentsStore.js')
    updateSection.mockImplementation(() => new Promise(r => setTimeout(r, 10)))
    const p1 = useAgentsStore.getState().addAgent({ name: 'A', kind: 'acp', command: 'cmd', args: [], enabled: true })
    const p2 = useAgentsStore.getState().addAgent({ name: 'B', kind: 'acp', command: 'cmd', args: [], enabled: true })
    await Promise.all([p1, p2])
    expect(useAgentsStore.getState().agents).toHaveLength(2)
  })
})
