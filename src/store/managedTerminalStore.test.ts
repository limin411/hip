import { beforeEach, describe, expect, it, vi } from 'vitest'

const ptyKill = vi.fn(async (_id: string) => {})
const sshClose = vi.fn(async (_id: string) => {})
const interactiveTerminalList = vi.fn(async () => [] as { id: string; kind: string }[])
const homeDir = vi.fn(async () => '/Users/test')
const pushRecent = vi.fn(async (_entry: unknown) => {})

vi.mock('@/ipc/pty', () => ({
  ptyKill: (id: string) => ptyKill(id),
}))

vi.mock('@/ipc/ssh', () => ({
  sshClose: (id: string) => sshClose(id),
  interactiveTerminalList: () => interactiveTerminalList(),
}))

vi.mock('@tauri-apps/api/path', () => ({
  homeDir: () => homeDir(),
}))

vi.mock('@/store/terminalHostStore', () => ({
  useTerminalHostStore: {
    getState: () => ({
      pushRecent: (entry: unknown) => pushRecent(entry),
    }),
  },
}))

import { useTerminalStore } from './terminalStore'
import {
  isManagedTerminalId,
  localTerminalTitle,
  mintManagedTerminalId,
  recordSuccessfulLocalLaunch,
  recordSuccessfulSshLaunch,
  useManagedTerminalStore,
} from './managedTerminalStore'

describe('managedTerminal helpers', () => {
  it('mintManagedTerminalId always starts with tm_', () => {
    const id = mintManagedTerminalId()
    expect(id.startsWith('tm_')).toBe(true)
    expect(isManagedTerminalId(id)).toBe(true)
    expect(isManagedTerminalId('sess-abc')).toBe(false)
  })

  it('localTerminalTitle prefers label then basename', () => {
    expect(localTerminalTitle('/Users/a/projects/hip', 'Work')).toBe('Work')
    expect(localTerminalTitle('/Users/a/projects/hip')).toBe('hip')
    expect(localTerminalTitle('/')).toBe('/')
  })
})

