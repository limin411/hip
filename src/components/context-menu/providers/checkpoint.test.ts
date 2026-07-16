import { describe, it, expect, beforeEach, vi } from 'vitest'
import { openCheckpointRevertModal, bindCheckpointRevertOpener } from '@/components/artifact/checkpointRevertUi'
import { checkpointProvider } from './checkpoint'
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
  bindCheckpointRevertOpener(null)
})

describe('checkpointProvider', () => {
  it('returns copyId and revert', async () => {
    const open = vi.fn()
    bindCheckpointRevertOpener(open)
    const items = checkpointProvider(
      { kind: 'checkpoint', payload: { checkpointId: 's1:t1', sessionId: 's1' } },
      makeCtx(),
    )
    expect(items.map((i) => i.id)).toEqual(['checkpoint.copyId', 'checkpoint.revert'])

    await items[0]!.run()
    expect(copyText).toHaveBeenCalledWith('s1:t1')

    await items[1]!.run()
    expect(open).toHaveBeenCalledWith('s1:t1')
  })

  it('disables revert while session is running', () => {
    const items = checkpointProvider(
      { kind: 'checkpoint', payload: { checkpointId: 's1:t1', sessionId: 's1' } },
      makeCtx({ sessionStatus: 'running' }),
    )
    const revert = items.find((i) => i.id === 'checkpoint.revert')
    expect(revert?.disabled).toBe(true)
  })

  it('openCheckpointRevertModal no-ops without listener', () => {
    expect(() => openCheckpointRevertModal('x')).not.toThrow()
  })
})
