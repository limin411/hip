import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { RecentLaunch, TerminalHost } from '@/ipc/terminalHosts'

const listTerminalHosts = vi.fn()
const saveTerminalHosts = vi.fn()
const deleteSecretRaw = vi.fn()

vi.mock('@/ipc/terminalHosts', async () => {
  const actual = await vi.importActual<typeof import('@/ipc/terminalHosts')>('@/ipc/terminalHosts')
  return {
    ...actual,
    listTerminalHosts: (...a: unknown[]) => listTerminalHosts(...a),
    saveTerminalHosts: (...a: unknown[]) => saveTerminalHosts(...a),
  }
})

vi.mock('@/ipc/secrets', () => ({
  deleteSecretRaw: (...a: unknown[]) => deleteSecretRaw(...a),
  sshPasswordKey: (id: string) => `hip.ssh.${id}.password`,
  sshPassphraseKey: (id: string) => `hip.ssh.${id}.passphrase`,
}))

import {
  MAX_RECENTS,
  recentKey,
  pushRecentEntry,
  filterRecentsForHosts,
  useTerminalHostStore,
} from './terminalHostStore'

const host = (id: string, label = id): TerminalHost => ({
  id,
  label,
  hostname: 'h.example',
  port: 22,
  username: 'u',
  authMethod: 'password',
  updatedAt: 1,
})

describe('recents helpers (K11)', () => {
  it('recentKey distinguishes local cwd and ssh hostId', () => {
    expect(recentKey({ type: 'local', cwd: '/tmp', at: 1 })).toBe('local:/tmp')
    expect(recentKey({ type: 'ssh', hostId: 'h1', label: 'ops', at: 1 })).toBe('ssh:h1')
  })

  it('pushRecentEntry moves duplicate to front and updates entry', () => {
    const base: RecentLaunch[] = [
      { type: 'ssh', hostId: 'a', label: 'A', at: 1 },
      { type: 'local', cwd: '/tmp', at: 2 },
      { type: 'ssh', hostId: 'b', label: 'B', at: 3 },
    ]
    const next = pushRecentEntry(base, { type: 'ssh', hostId: 'a', label: 'A2', at: 99 })
    expect(next).toEqual([
      { type: 'ssh', hostId: 'a', label: 'A2', at: 99 },
      { type: 'local', cwd: '/tmp', at: 2 },
      { type: 'ssh', hostId: 'b', label: 'B', at: 3 },
    ])
  })

  it('pushRecentEntry caps at MAX_RECENTS (5)', () => {
    let recents: RecentLaunch[] = []
    for (let i = 0; i < 8; i++) {
      recents = pushRecentEntry(recents, {
        type: 'local',
        cwd: `/p${i}`,
        at: i,
      })
    }
    expect(recents).toHaveLength(MAX_RECENTS)
    expect(recents[0]).toEqual({ type: 'local', cwd: '/p7', at: 7 })
    expect(recents.map((r) => (r.type === 'local' ? r.cwd : r.hostId))).toEqual([
      '/p7',
      '/p6',
      '/p5',
      '/p4',
      '/p3',
    ])
  })

  it('filterRecentsForHosts drops dangling ssh hostIds and keeps local', () => {
    const recents: RecentLaunch[] = [
      { type: 'ssh', hostId: 'keep', label: 'K', at: 1 },
      { type: 'ssh', hostId: 'gone', label: 'G', at: 2 },
      { type: 'local', cwd: '/home', at: 3 },
    ]
    expect(filterRecentsForHosts(recents, new Set(['keep']))).toEqual([
      { type: 'ssh', hostId: 'keep', label: 'K', at: 1 },
      { type: 'local', cwd: '/home', at: 3 },
    ])
  })
})

