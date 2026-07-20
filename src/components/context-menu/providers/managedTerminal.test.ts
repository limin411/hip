import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ContextMenuBuildContext } from '../types'

const close = vi.fn(async (_id: string) => {})

vi.mock('@/store/managedTerminalStore', () => ({
  useManagedTerminalStore: {
    getState: () => ({ close: (id: string) => close(id) }),
  },
}))

import { managedTerminalProvider } from './managedTerminal'

function makeCtx(overrides: Partial<ContextMenuBuildContext> = {}): ContextMenuBuildContext {
  return {
    t: ((key: string) => key) as ContextMenuBuildContext['t'],
    isMac: false,
    activeView: 'terminals',
    surface: null,
    activeSessionId: null,
    sessionStatus: 'idle',
    sessionInterrupt: false,
    copyText: vi.fn(async () => true),
    ...overrides,
  }
}

describe('managedTerminalProvider', () => {
  beforeEach(() => {
    close.mockReset()
  })

  it('returns empty for other kinds', () => {
    const items = managedTerminalProvider(
      { kind: 'terminal', payload: { sessionId: 's1', status: 'running' } },
      makeCtx(),
    )
    expect(items).toEqual([])
  })

  it('offers copy title and close', async () => {
    const copyText = vi.fn(async () => true)
    const items = managedTerminalProvider(
      {
        kind: 'managedTerminal',
        payload: { terminalId: 'tm_1', kind: 'local', title: 'hip' },
      },
      makeCtx({ copyText }),
    )
    expect(items.map((i) => i.id)).toEqual([
      'managedTerminal.copyTitle',
      'managedTerminal.close',
    ])
    items[0]!.run()
    expect(copyText).toHaveBeenCalledWith('hip')
    await items[1]!.run()
    expect(close).toHaveBeenCalledWith('tm_1')
  })
})