describe('managedTerminalStore', () => {
  beforeEach(() => {
    ptyKill.mockReset().mockResolvedValue(undefined)
    sshClose.mockReset().mockResolvedValue(undefined)
    interactiveTerminalList.mockReset().mockResolvedValue([])
    homeDir.mockReset().mockResolvedValue('/Users/test')
    pushRecent.mockReset()
    useManagedTerminalStore.setState({ terminals: [], focusedId: null })
    useTerminalStore.setState({
      bySession: {},
      attachedSessionId: null,
      attachedTerminalId: null,
    })
  })

  it('openLocal mints tm_ id, uses home cwd, focuses, ensures ring', async () => {
    const id = await useManagedTerminalStore.getState().openLocal()
    expect(id.startsWith('tm_')).toBe(true)
    const st = useManagedTerminalStore.getState()
    expect(st.focusedId).toBe(id)
    expect(st.terminals).toHaveLength(1)
    expect(st.terminals[0]).toMatchObject({
      id,
      kind: 'local',
      cwd: '/Users/test',
      title: 'test',
    })
    expect(useTerminalStore.getState().bySession[id]).toBeDefined()
  })

  it('openLocal accepts explicit cwd and label', async () => {
    const id = await useManagedTerminalStore.getState().openLocal({
      cwd: '/tmp/work',
      label: 'Scratch',
    })
    const t = useManagedTerminalStore.getState().getTerminal(id)
    expect(t).toMatchObject({ cwd: '/tmp/work', title: 'Scratch', kind: 'local' })
  })

  it('close kills pty, clears ring, unfocuses', async () => {
    const id = await useManagedTerminalStore.getState().openLocal({ cwd: '/tmp' })
    useTerminalStore.getState().appendRing(id, 'hi')
    await useManagedTerminalStore.getState().close(id)
    expect(ptyKill).toHaveBeenCalledWith(id)
    expect(useManagedTerminalStore.getState().terminals).toHaveLength(0)
    expect(useManagedTerminalStore.getState().focusedId).toBeNull()
    expect(useTerminalStore.getState().bySession[id]).toBeUndefined()
  })

  it('close of non-focused keeps other focused', async () => {
    const a = await useManagedTerminalStore.getState().openLocal({ cwd: '/a' })
    const b = await useManagedTerminalStore.getState().openLocal({ cwd: '/b' })
    expect(useManagedTerminalStore.getState().focusedId).toBe(b)
    await useManagedTerminalStore.getState().close(a)
    expect(useManagedTerminalStore.getState().focusedId).toBe(b)
    expect(useManagedTerminalStore.getState().terminals.map((t) => t.id)).toEqual([b])
  })

  it('close of focused focuses a remaining neighbor', async () => {
    const a = await useManagedTerminalStore.getState().openLocal({ cwd: '/a' })
    const b = await useManagedTerminalStore.getState().openLocal({ cwd: '/b' })
    const c = await useManagedTerminalStore.getState().openLocal({ cwd: '/c' })
    expect(useManagedTerminalStore.getState().focusedId).toBe(c)
    await useManagedTerminalStore.getState().close(c)
    // Previous neighbor of c is b.
    expect(useManagedTerminalStore.getState().focusedId).toBe(b)
    expect(useManagedTerminalStore.getState().terminals.map((t) => t.id)).toEqual([a, b])
  })

  it('recordSuccessfulLocalLaunch pushes recent', async () => {
    await recordSuccessfulLocalLaunch('/tmp/x', 'X')
    expect(pushRecent).toHaveBeenCalledWith({
      type: 'local',
      cwd: '/tmp/x',
      label: 'X',
      at: expect.any(Number),
    })
  })

  it('openSsh mints tm_ id, stores hostId, focuses', async () => {
    const id = await useManagedTerminalStore.getState().openSsh({
      id: 'hst_1',
      label: 'ops',
      hostname: '10.0.0.1',
      port: 22,
      username: 'root',
      authMethod: 'password',
      updatedAt: 1,
    })
    expect(id.startsWith('tm_')).toBe(true)
    const t = useManagedTerminalStore.getState().getTerminal(id)
    expect(t).toMatchObject({
      kind: 'ssh',
      hostId: 'hst_1',
      title: 'ops',
    })
    expect(useManagedTerminalStore.getState().focusedId).toBe(id)
  })

  it('openSsh throws soft-cap when interactive list is full', async () => {
    interactiveTerminalList.mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, kind: 'pty' })),
    )
    await expect(
      useManagedTerminalStore.getState().openSsh({
        id: 'hst_1',
        label: 'ops',
        hostname: '10.0.0.1',
        port: 22,
        username: 'root',
        authMethod: 'password',
        updatedAt: 1,
      }),
    ).rejects.toThrow(/Too many terminals/)
    expect(useManagedTerminalStore.getState().terminals).toHaveLength(0)
  })

  it('close of ssh calls sshClose and keeps the record as disconnected (D12)', async () => {
    const id = await useManagedTerminalStore.getState().openSsh({
      id: 'hst_1',
      label: 'ops',
      hostname: '10.0.0.1',
      port: 22,
      username: 'root',
      authMethod: 'password',
      updatedAt: 1,
    })
    await useManagedTerminalStore.getState().close(id)
    expect(sshClose).toHaveBeenCalledWith(id)
    expect(ptyKill).not.toHaveBeenCalled()
    const term = useManagedTerminalStore.getState().getTerminal(id)
    expect(term).toBeDefined()
    expect(term?.status).toBe('disconnected')
  })

  it('reconnect reuses the same tm_* record (new generation)', async () => {
    const id = await useManagedTerminalStore.getState().openSsh({
      id: 'hst_1',
      label: 'ops',
      hostname: '10.0.0.1',
      port: 22,
      username: 'root',
      authMethod: 'password',
      updatedAt: 1,
    })
    await useManagedTerminalStore.getState().close(id)
    expect(useManagedTerminalStore.getState().getTerminal(id)?.status).toBe('disconnected')
    await useManagedTerminalStore.getState().reconnect(id)
    expect(useManagedTerminalStore.getState().getTerminal(id)?.id).toBe(id)
    expect(useManagedTerminalStore.getState().getTerminal(id)?.status).toBe('connecting')
    expect(useManagedTerminalStore.getState().reconnectNonce[id]).toBe(1)
  })

  it('recordSuccessfulSshLaunch pushes recent', async () => {
    await recordSuccessfulSshLaunch('hst_1', 'ops')
    expect(pushRecent).toHaveBeenCalledWith({
      type: 'ssh',
      hostId: 'hst_1',
      label: 'ops',
      at: expect.any(Number),
    })
  })
})
