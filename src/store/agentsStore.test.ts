import { describe, it, expect, vi, beforeEach } from 'vitest'
import { withBuiltinOpencode } from './agentsStore'

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
  it('load() hydrates from the IPC config (plus the built-in OpenCode agent)', async () => {
    getAgentsConfig.mockResolvedValueOnce({ agents: [{ id: 'a', name: 'A', kind: 'custom', command: 'x', args: [], transport: 'thin', acceptsModelConfig: false, enabled: true }] })
    const { useAgentsStore } = await import('./agentsStore.js')
    await useAgentsStore.getState().load()
    const agents = useAgentsStore.getState().agents
    expect(agents.find((a) => a.id === 'a')).toBeTruthy()
    expect(agents.find((a) => a.id === 'opencode')).toMatchObject({ kind: 'acp' })
    expect(useAgentsStore.getState().loaded).toBe(true)
  })
  it('addAgent persists and returns an id', async () => {
    const { useAgentsStore } = await import('./agentsStore.js')
    const id = await useAgentsStore.getState().addAgent({ name: 'New', kind: 'custom', command: 'mybin', args: [], transport: 'thin', acceptsModelConfig: false, enabled: true })
    expect(typeof id).toBe('string')
    expect(useAgentsStore.getState().agents[0]).toMatchObject({ id, name: 'New' })
    expect(setAgentsConfig).toHaveBeenCalledWith({ agents: [expect.objectContaining({ id, name: 'New' })] })
  })
  it('updateAgent patches the matching agent', async () => {
    const { useAgentsStore } = await import('./agentsStore.js')
    const id = await useAgentsStore.getState().addAgent({ name: 'X', kind: 'custom', command: 'b', args: [], transport: 'thin', acceptsModelConfig: false, enabled: true })
    await useAgentsStore.getState().updateAgent(id, { enabled: false })
    expect(useAgentsStore.getState().agents.find((a) => a.id === id)!.enabled).toBe(false)
  })
  it('removeAgent drops it', async () => {
    const { useAgentsStore } = await import('./agentsStore.js')
    const id = await useAgentsStore.getState().addAgent({ name: 'X', kind: 'custom', command: 'b', args: [], transport: 'thin', acceptsModelConfig: false, enabled: true })
    await useAgentsStore.getState().removeAgent(id)
    expect(useAgentsStore.getState().agents).toHaveLength(0)
  })
})

describe('built-in opencode agent', () => {
  it('injects an opencode acp entry when absent, preserving user entries', () => {
    const list = withBuiltinOpencode([{ id: 'x', kind: 'custom' } as any])
    const oc = list.find((a) => a.id === 'opencode')
    expect(oc).toMatchObject({ kind: 'acp', command: 'opencode', args: ['acp', '--pure'], authMode: 'opencode-self' })
    expect(list.find((a) => a.id === 'x')).toBeTruthy()
  })
  it('does not duplicate an existing opencode entry', () => {
    const list = withBuiltinOpencode([{ id: 'opencode', kind: 'acp', enabled: true } as any])
    expect(list.filter((a) => a.id === 'opencode')).toHaveLength(1)
  })
})
