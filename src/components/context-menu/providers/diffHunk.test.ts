import { describe, it, expect, vi } from 'vitest'
import { diffHunkProvider } from './diffHunk'
import type { ContextMenuBuildContext } from '../types'

const copyText = vi.fn(async () => true)

function makeCtx(): ContextMenuBuildContext {
  return {
    t: ((key: string) => key) as ContextMenuBuildContext['t'],
    isMac: true,
    activeView: 'code',
    surface: 'code',
    activeSessionId: 's1',
    sessionStatus: 'idle',
    sessionInterrupt: false,
    copyText,
  }
}

describe('diffHunkProvider', () => {
  it('copies hunk text', async () => {
    const items = diffHunkProvider(
      {
        kind: 'diffHunk',
        payload: { path: 'a.ts', header: 'fn', text: '@@ -1 +1 @@\n-old\n+new' },
      },
      makeCtx(),
    )
    expect(items.map((i) => i.id)).toEqual([
      'diffHunk.copy',
      'diffHunk.annotate',
      'diffHunk.quoteToComposer',
    ])
    await items[0]!.run()
    expect(copyText).toHaveBeenCalledWith('@@ -1 +1 @@\n-old\n+new')
  })

  it('returns [] when text empty', () => {
    expect(
      diffHunkProvider(
        { kind: 'diffHunk', payload: { path: 'a.ts', text: '' } },
        makeCtx(),
      ),
    ).toEqual([])
  })
})
