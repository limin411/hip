import { beforeEach, describe, expect, it, vi } from 'vitest'

const termFsLs = vi.fn()
vi.mock('@/ipc/termFs', () => ({
  termFsLs: (...args: unknown[]) => termFsLs(...args),
  isTermFsNotReadyError: (err: unknown) =>
    String(err instanceof Error ? err.message : err).includes('no local terminal session'),
}))

import { loadLocalDir } from './termFsActions'
import { useTerminalFsStore } from '@/store/terminalFsStore'

describe('loadLocalDir', () => {
  beforeEach(() => {
    useTerminalFsStore.setState({ byTerminal: {}, transfers: [] })
    termFsLs.mockReset()
  })

  it('stores rootPath and entries on success', async () => {
    termFsLs.mockResolvedValue({
      path: '/home/u/proj',
      entries: [{ name: 'src', path: '/home/u/proj/src', isDir: true }],
    })
    await loadLocalDir('tm_1', '.')
    const slice = useTerminalFsStore.getState().getSlice('tm_1')
    expect(slice.rootPath).toBe('/home/u/proj')
    expect(slice.entriesByDir['/home/u/proj']).toHaveLength(1)
    expect(slice.error).toBeNull()
  })

  it('retries when session not ready then succeeds', async () => {
    termFsLs
      .mockRejectedValueOnce(new Error('no local terminal session for term_fs_ls'))
      .mockResolvedValueOnce({
        path: '/tmp/r',
        entries: [],
      })
    await loadLocalDir('tm_2', '.')
    expect(termFsLs).toHaveBeenCalledTimes(2)
    expect(useTerminalFsStore.getState().getSlice('tm_2').rootPath).toBe('/tmp/r')
  })

  it('sets error when non-retryable failure', async () => {
    termFsLs.mockRejectedValue(new Error('path escapes terminal root'))
    await loadLocalDir('tm_3', '/etc')
    expect(useTerminalFsStore.getState().getSlice('tm_3').error).toMatch(/escapes/)
  })
})
