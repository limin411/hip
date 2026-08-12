import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TFunction } from 'i18next'

const sftpLs = vi.fn()
const sftpDownload = vi.fn()
const sftpUpload = vi.fn()
const pickSavePath = vi.fn()
const pickFiles = vi.fn()
let opCounter = 0
vi.mock('@/ipc/sftp', () => ({
  sftpLs: (...args: unknown[]) => sftpLs(...args),
  isSessionClosedError: (err: unknown) =>
    /session is closed|SessionClosed|no ssh session/i.test(
      String(err instanceof Error ? err.message : err),
    ),
  isAlreadyExistsError: () => false,
  mintSftpOpId: () => `sftp_test_${++opCounter}`,
  sftpDownload: (...args: unknown[]) => sftpDownload(...args),
  sftpUpload: (...args: unknown[]) => sftpUpload(...args),
}))
vi.mock('@/ipc/dialog', () => ({
  pickSavePath: (...args: unknown[]) => pickSavePath(...args),
  pickFiles: (...args: unknown[]) => pickFiles(...args),
}))
vi.mock('@tauri-apps/api/path', () => ({
  homeDir: async () => '/home/u',
}))

import { loadSftpDir, runSftpDownload, runSftpUploadIntoDir } from './sftpActions'
import { useTerminalFsStore } from '@/store/terminalFsStore'
import { useTerminalStore } from '@/store/terminalStore'

const tStub = ((key: string) => key) as unknown as TFunction

const flush = () => new Promise<void>((r) => setTimeout(r, 0))

function transfers() {
  return useTerminalFsStore.getState().transfers
}

function phaseOf(label: string) {
  return transfers().find((t) => t.label === label)?.phase
}

describe('loadSftpDir', () => {
  beforeEach(() => {
    useTerminalFsStore.setState({ byTerminal: {}, transfers: [] })
    useTerminalStore.setState({ bySession: {}, attachedSessionId: null, attachedTerminalId: null })
    sftpLs.mockReset()
  })

  it('stores rootPath and entries on success', async () => {
    useTerminalStore.getState().ensureSession('tm_1')
    useTerminalStore.getState().setStatus('tm_1', 'running')
    sftpLs.mockResolvedValue({
      path: '/home/u',
      entries: [{ name: 'www', path: '/home/u/www', isDir: true }],
    })
    await loadSftpDir('tm_1', '.')
    const slice = useTerminalFsStore.getState().getSlice('tm_1')
    expect(slice.rootPath).toBe('/home/u')
    expect(slice.entriesByDir['/home/u']).toHaveLength(1)
    expect(slice.error).toBeNull()
  })

  it('retries session_closed while SSH is still opening, then succeeds', async () => {
    useTerminalStore.getState().ensureSession('tm_2')
    useTerminalStore.getState().setStatus('tm_2', 'starting')
    sftpLs
      .mockRejectedValueOnce(new Error('SSH session is closed'))
      .mockImplementationOnce(async () => {
        // Simulate XtermSurface finishing open mid-retry.
        useTerminalStore.getState().setStatus('tm_2', 'running')
        return { path: '/var/www', entries: [] }
      })
    await loadSftpDir('tm_2', '.')
    expect(sftpLs).toHaveBeenCalledTimes(2)
    expect(useTerminalFsStore.getState().getSlice('tm_2').rootPath).toBe('/var/www')
    expect(useTerminalFsStore.getState().getSlice('tm_2').error).toBeNull()
  })

  it('sets session_closed without endless retry once session is no longer opening', async () => {
    useTerminalStore.getState().ensureSession('tm_3')
    useTerminalStore.getState().setStatus('tm_3', 'exited')
    sftpLs.mockRejectedValue(new Error('SSH session is closed'))
    await loadSftpDir('tm_3', '.')
    expect(sftpLs).toHaveBeenCalledTimes(1)
    expect(useTerminalFsStore.getState().getSlice('tm_3').error).toBe('session_closed')
  })

  it('sets plain error when non-session failure', async () => {
    useTerminalStore.getState().ensureSession('tm_4')
    useTerminalStore.getState().setStatus('tm_4', 'running')
    sftpLs.mockRejectedValue(new Error('SFTP ls failed: permission denied'))
    await loadSftpDir('tm_4', '.')
    expect(useTerminalFsStore.getState().getSlice('tm_4').error).toMatch(/permission denied/)
  })
})

