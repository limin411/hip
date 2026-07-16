import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useDiffStore } from '@/store/diffStore'
import { diffFileProvider } from './diffFile'
import type { ContextMenuBuildContext } from '../types'

const copyText = vi.fn(async () => true)

function makeCtx(overrides: Partial<ContextMenuBuildContext> = {}): ContextMenuBuildContext {
  return {
    t: ((key: string) => key) as ContextMenuBuildContext['t'],
    isMac: true,
    activeView: 'code',
    surface: 'code',
    activeSessionId: 's1',
    sessionStatus: 'idle',
    sessionInterrupt: false,
    copyText,
    ...overrides,
  }
}

beforeEach(() => {
  copyText.mockClear()
  useDiffStore.setState({ bySession: {} })
})

describe('diffFileProvider', () => {
  it('returns [] for wrong kind', () => {
    expect(
      diffFileProvider(
        { kind: 'message', payload: { message: {} as never, isLastAssistant: false, sessionId: null } },
        makeCtx(),
      ),
    ).toEqual([])
  })

  it('copies relative path and absolute path when under cwd', async () => {
    const items = diffFileProvider(
      {
        kind: 'diffFile',
        payload: { path: 'src/a.ts', status: 'modified', sessionId: 's1', cwd: '/proj' },
      },
      makeCtx(),
    )
    expect(items.map((i) => i.id)).toContain('diffFile.copyPath')
    expect(items.map((i) => i.id)).toContain('diffFile.copyAbsolutePath')
    expect(items.map((i) => i.id)).toContain('diffFile.openInFiles')

    await items.find((i) => i.id === 'diffFile.copyPath')!.run()
    expect(copyText).toHaveBeenCalledWith('src/a.ts')

    await items.find((i) => i.id === 'diffFile.copyAbsolutePath')!.run()
    expect(copyText).toHaveBeenCalledWith('/proj/src/a.ts')
  })

  it('omits absolute/open when path escapes cwd', () => {
    const items = diffFileProvider(
      {
        kind: 'diffFile',
        payload: { path: '../secret', status: 'modified', sessionId: 's1', cwd: '/proj' },
      },
      makeCtx(),
    )
    expect(items.map((i) => i.id)).toEqual(['diffFile.copyPath', 'diffFile.toggleCollapse'])
  })

  it('offers showFull only for workspace files list', () => {
    useDiffStore.getState().setResult('s1', {
      state: 'ok',
      base: 'session-start',
      hasSessionStart: true,
      files: [
        {
          path: 'src/a.ts',
          status: 'modified',
          additions: 1,
          deletions: 0,
          hunks: [],
        },
      ],
    })
    const items = diffFileProvider(
      {
        kind: 'diffFile',
        payload: { path: 'src/a.ts', status: 'modified', sessionId: 's1', cwd: '/proj' },
      },
      makeCtx(),
    )
    expect(items.map((i) => i.id)).toContain('diffFile.showFull')
  })

  it('hides showFull for checkpoint-only paths not in workspace files', () => {
    useDiffStore.getState().setResult('s1', {
      state: 'ok',
      base: 'session-start',
      hasSessionStart: true,
      files: [],
    })
    const items = diffFileProvider(
      {
        kind: 'diffFile',
        payload: { path: 'only-in-checkpoint.ts', status: 'modified', sessionId: 's1', cwd: '/proj' },
      },
      makeCtx(),
    )
    expect(items.map((i) => i.id)).not.toContain('diffFile.showFull')
  })
})
