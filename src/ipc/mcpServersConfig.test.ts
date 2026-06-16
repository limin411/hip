import { describe, it, expect, vi, beforeEach } from 'vitest'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }))

beforeEach(() => invoke.mockReset())

describe('mcpServersConfig IPC', () => {
  it('getMcpServersConfig parses the file payload', async () => {
    const { getMcpServersConfig } = await import('./mcpServersConfig.js')
    invoke.mockResolvedValueOnce(
      JSON.stringify({ servers: [{ id: 's1', name: 'Files', transport: 'stdio', command: 'srv', args: [], enabled: true }] }),
    )
    const cfg = await getMcpServersConfig()
    expect(cfg.servers).toHaveLength(1)
    expect(cfg.servers[0]).toMatchObject({ id: 's1', transport: 'stdio' })
    expect(invoke).toHaveBeenCalledWith('get_mcp_servers_config')
  })
  it('getMcpServersConfig returns empty on blank/corrupt', async () => {
    const { getMcpServersConfig } = await import('./mcpServersConfig.js')
    invoke.mockResolvedValueOnce('')
    expect((await getMcpServersConfig()).servers).toEqual([])
    invoke.mockResolvedValueOnce('{ broken')
    expect((await getMcpServersConfig()).servers).toEqual([])
  })
  it('getMcpServersConfig returns empty when servers is not an array', async () => {
    const { getMcpServersConfig } = await import('./mcpServersConfig.js')
    invoke.mockResolvedValueOnce(JSON.stringify({ servers: 'nope' }))
    expect((await getMcpServersConfig()).servers).toEqual([])
  })
  it('setMcpServersConfig stringifies and invokes set_mcp_servers_config', async () => {
    const { setMcpServersConfig } = await import('./mcpServersConfig.js')
    invoke.mockResolvedValueOnce(undefined)
    await setMcpServersConfig({ servers: [] })
    expect(invoke).toHaveBeenCalledWith('set_mcp_servers_config', { json: JSON.stringify({ servers: [] }, null, 2) })
  })
})
