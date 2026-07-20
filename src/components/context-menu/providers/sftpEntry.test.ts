import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sftpEntryProvider } from './sftpEntry'
import type { ContextMenuBuildContext, ContextRequest } from '../types'

vi.mock('@/ipc/dialog', () => ({
  pickSavePath: vi.fn(),
  pickFiles: vi.fn(),
}))

vi.mock('@/ipc/sftp', () => ({
  mintSftpOpId: () => 'sftp_test',
  sftpDownload: vi.fn(),
  sftpUpload: vi.fn(),
  isAlreadyExistsError: () => false,
}))

vi.mock('@/components/terminals/TerminalFileTree', () => ({
  refreshSftpDir: vi.fn(),
}))

vi.mock('@/store/terminalFsStore', () => ({
  useTerminalFsStore: {
    getState: () => ({
      upsertTransfer: vi.fn(),
      removeTransfer: vi.fn(),
    }),
  },
}))

function ctx(): ContextMenuBuildContext {
  return {
    t: ((k: string) => k) as ContextMenuBuildContext['t'],
    isMac: false,
    activeView: 'terminals',
    surface: null,
    activeSessionId: null,
    sessionStatus: 'idle',
    sessionInterrupt: false,
    copyText: vi.fn(async () => true),
  }
}

describe('sftpEntryProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('file entry offers download + copy + refresh parent', () => {
    const req: ContextRequest = {
      kind: 'sftpEntry',
      payload: {
        terminalId: 'tm_1',
        path: '/home/u/a.txt',
        name: 'a.txt',
        isDir: false,
      },
    }
    const items = sftpEntryProvider(req, ctx())
    const ids = items.map((i) => i.id)
    expect(ids).toContain('sftp.download')
    expect(ids).toContain('sftp.copyPath')
    expect(ids).toContain('sftp.copyName')
    expect(ids).not.toContain('sftp.upload')
  })

  it('dir entry offers upload + refresh', () => {
    const req: ContextRequest = {
      kind: 'sftpEntry',
      payload: {
        terminalId: 'tm_1',
        path: '/home/u',
        name: 'u',
        isDir: true,
      },
    }
    const items = sftpEntryProvider(req, ctx())
    const ids = items.map((i) => i.id)
    expect(ids).toContain('sftp.upload')
    expect(ids).toContain('sftp.refresh')
    expect(ids).not.toContain('sftp.download')
  })
})
