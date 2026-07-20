import { describe, it, expect, beforeEach, vi } from 'vitest'
import { bindTerminalRestarter } from '@/components/artifact/terminalRestartUi'
import {
  bindTerminalCanvas,
} from '@/components/artifact/terminalCanvasUi'
import { useDomainStore } from '@/domain/sessionStore'
import { buildContextMenuItems } from '../registry'
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
    copyText,
  }
}

beforeEach(() => {
  copyText.mockClear()
  setProjectDir.mockClear()
  pickDirectory.mockReset()
  readText.mockReset().mockResolvedValue('pasted')
  bindTerminalRestarter('s1', null)
  bindTerminalCanvas('s1', null)
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
    bindTerminalRestarter('s1', restart)
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
    expect(restart).toHaveBeenCalled()

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
    bindTerminalRestarter('s1', restart)
    bindTerminalCanvas('s1', {
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
      'terminal.sendSelectionToChat',
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
    expect(restart).toHaveBeenCalled()
  })

  it('canvas copy is disabled when there is no selection', () => {
    bindTerminalCanvas('s1', {
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

  it('buildContextMenuItems preserves canvas order and strips leading separator', () => {
    bindTerminalCanvas('s1', {
      getSelection: () => 'x',
      hasSelection: () => true,
      paste: () => {},
    })
    const items = buildContextMenuItems(
      { kind: 'terminal', payload: { sessionId: 's1', status: 'running', target: 'canvas' } },
      makeCtx(),
    )
    // mergeByGroup orders clipboard then other groups; agent group lands after restart.
    expect(items.map((i) => i.id)).toEqual([
      'terminal.copySelection',
      'terminal.paste',
      'terminal.restart',
      'terminal.sendSelectionToChat',
    ])
    expect(items[0]!.separatorBefore).toBeFalsy()
    expect(items.find((i) => i.id === 'terminal.restart')!.separatorBefore).toBe(true)
  })

  it('does not use another terminalId canvas when sessionId differs', () => {
    bindTerminalCanvas('other', {
      getSelection: () => 'wrong',
      hasSelection: () => true,
      paste: () => {},
    })
    const items = terminalProvider(
      { kind: 'terminal', payload: { sessionId: 's1', status: 'running', target: 'canvas' } },
      makeCtx(),
    )
    const copy = items.find((i) => i.id === 'terminal.copySelection')!
    expect(copy.disabled).toBe(true)
  })
})
