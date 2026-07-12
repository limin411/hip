import { describe, it, expect, beforeEach, vi } from 'vitest'
import { bindTerminalRestarter } from '@/components/artifact/terminalRestartUi'
import { useDomainStore } from '@/domain/sessionStore'
import { terminalProvider } from './terminal'
import type { ContextMenuBuildContext } from '../types'

const copyText = vi.fn(async () => true)
const setProjectDir = vi.fn()
const pickDirectory = vi.fn()

vi.mock('@/ipc/dialog', () => ({
  pickDirectory: (...a: unknown[]) => pickDirectory(...a),
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
  bindTerminalRestarter(null)
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
  it('includes restart, changeFolder, copyCwd, openFiles', async () => {
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
})
