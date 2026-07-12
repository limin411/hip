import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fileEntryProvider } from './fileEntry'
import type { ContextMenuBuildContext, ContextPayloadMap } from '../types'

const { lsDir, lsDraft, readFile, readDraftFile, openContainingFolder } = vi.hoisted(() => ({
  lsDir: vi.fn(),
  lsDraft: vi.fn(),
  readFile: vi.fn(),
  readDraftFile: vi.fn(),
  openContainingFolder: vi.fn(async () => true),
}))

vi.mock('@/domain', async () => {
  const actual = await vi.importActual<typeof import('@/domain')>('@/domain')
  return {
    ...actual,
    sessionService: {
      lsDir,
      lsDraft,
      readFile,
      readDraftFile,
      setProjectDir: vi.fn(),
    },
  }
})

vi.mock('@/ipc/openPath', () => ({ openContainingFolder }))

function makeCtx(overrides: Partial<ContextMenuBuildContext> = {}): ContextMenuBuildContext {
  return {
    t: ((key: string) => key) as ContextMenuBuildContext['t'],
    isMac: true,
    activeView: 'code',
    surface: 'code',
    activeSessionId: 's1',
    sessionStatus: 'idle',
    sessionInterrupt: false,
    openSessionIds: ['s1'],
    copyText: vi.fn(async () => true),
    ...overrides,
  }
}

function payload(
  partial: Partial<ContextPayloadMap['fileEntry']> = {},
): ContextPayloadMap['fileEntry'] {
  return {
    path: '/project/src/a.ts',
    name: 'a.ts',
    isDir: false,
    scopeId: 's1',
    isDraft: false,
    cwd: '/project',
    ...partial,
  }
}

describe('fileEntryProvider', () => {
  beforeEach(() => {
    lsDir.mockClear()
    lsDraft.mockClear()
    readFile.mockClear()
    readDraftFile.mockClear()
    openContainingFolder.mockClear()
  })

  it('returns [] for other kinds', () => {
    expect(
      fileEntryProvider(
        { kind: 'message', payload: { message: {} as never, isLastAssistant: false, sessionId: null } },
        makeCtx(),
      ),
    ).toEqual([])
  })

  it('emits file actions for a file entry', () => {
    const items = fileEntryProvider({ kind: 'fileEntry', payload: payload() }, makeCtx())
    expect(items.map((i) => i.id)).toEqual([
      'file.open',
      'file.copyPath',
      'file.copyRelativePath',
      'file.copyName',
      'file.openContainingFolder',
    ])
    expect(items.find((i) => i.id === 'file.refresh')).toBeUndefined()
  })

  it('includes refresh for directories only', () => {
    const items = fileEntryProvider(
      { kind: 'fileEntry', payload: payload({ path: '/project/src', name: 'src', isDir: true }) },
      makeCtx(),
    )
    expect(items.map((i) => i.id)).toContain('file.refresh')
  })

  it('copies absolute, relative, and name', async () => {
    const copyText = vi.fn(async () => true)
    const items = fileEntryProvider({ kind: 'fileEntry', payload: payload() }, makeCtx({ copyText }))
    await items.find((i) => i.id === 'file.copyPath')!.run()
    await items.find((i) => i.id === 'file.copyRelativePath')!.run()
    await items.find((i) => i.id === 'file.copyName')!.run()
    expect(copyText).toHaveBeenCalledWith('/project/src/a.ts')
    expect(copyText).toHaveBeenCalledWith('src/a.ts')
    expect(copyText).toHaveBeenCalledWith('a.ts')
  })

  it('disables relative copy and open folder when outside cwd', () => {
    const items = fileEntryProvider(
      {
        kind: 'fileEntry',
        payload: payload({ path: '/other/a.ts', name: 'a.ts', cwd: '/project' }),
      },
      makeCtx(),
    )
    expect(items.find((i) => i.id === 'file.copyRelativePath')?.disabled).toBe(true)
    expect(items.find((i) => i.id === 'file.openContainingFolder')?.disabled).toBe(true)
  })

  it('disables relative copy and open folder when cwd is null', () => {
    const items = fileEntryProvider(
      {
        kind: 'fileEntry',
        payload: payload({ cwd: null }),
      },
      makeCtx(),
    )
    expect(items.find((i) => i.id === 'file.copyRelativePath')?.disabled).toBe(true)
    expect(items.find((i) => i.id === 'file.openContainingFolder')?.disabled).toBe(true)
  })

  it('openContainingFolder passes cwd + isDir', async () => {
    const items = fileEntryProvider({ kind: 'fileEntry', payload: payload() }, makeCtx())
    await items.find((i) => i.id === 'file.openContainingFolder')!.run()
    expect(openContainingFolder).toHaveBeenCalledWith('/project/src/a.ts', {
      cwd: '/project',
      isDir: false,
    })
  })

  it('open file uses readFile; draft uses readDraftFile', () => {
    const sessionItems = fileEntryProvider(
      { kind: 'fileEntry', payload: payload({ isDraft: false, scopeId: 's1' }) },
      makeCtx(),
    )
    sessionItems.find((i) => i.id === 'file.open')!.run()
    expect(readFile).toHaveBeenCalledWith('s1', '/project/src/a.ts')

    const draftItems = fileEntryProvider(
      {
        kind: 'fileEntry',
        payload: payload({ isDraft: true, scopeId: '/project', path: '/project/b.ts', name: 'b.ts' }),
      },
      makeCtx(),
    )
    draftItems.find((i) => i.id === 'file.open')!.run()
    expect(readDraftFile).toHaveBeenCalledWith('/project', '/project/b.ts')
  })

  it('refresh dir uses lsDir vs lsDraft', () => {
    const sessionItems = fileEntryProvider(
      {
        kind: 'fileEntry',
        payload: payload({ path: '/project/src', name: 'src', isDir: true, isDraft: false, scopeId: 's1' }),
      },
      makeCtx(),
    )
    sessionItems.find((i) => i.id === 'file.refresh')!.run()
    expect(lsDir).toHaveBeenCalledWith('s1', '/project/src')

    const draftItems = fileEntryProvider(
      {
        kind: 'fileEntry',
        payload: payload({
          path: '/project/src',
          name: 'src',
          isDir: true,
          isDraft: true,
          scopeId: '/project',
        }),
      },
      makeCtx(),
    )
    draftItems.find((i) => i.id === 'file.refresh')!.run()
    expect(lsDraft).toHaveBeenCalledWith('/project', '/project/src')
  })
})
