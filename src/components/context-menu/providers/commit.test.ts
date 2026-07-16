import { describe, it, expect, vi } from 'vitest'
import { commitProvider } from './commit'
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

describe('commitProvider', () => {
  it('copies sha and message', async () => {
    const items = commitProvider(
      {
        kind: 'commit',
        payload: { sha: 'abc123full', shortSha: 'abc123', message: 'fix bug', sessionId: 's1' },
      },
      makeCtx(),
    )
    expect(items.map((i) => i.id)).toEqual(['commit.copySha', 'commit.copyMessage'])
    await items[0]!.run()
    expect(copyText).toHaveBeenCalledWith('abc123full')
    await items[1]!.run()
    expect(copyText).toHaveBeenCalledWith('fix bug')
  })
})
