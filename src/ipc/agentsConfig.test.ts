import { describe, it, expect, vi, beforeEach } from 'vitest'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }))

beforeEach(() => invoke.mockReset())

describe('agentsConfig IPC', () => {
  it('getAgentsConfig parses the file payload', async () => {
    const { getAgentsConfig } = await import('./agentsConfig.js')
    invoke.mockResolvedValueOnce(JSON.stringify({ agents: [{ id: 'a', name: 'A', kind: 'acp', command: 'x', args: [], enabled: true }] }))
    const cfg = await getAgentsConfig()
    expect(cfg.agents).toHaveLength(1)
    expect(invoke).toHaveBeenCalledWith('get_agents_config')
  })
  it('getAgentsConfig returns empty on blank/corrupt', async () => {
    const { getAgentsConfig } = await import('./agentsConfig.js')
    invoke.mockResolvedValueOnce('')
    expect((await getAgentsConfig()).agents).toEqual([])
    invoke.mockResolvedValueOnce('{ broken')
    expect((await getAgentsConfig()).agents).toEqual([])
  })
  it('setAgentsConfig stringifies and invokes set_agents_config', async () => {
    const { setAgentsConfig } = await import('./agentsConfig.js')
    invoke.mockResolvedValueOnce(undefined)
    await setAgentsConfig({ agents: [] })
    expect(invoke).toHaveBeenCalledWith('set_agents_config', { json: JSON.stringify({ agents: [] }, null, 2) })
  })
})