describe('transfer queue', () => {
  beforeEach(() => {
    useTerminalFsStore.setState({ byTerminal: {}, transfers: [] })
    useTerminalStore.setState({ bySession: {}, attachedSessionId: null, attachedTerminalId: null })
    sftpDownload.mockReset()
    sftpUpload.mockReset()
    pickSavePath.mockReset()
    pickFiles.mockReset()
    pickSavePath.mockResolvedValue('/tmp/save')
  })

  it('queues a second download on the same terminal until the first finishes', async () => {
    let releaseFirst!: () => void
    const gate = new Promise<void>((r) => {
      releaseFirst = r
    })
    sftpDownload.mockImplementationOnce(() => gate)
    sftpDownload.mockResolvedValue(undefined)

    const p1 = runSftpDownload('tm_q1', '/remote/a.txt', 'a.txt', tStub)
    const p2 = runSftpDownload('tm_q1', '/remote/b.txt', 'b.txt', tStub)

    await flush()
    await flush()
    // First transfer is running, second is waiting — not failed.
    expect(sftpDownload).toHaveBeenCalledTimes(1)
    expect(sftpDownload).toHaveBeenNthCalledWith(
      1,
      'tm_q1',
      '/remote/a.txt',
      '/tmp/save',
      expect.objectContaining({ force: false, opId: expect.any(String) }),
    )
    expect(phaseOf('a.txt')).toBe('started')
    expect(phaseOf('b.txt')).toBe('queued')

    try {
      releaseFirst()
    } finally {
      // Always drain the queue (free the global slot) even on assertion failure.
      await Promise.all([p1, p2])
    }

    // Second transfer ran only after the first completed.
    expect(sftpDownload).toHaveBeenCalledTimes(2)
    expect(sftpDownload).toHaveBeenNthCalledWith(2, 'tm_q1', '/remote/b.txt', '/tmp/save', expect.anything())
    expect(phaseOf('b.txt')).toBe('started')
  })

  it('queues across terminals once the global cap of 2 is reached', async () => {
    const gates: Array<() => void> = []
    sftpDownload.mockImplementation(
      () => new Promise<void>((r) => gates.push(r)),
    )

    const pA = runSftpDownload('tm_a', '/r/a', 'a', tStub)
    const pB = runSftpDownload('tm_b', '/r/b', 'b', tStub)
    const pC = runSftpDownload('tm_c', '/r/c', 'c', tStub)

    await flush()
    await flush()
    // Two global slots are taken; the third terminal waits.
    expect(sftpDownload).toHaveBeenCalledTimes(2)
    expect(phaseOf('a')).toBe('started')
    expect(phaseOf('b')).toBe('started')
    expect(phaseOf('c')).toBe('queued')

    try {
      gates[0]()
      await flush()
      await flush()
      expect(sftpDownload).toHaveBeenCalledTimes(3)
      expect(sftpDownload).toHaveBeenNthCalledWith(3, 'tm_c', '/r/c', '/tmp/save', expect.anything())
      expect(phaseOf('c')).toBe('started')
    } finally {
      // Always drain the queue (free the global slots) even on assertion failure.
      // Every mock call pushed its own gate — release them all.
      gates.forEach((g) => g())
      await Promise.all([pA, pB, pC])
    }
  })

  it('queues multi-file uploads on the same terminal in order', async () => {
    pickFiles.mockResolvedValue(['/tmp/f1.txt', '/tmp/f2.txt'])
    let releaseFirst!: () => void
    const gate = new Promise<void>((r) => {
      releaseFirst = r
    })
    sftpUpload.mockImplementationOnce(() => gate)
    sftpUpload.mockResolvedValue(undefined)

    const p = runSftpUploadIntoDir('tm_q2', '/remote/dir', tStub)

    await flush()
    await flush()
    // First file is uploading; the second waits in the queue — not failed.
    expect(sftpUpload).toHaveBeenCalledTimes(1)
    expect(phaseOf('f1.txt')).toBe('started')
    expect(phaseOf('f2.txt')).toBe('queued')

    try {
      releaseFirst()
    } finally {
      // Always drain the queue (free the global slot) even on assertion failure.
      await p
    }

    expect(sftpUpload).toHaveBeenCalledTimes(2)
    expect(sftpUpload).toHaveBeenNthCalledWith(
      1,
      'tm_q2',
      '/tmp/f1.txt',
      '/remote/dir/f1.txt',
      expect.objectContaining({ force: false, opId: expect.any(String) }),
    )
    expect(sftpUpload).toHaveBeenNthCalledWith(
      2,
      'tm_q2',
      '/tmp/f2.txt',
      '/remote/dir/f2.txt',
      expect.objectContaining({ force: false, opId: expect.any(String) }),
    )
    expect(phaseOf('f2.txt')).toBe('started')
  })
})
