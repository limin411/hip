import { describe, it, expect, vi } from 'vitest'
import { codeBlockProvider } from './codeBlock'
import type { ContextMenuBuildContext } from '../types'

function makeCtx(overrides: Partial<ContextMenuBuildContext> = {}): ContextMenuBuildContext {
  return {
    t: ((key: string) => key) as ContextMenuBuildContext['t'],
    isMac: true,
    activeView: 'chat',
    surface: 'chat',
    activeSessionId: null,
    sessionStatus: 'idle',
    sessionInterrupt: false,
    copyText: vi.fn(async () => true),
    ...overrides,
  }
}

describe('codeBlockProvider', () => {
  it('returns [] for non-codeBlock kinds', () => {
    expect(
      codeBlockProvider(
        {
          kind: 'message',
          payload: { message: {} as never, isLastAssistant: false, sessionId: null },
        },
        makeCtx(),
      ),
    ).toEqual([])
  })

  it('emits codeBlock.copy', async () => {
    const copyText = vi.fn(async () => true)
    const items = codeBlockProvider(
      { kind: 'codeBlock', payload: { code: 'const x = 1' } },
      makeCtx({ copyText }),
    )
    expect(items.map((i) => i.id)).toEqual(['codeBlock.copy'])
    await items[0]!.run()
    expect(copyText).toHaveBeenCalledWith('const x = 1')
  })

  it('does not copy empty code', async () => {
    const copyText = vi.fn(async () => true)
    const items = codeBlockProvider(
      { kind: 'codeBlock', payload: { code: '' } },
      makeCtx({ copyText }),
    )
    await items[0]!.run()
    expect(copyText).not.toHaveBeenCalled()
  })
})
