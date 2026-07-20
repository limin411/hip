import { beforeEach, describe, expect, it, vi } from 'vitest'

const sftpLs = vi.fn()
vi.mock('@/ipc/sftp', () => ({
  sftpLs: (...args: unknown[]) => sftpLs(...args),
  isSessionClosedError: (err: unknown) =>
    /session is closed|SessionClosed|no ssh session/i.test(
      String(err instanceof Error ? err.message : err),
    ),
  isAlreadyExistsError: () => false,
  mintSftpOpId: () => 'sftp_test',
  sftpDownload: vi.fn(),
  sftpUpload: vi.fn(),
}))

import { loadSftpDir } from './sftpActions'
import { useTerminalFsStore } from '@/store/terminalFsStore'
import { useTerminalStore } from '@/store/terminalStore'

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
