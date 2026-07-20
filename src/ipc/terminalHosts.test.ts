import { describe, it, expect, vi, beforeEach } from 'vitest'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}))

import {
  listTerminalHosts,
  saveTerminalHosts,
  normalizeCatalog,
  EMPTY_TERMINAL_HOSTS_CATALOG,
} from './terminalHosts'

describe('terminalHosts IPC', () => {
  beforeEach(() => invoke.mockReset())

  it('listTerminalHosts invokes terminal_hosts_list and normalizes', async () => {
    invoke.mockResolvedValueOnce({
      version: 1,
      groups: [{ id: 'g1', name: 'prod', sort: 0 }],
      hosts: [
        {
          id: 'h1',
          label: 'ops',
          hostname: '10.0.0.1',
          port: 22,
          username: 'deploy',
          authMethod: 'password',
          updatedAt: 100,
        },
      ],
      recents: [{ type: 'ssh', hostId: 'h1', label: 'ops', at: 200 }],
    })
    const cat = await listTerminalHosts()
    expect(invoke).toHaveBeenCalledWith('terminal_hosts_list')
    expect(cat.groups).toHaveLength(1)
    expect(cat.hosts[0]?.id).toBe('h1')
    expect(cat.recents[0]).toEqual({ type: 'ssh', hostId: 'h1', label: 'ops', at: 200 })
  })

  it('listTerminalHosts returns empty catalog on IPC error', async () => {
    invoke.mockRejectedValueOnce(new Error('no config dir'))
    await expect(listTerminalHosts()).resolves.toEqual(EMPTY_TERMINAL_HOSTS_CATALOG)
  })

  it('saveTerminalHosts invokes terminal_hosts_save', async () => {
    invoke.mockResolvedValueOnce(undefined)
    const catalog = {
      version: 1,
      groups: [],
      hosts: [],
      recents: [] as const,
    }
    await saveTerminalHosts(catalog)
    expect(invoke).toHaveBeenCalledWith('terminal_hosts_save', { catalog })
  })

  it('normalizeCatalog drops malformed hosts / recents', () => {
    const cat = normalizeCatalog({
      version: 1,
      groups: [{ id: 'g1', name: 'ok', sort: 1 }, { id: 'bad' }],
      hosts: [
        {
          id: 'h1',
          label: 'ok',
          hostname: 'h',
          port: 22,
          username: 'u',
          authMethod: 'privateKey',
          privateKeyPath: '/k',
          updatedAt: 1,
        },
        { id: 'nope' },
      ],
      recents: [
        { type: 'local', cwd: '/tmp', at: 1 },
        { type: 'ssh', hostId: 'x' },
        { type: 'ssh', hostId: 'h1', label: 'ok', at: 2 },
      ],
    })
    expect(cat.groups).toEqual([{ id: 'g1', name: 'ok', sort: 1 }])
    expect(cat.hosts).toHaveLength(1)
    expect(cat.hosts[0]?.authMethod).toBe('privateKey')
    expect(cat.recents).toEqual([
      { type: 'local', cwd: '/tmp', at: 1 },
      { type: 'ssh', hostId: 'h1', label: 'ok', at: 2 },
    ])
  })
})
