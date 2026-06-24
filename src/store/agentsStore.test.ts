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
	  })

	  it('updateAgent patches the matching agent', async () => {
	    const { useAgentsStore } = await import('./agentsStore.js')
	    const id = await useAgentsStore.getState().addAgent({ name: 'X', kind: 'acp', command: 'b', args: [], enabled: true })
	    await useAgentsStore.getState().updateAgent(id, { enabled: false })
	    expect(useAgentsStore.getState().agents.find((a) => a.id === id)!.enabled).toBe(false)
	    expect(updateSection).toHaveBeenLastCalledWith('agents', expect.any(Function))
	  })

	  it('removeAgent drops it', async () => {
	    const { useAgentsStore } = await import('./agentsStore.js')
	    const id = await useAgentsStore.getState().addAgent({ name: 'X', kind: 'acp', command: 'b', args: [], enabled: true })
	    await useAgentsStore.getState().removeAgent(id)
	    expect(useAgentsStore.getState().agents).toHaveLength(0)
	    expect(updateSection).toHaveBeenLastCalledWith('agents', expect.any(Function))
	  })
})
