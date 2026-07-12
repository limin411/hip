import { describe, it, expect, beforeEach, vi } from 'vitest'
import { bindTerminalRestarter } from '@/components/artifact/terminalRestartUi'
import {
  bindTerminalCanvas,
} from '@/components/artifact/terminalCanvasUi'
import { useDomainStore } from '@/domain/sessionStore'
import { terminalProvider } from './terminal'
import type { ContextMenuBuildContext } from '../types'

const copyText = vi.fn(async () => true)
const setProjectDir = vi.fn()
const pickDirectory = vi.fn()
const readText = vi.fn(async () => 'pasted')

vi.mock('@/ipc/dialog', () => ({
  pickDirectory: (...a: unknown[]) => pickDirectory(...a),
}))

vi.mock('@/ipc/clipboard', () => ({
  readText: () => readText(),
}))

vi.mock('@/domain/sessionService', () => ({
  sessionService: {
    setProjectDir: (...a: unknown[]) => setProjectDir(...a),
  },
}))

function makeCtx(): ContextMenuBuildContext {
  return {
    t: ((key: string) => key) as ContextMenuBuildContext['t'],
    isMac: true,
    activeView: 'code',
    surface: 'code',
    activeSessionId: 's1',
    sessionStatus: 'idle',
    sessionInterrupt: false,
    openSessionIds: ['s1'],
    copyText,
  }
}

beforeEach(() => {
  copyText.mockClear()
  setProjectDir.mockClear()
  pickDirectory.mockReset()
  readText.mockReset().mockResolvedValue('pasted')
  bindTerminalRestarter(null)
  bindTerminalCanvas(null)
  useDomainStore.setState({
    sessions: [
      {
        id: 's1',
        title: 't',
        status: 'idle',
        config: { cwd: '/work/proj' },
      } as never,
    ],
    activeSessionId: 's1',
  })
})

describe('terminalProvider', () => {
  it('includes restart, changeFolder, copyCwd, openFiles for chrome (default)', async () => {
    const restart = vi.fn()
    bindTerminalRestarter(restart)
    const items = terminalProvider(
      { kind: 'terminal', payload: { sessionId: 's1', status: 'running' } },
      makeCtx(),
    )
    expect(items.map((i) => i.id)).toEqual([
      'terminal.restart',
      'terminal.changeFolder',
      'terminal.copyCwd',
      'terminal.openFiles',
    ])

    await items.find((i) => i.id === 'terminal.restart')!.run()
    expect(restart).toHaveBeenCalledWith('s1')

    await items.find((i) => i.id === 'terminal.copyCwd')!.run()
    expect(copyText).toHaveBeenCalledWith('/work/proj')
  })

  it('omits copyCwd when session has no cwd', () => {
    useDomainStore.setState({
      sessions: [
        {
          id: 's1',
          title: 't',
          status: 'idle',
          config: {},
        } as never,
      ],
      activeSessionId: 's1',
    })
    const items = terminalProvider(
      { kind: 'terminal', payload: { sessionId: 's1', status: 'idle' } },
      makeCtx(),
    )
    expect(items.map((i) => i.id)).not.toContain('terminal.copyCwd')
  })

  it('canvas target: copy selection, paste, restart', async () => {
    const restart = vi.fn()
    const paste = vi.fn()
    bindTerminalRestarter(restart)
    bindTerminalCanvas({
      getSelection: () => 'hello sel',
      hasSelection: () => true,
      paste,
    })

    const items = terminalProvider(
      { kind: 'terminal', payload: { sessionId: 's1', status: 'running', target: 'canvas' } },
      makeCtx(),
    )
    expect(items.map((i) => i.id)).toEqual([
      'terminal.copySelection',
      'terminal.paste',
      'terminal.restart',
    ])
    expect(items.find((i) => i.id === 'terminal.copySelection')!.disabled).toBe(false)

    await items.find((i) => i.id === 'terminal.copySelection')!.run()
    expect(copyText).toHaveBeenCalledWith('hello sel')

    await items.find((i) => i.id === 'terminal.paste')!.run()
    expect(readText).toHaveBeenCalled()
    expect(paste).toHaveBeenCalledWith('pasted')

    await items.find((i) => i.id === 'terminal.restart')!.run()
    expect(restart).toHaveBeenCalledWith('s1')
  })

  it('canvas copy is disabled when there is no selection', () => {
    bindTerminalCanvas({
      getSelection: () => '',
      hasSelection: () => false,
      paste: () => {},
    })
    const items = terminalProvider(
      { kind: 'terminal', payload: { sessionId: 's1', status: 'running', target: 'canvas' } },
      makeCtx(),
    )
    const copy = items.find((i) => i.id === 'terminal.copySelection')!
    expect(copy.disabled).toBe(true)
    expect(copy.disabledReason).toBe('contextMenu.terminal.copySelectionDisabled')
  })
})
