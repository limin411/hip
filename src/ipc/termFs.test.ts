import { describe, it, expect, vi, beforeEach } from 'vitest'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}))

import {
  isTermFsEscapeError,
  isTermFsNotReadyError,
  termFsLs,
} from './termFs'

describe('termFs IPC', () => {
  beforeEach(() => {
    invoke.mockReset()
  })

  it('termFsLs invokes term_fs_ls with camelCase args', async () => {
    invoke.mockResolvedValue({
      path: '/home/u/proj',
      entries: [{ name: 'a', path: '/home/u/proj/a', isDir: true }],
    })
    const got = await termFsLs('tm_abc', '.')
    expect(invoke).toHaveBeenCalledWith('term_fs_ls', {
      terminalId: 'tm_abc',
      path: '.',
    })
    expect(got.path).toBe('/home/u/proj')
    expect(got.entries).toHaveLength(1)
  })

  it('isTermFsNotReadyError matches session-missing messages', () => {
    expect(isTermFsNotReadyError('no local terminal session for term_fs_ls')).toBe(true)
    expect(isTermFsNotReadyError(new Error('term_fs_ls requires managed terminal id (tm_*)'))).toBe(
      true,
    )
    expect(isTermFsNotReadyError('permission denied')).toBe(false)
  })

  it('isTermFsEscapeError matches escape messages', () => {
    expect(isTermFsEscapeError('path escapes terminal root')).toBe(true)
    expect(isTermFsEscapeError('path escapes terminal root via symlink')).toBe(true)
    expect(isTermFsEscapeError('not a directory')).toBe(false)
  })
})
