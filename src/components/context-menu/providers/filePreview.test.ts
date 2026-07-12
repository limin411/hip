import { describe, it, expect, vi, beforeEach } from 'vitest'
import { filePreviewProvider } from './filePreview'
import type { ContextMenuBuildContext, ContextPayloadMap } from '../types'

const { readFile, readDraftFile, openContainingFolder } = vi.hoisted(() => ({
  readFile: vi.fn(),
  readDraftFile: vi.fn(),
  openContainingFolder: vi.fn(async () => true),
}))

vi.mock('@/domain', async () => {
  const actual = await vi.importActual<typeof import('@/domain')>('@/domain')
  return {
    ...actual,
    sessionService: {
      ...actual.sessionService,
      readFile,
      readDraftFile,
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
  partial: Partial<ContextPayloadMap['filePreview']> = {},
): ContextPayloadMap['filePreview'] {
  return {
    path: '/project/src/a.ts',
    content: 'export const a = 1',
    mimeType: 'text/plain',
    cwd: '/project',
    ...partial,
  }
}

describe('filePreviewProvider', () => {
  beforeEach(() => {
    readFile.mockClear()
    readDraftFile.mockClear()
    openContainingFolder.mockClear()
  })

  it('returns [] for other kinds', () => {
    expect(
      filePreviewProvider(
        { kind: 'message', payload: { message: {} as never, isLastAssistant: false, sessionId: null } },
        makeCtx(),
      ),
    ).toEqual([])
  })

  it('returns [] when path is empty', () => {
    expect(
      filePreviewProvider({ kind: 'filePreview', payload: payload({ path: '' }) }, makeCtx()),
    ).toEqual([])
  })

  it('emits preview actions', () => {
    const items = filePreviewProvider({ kind: 'filePreview', payload: payload() }, makeCtx())
    expect(items.map((i) => i.id)).toEqual([
      'filePreview.copyPath',
      'filePreview.copyContent',
      'filePreview.openContainingFolder',
      'filePreview.refresh',
    ])
  })

  it('copies path and text content', async () => {
    const copyText = vi.fn(async () => true)
    const items = filePreviewProvider(
      { kind: 'filePreview', payload: payload() },
      makeCtx({ copyText }),
    )
    await items.find((i) => i.id === 'filePreview.copyPath')!.run()
    await items.find((i) => i.id === 'filePreview.copyContent')!.run()
    expect(copyText).toHaveBeenCalledWith('/project/src/a.ts')
    expect(copyText).toHaveBeenCalledWith('export const a = 1')
  })

  it('disables copy content for images / missing content', () => {
    const imageItems = filePreviewProvider(
      {
        kind: 'filePreview',
        payload: payload({
          path: '/project/logo.png',
          content: 'iVBORw0KGgo=',
          mimeType: 'image/png',
        }),
      },
      makeCtx(),
    )
    expect(imageItems.find((i) => i.id === 'filePreview.copyContent')?.disabled).toBe(true)

    const emptyItems = filePreviewProvider(
      { kind: 'filePreview', payload: payload({ content: undefined }) },
      makeCtx(),
    )
    expect(emptyItems.find((i) => i.id === 'filePreview.copyContent')?.disabled).toBe(true)
  })

  it('allows copy content for markdown', async () => {
    const copyText = vi.fn(async () => true)
    const items = filePreviewProvider(
      {
        kind: 'filePreview',
        payload: payload({
          path: '/project/README.md',
          content: '# Hi',
          mimeType: 'text/markdown',
        }),
      },
      makeCtx({ copyText }),
    )
    expect(items.find((i) => i.id === 'filePreview.copyContent')?.disabled).toBeFalsy()
    await items.find((i) => i.id === 'filePreview.copyContent')!.run()
    expect(copyText).toHaveBeenCalledWith('# Hi')
  })

  it('disables open containing folder when outside cwd or cwd null', () => {
    const outside = filePreviewProvider(
      {
        kind: 'filePreview',
        payload: payload({ path: '/other/a.ts', cwd: '/project' }),
      },
      makeCtx(),
    )
    expect(outside.find((i) => i.id === 'filePreview.openContainingFolder')?.disabled).toBe(true)

    const noCwd = filePreviewProvider(
      { kind: 'filePreview', payload: payload({ cwd: null }) },
      makeCtx(),
    )
    expect(noCwd.find((i) => i.id === 'filePreview.openContainingFolder')?.disabled).toBe(true)
  })

  it('openContainingFolder passes cwd + isDir false', async () => {
    const items = filePreviewProvider({ kind: 'filePreview', payload: payload() }, makeCtx())
    await items.find((i) => i.id === 'filePreview.openContainingFolder')!.run()
    expect(openContainingFolder).toHaveBeenCalledWith('/project/src/a.ts', {
      cwd: '/project',
      isDir: false,
    })
  })

  it('refresh uses readFile for session and readDraftFile for draft', () => {
    const sessionItems = filePreviewProvider(
      { kind: 'filePreview', payload: payload() },
      makeCtx({ activeSessionId: 's1' }),
    )
    sessionItems.find((i) => i.id === 'filePreview.refresh')!.run()
    expect(readFile).toHaveBeenCalledWith('s1', '/project/src/a.ts')
    expect(readDraftFile).not.toHaveBeenCalled()

    readFile.mockClear()
    const draftItems = filePreviewProvider(
      { kind: 'filePreview', payload: payload() },
      makeCtx({ activeSessionId: null }),
    )
    draftItems.find((i) => i.id === 'filePreview.refresh')!.run()
    expect(readDraftFile).toHaveBeenCalledWith('/project', '/project/src/a.ts')
    expect(readFile).not.toHaveBeenCalled()
  })
})