describe('terminalHostStore', () => {
  beforeEach(async () => {
    listTerminalHosts.mockReset().mockResolvedValue({
      version: 1,
      groups: [],
      hosts: [],
      recents: [],
    })
    saveTerminalHosts.mockReset().mockResolvedValue(undefined)
    deleteSecretRaw.mockReset().mockResolvedValue(undefined)
    useTerminalHostStore.setState({
      groups: [],
      hosts: [],
      recents: [],
      loaded: false,
      error: null,
    })
  })

  it('load hydrates and filters dangling ssh recents', async () => {
    listTerminalHosts.mockResolvedValueOnce({
      version: 1,
      groups: [{ id: 'g1', name: 'prod', sort: 0 }],
      hosts: [host('h1', 'ops')],
      recents: [
        { type: 'ssh', hostId: 'h1', label: 'ops', at: 10 },
        { type: 'ssh', hostId: 'missing', label: 'x', at: 11 },
        { type: 'local', cwd: '/tmp', at: 12 },
      ],
    })
    await useTerminalHostStore.getState().load()
    const s = useTerminalHostStore.getState()
    expect(s.loaded).toBe(true)
    expect(s.groups).toHaveLength(1)
    expect(s.hosts).toHaveLength(1)
    expect(s.recents).toEqual([
      { type: 'ssh', hostId: 'h1', label: 'ops', at: 10 },
      { type: 'local', cwd: '/tmp', at: 12 },
    ])
  })

  it('pushRecent persists capped deduped list', async () => {
    useTerminalHostStore.setState({
      hosts: [host('h1')],
      recents: [
        { type: 'ssh', hostId: 'h1', label: 'old', at: 1 },
        { type: 'local', cwd: '/a', at: 2 },
      ],
      loaded: true,
    })
    await useTerminalHostStore.getState().pushRecent({
      type: 'ssh',
      hostId: 'h1',
      label: 'new',
      at: 99,
    })
    expect(useTerminalHostStore.getState().recents[0]).toEqual({
      type: 'ssh',
      hostId: 'h1',
      label: 'new',
      at: 99,
    })
    expect(saveTerminalHosts).toHaveBeenCalledTimes(1)
    const saved = saveTerminalHosts.mock.calls[0]![0]
    expect(saved.recents[0].label).toBe('new')
  })

  it('removeHost filters recents, deletes secrets, and persists', async () => {
    useTerminalHostStore.setState({
      hosts: [host('h1'), host('h2')],
      recents: [
        { type: 'ssh', hostId: 'h1', label: 'A', at: 1 },
        { type: 'ssh', hostId: 'h2', label: 'B', at: 2 },
        { type: 'local', cwd: '/tmp', at: 3 },
      ],
      loaded: true,
    })
    await useTerminalHostStore.getState().removeHost('h1')
    const s = useTerminalHostStore.getState()
    expect(s.hosts.map((h) => h.id)).toEqual(['h2'])
    expect(s.recents).toEqual([
      { type: 'ssh', hostId: 'h2', label: 'B', at: 2 },
      { type: 'local', cwd: '/tmp', at: 3 },
    ])
    expect(deleteSecretRaw).toHaveBeenCalledWith('hip.ssh.h1.password')
    expect(deleteSecretRaw).toHaveBeenCalledWith('hip.ssh.h1.passphrase')
    expect(saveTerminalHosts).toHaveBeenCalled()
  })

  it('upsertHost insert and update', async () => {
    await useTerminalHostStore.getState().upsertHost(host('h1', 'A'))
    expect(useTerminalHostStore.getState().hosts).toHaveLength(1)
    await useTerminalHostStore.getState().upsertHost(host('h1', 'B'))
    expect(useTerminalHostStore.getState().hosts).toEqual([host('h1', 'B')])
    expect(saveTerminalHosts).toHaveBeenCalledTimes(2)
  })

  it('removeGroup detaches hosts but keeps them', async () => {
    useTerminalHostStore.setState({
      groups: [{ id: 'g1', name: 'prod', sort: 0 }],
      hosts: [{ ...host('h1'), groupId: 'g1' }],
      recents: [],
      loaded: true,
    })
    await useTerminalHostStore.getState().removeGroup('g1')
    expect(useTerminalHostStore.getState().groups).toEqual([])
    expect(useTerminalHostStore.getState().hosts[0]?.groupId).toBeUndefined()
  })
})
