import { describe, it, expect, vi, beforeEach } from 'vitest'

const getMcpServersConfig = vi.fn()
const setMcpServersConfig = vi.fn()
vi.mock('@/ipc/mcpServersConfig', () => ({
  getMcpServersConfig: (...a: unknown[]) => getMcpServersConfig(...a),
  setMcpServersConfig: (...a: unknown[]) => setMcpServersConfig(...a),
}))

beforeEach(async () => {
  getMcpServersConfig.mockReset().mockResolvedValue({ servers: [] })
  setMcpServersConfig.mockReset().mockResolvedValue(undefined)
  const { useMcpServersStore } = await import('./mcpServersStore.js')
  useMcpServersStore.setState({ servers: [], loaded: false })
})

describe('mcpServersStore', () => {
  it('load() hydrates from the IPC config', async () => {
    getMcpServersConfig.mockResolvedValueOnce({
      servers: [{ id: 's1', name: 'Files', transport: 'stdio', command: 'srv', args: [], enabled: true }],
    })
    const { useMcpServersStore } = await import('./mcpServersStore.js')
    await useMcpServersStore.getState().load()
    expect(useMcpServersStore.getState().servers).toHaveLength(1)
    expect(useMcpServersStore.getState().loaded).toBe(true)
  })
  it('addServer mints an id and persists', async () => {
    const { useMcpServersStore } = await import('./mcpServersStore.js')
    await useMcpServersStore.getState().addServer({ name: 'Files', transport: 'stdio', command: 'srv', enabled: true })
    const servers = useMcpServersStore.getState().servers
    expect(servers).toHaveLength(1)
    expect(typeof servers[0].id).toBe('string')
    expect(servers[0]).toMatchObject({ name: 'Files', transport: 'stdio' })
    expect(setMcpServersConfig).toHaveBeenCalledWith({ servers: [expect.objectContaining({ name: 'Files' })] })
  })
  it('updateServer patches the matching server', async () => {
    const { useMcpServersStore } = await import('./mcpServersStore.js')
    await useMcpServersStore.getState().addServer({ name: 'X', transport: 'stdio', command: 'b', enabled: true })
    const id = useMcpServersStore.getState().servers[0].id
    await useMcpServersStore.getState().updateServer(id, { enabled: false })
    expect(useMcpServersStore.getState().servers[0].enabled).toBe(false)
  })
  it('removeServer drops it', async () => {
    const { useMcpServersStore } = await import('./mcpServersStore.js')
    await useMcpServersStore.getState().addServer({ name: 'X', transport: 'stdio', command: 'b', enabled: true })
    const id = useMcpServersStore.getState().servers[0].id
    await useMcpServersStore.getState().removeServer(id)
    expect(useMcpServersStore.getState().servers).toHaveLength(0)
  })
})
