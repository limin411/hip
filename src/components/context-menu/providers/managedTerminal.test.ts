import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ContextMenuBuildContext } from '../types'

const close = vi.fn(async (_id: string) => {})
const setTitle = vi.fn()
const getTerminal = vi.fn((_id: string) => ({ title: 'live-title' }) as { title: string } | undefined)

vi.mock('@/store/managedTerminalStore', () => ({
  useManagedTerminalStore: {
    getState: () => ({
      close: (id: string) => close(id),
      setTitle: (id: string, title: string) => setTitle(id, title),
      getTerminal: (id: string) => getTerminal(id),
    }),
  },
}))

const openRename = vi.fn()
vi.mock('@/components/terminals/managedTerminalDialogStore', () => ({
  openRenameManagedTerminalDialog: (id: string, title: string) => openRename(id, title),
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
    setTitle.mockReset()
    openRename.mockReset()
    getTerminal.mockReset().mockReturnValue({ title: 'live-title' })
  })

  it('returns empty for other kinds', () => {
    const items = managedTerminalProvider(
      { kind: 'terminal', payload: { sessionId: 's1', status: 'running' } },
      makeCtx(),
    )
    expect(items).toEqual([])
  })

  it('offers rename, copy title, and close', async () => {
    const copyText = vi.fn(async () => true)
    const items = managedTerminalProvider(
      {
        kind: 'managedTerminal',
        payload: { terminalId: 'tm_1', kind: 'local', title: 'payload-title' },
      },
      makeCtx({ copyText }),
    )
    expect(items.map((i) => i.id)).toEqual([
      'managedTerminal.rename',
      'managedTerminal.copyTitle',
      'managedTerminal.close',
    ])

    items.find((i) => i.id === 'managedTerminal.rename')!.run()
    expect(openRename).toHaveBeenCalledWith('tm_1', 'live-title')

    items.find((i) => i.id === 'managedTerminal.copyTitle')!.run()
    expect(copyText).toHaveBeenCalledWith('live-title')

    await items.find((i) => i.id === 'managedTerminal.close')!.run()
    expect(close).toHaveBeenCalledWith('tm_1')
  })

  it('rename falls back to payload title when terminal missing', () => {
    getTerminal.mockReturnValue(undefined)
    const items = managedTerminalProvider(
      {
        kind: 'managedTerminal',
        payload: { terminalId: 'tm_x', kind: 'local', title: 'payload-title' },
      },
      makeCtx(),
    )
    items.find((i) => i.id === 'managedTerminal.rename')!.run()
    expect(openRename).toHaveBeenCalledWith('tm_x', 'payload-title')
  })
})
