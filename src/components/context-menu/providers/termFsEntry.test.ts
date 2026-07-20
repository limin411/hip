import { beforeEach, describe, expect, it, vi } from 'vitest'
import { termFsEntryProvider } from './termFsEntry'
import type { ContextMenuBuildContext, ContextRequest } from '../types'

const refreshLocalDir = vi.fn()
const openContainingFolder = vi.fn()

vi.mock('@/components/terminals/termFsActions', () => ({
  refreshLocalDir: (...args: unknown[]) => refreshLocalDir(...args),
}))

vi.mock('@/ipc/openPath', () => ({
  openContainingFolder: (...args: unknown[]) => openContainingFolder(...args),
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

describe('termFsEntryProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('file entry offers copy + open folder + refresh parent', () => {
    const req: ContextRequest = {
      kind: 'termFsEntry',
      payload: {
        terminalId: 'tm_1',
        path: '/home/u/proj/a.txt',
        name: 'a.txt',
        isDir: false,
        rootCwd: '/home/u/proj',
      },
    }
    const items = termFsEntryProvider(req, ctx())
    const ids = items.map((i) => i.id)
    expect(ids).toContain('termFs.copyPath')
    expect(ids).toContain('termFs.copyName')
    expect(ids).toContain('termFs.openContainingFolder')
    expect(ids).toContain('termFs.refreshParent')
    expect(ids).not.toContain('termFs.refresh')
  })

  it('dir entry offers refresh', () => {
    const req: ContextRequest = {
      kind: 'termFsEntry',
      payload: {
        terminalId: 'tm_1',
        path: '/home/u/proj/sub',
        name: 'sub',
        isDir: true,
        rootCwd: '/home/u/proj',
      },
    }
    const items = termFsEntryProvider(req, ctx())
    const ids = items.map((i) => i.id)
    expect(ids).toContain('termFs.refresh')
    expect(ids).not.toContain('termFs.refreshParent')

    items.find((i) => i.id === 'termFs.refresh')!.run?.()
    expect(refreshLocalDir).toHaveBeenCalledWith('tm_1', '/home/u/proj/sub')
  })

  it('openContainingFolder disabled without rootCwd', () => {
    const req: ContextRequest = {
      kind: 'termFsEntry',
      payload: {
        terminalId: 'tm_1',
        path: '/tmp/x',
        name: 'x',
        isDir: true,
        rootCwd: '',
      },
    }
    const items = termFsEntryProvider(req, ctx())
    const open = items.find((i) => i.id === 'termFs.openContainingFolder')!
    expect(open.disabled).toBe(true)
  })
})
