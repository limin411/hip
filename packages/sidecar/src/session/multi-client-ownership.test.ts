import { describe, expect, it } from 'vitest'
import { SessionManager } from './session-manager.js'
import type { ServerMessage } from '@hip/protocol'
import { BackgroundManager } from './background-manager.js'

function collect(send: (m: ServerMessage) => void): ServerMessage[] {
  const out: ServerMessage[] = []
  return new Proxy(out, {
    get(target, prop, receiver) {
      if (prop === 'push') return undefined
      return Reflect.get(target, prop, receiver)
    },
  }) as unknown as ServerMessage[]
}

describe('multi-client ownership', () => {
  it('cancelOwnedBy cancels only sessions owned by that connection', () => {
    const mgr = new SessionManager()
    const sink: ServerMessage[] = []
    const send = (m: ServerMessage) => {
      sink.push(m)
    }

    mgr.handle(
      {
        type: 'session:create',
        id: 's-cli',
        config: {
          llmProvider: 'deepseek',
          model: 'deepseek-chat',
          tools: [],
          cwd: process.cwd(),
          permissionMode: 'full',
          surface: 'code',
        },
      },
      send,
      'conn-cli',
      'cli',
    )
    mgr.handle(
      {
        type: 'session:create',
        id: 's-gui',
        config: {
          llmProvider: 'deepseek',
          model: 'deepseek-chat',
          tools: [],
          cwd: process.cwd(),
          permissionMode: 'full',
          surface: 'code',
        },
      },
      send,
      'conn-gui',
      'gui',
    )

    const cli = mgr.getSessionForTest('s-cli')!
    const gui = mgr.getSessionForTest('s-gui')!
    cli.ownerConnectionId = 'conn-cli'
    gui.ownerConnectionId = 'conn-gui'

    // Simulate running foreground on both
    ;(cli as unknown as { abortController: AbortController }).abortController = new AbortController()
    ;(gui as unknown as { abortController: AbortController }).abortController = new AbortController()
    cli.running = true
    gui.running = true

    mgr.cancelOwnedBy('conn-cli')

    expect(cli.ownerConnectionId).toBeNull()
    expect(gui.ownerConnectionId).toBe('conn-gui')
    expect((cli as unknown as { abortController: AbortController | null }).abortController?.signal.aborted).toBe(
      true,
    )
    expect((gui as unknown as { abortController: AbortController | null }).abortController?.signal.aborted).toBe(
      false,
    )
  })

  it('stopFromOrigin stops only matching background tasks', () => {
    const bg = new BackgroundManager('sess')
    const hold = new AbortController()
    bg.spawn(
      't-cli',
      'cli work',
      async (signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve())
        })
      },
      { originConnectionId: 'conn-cli' },
    )
    bg.spawn(
      't-gui',
      'gui work',
      async (signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve())
        })
      },
      { originConnectionId: 'conn-gui' },
    )

    const stopped = bg.stopFromOrigin('conn-cli', 'owner_disconnect')
    expect(stopped).toEqual(['t-cli'])
    expect(bg.meta.get('t-cli')?.status).toBe('killed')
    expect(bg.meta.get('t-gui')?.status).toBe('running')
    hold.abort()
    bg.stop('t-gui', 'cleanup')
  })

  it('dropQueuedInputsFrom removes only that connection queue entries', () => {
    const mgr = new SessionManager()
    const send = (_m: ServerMessage) => {}
    mgr.handle(
      {
        type: 'session:create',
        id: 's1',
        config: {
          llmProvider: 'deepseek',
          model: 'deepseek-chat',
          tools: [],
          cwd: process.cwd(),
          permissionMode: 'full',
          surface: 'code',
        },
      },
      send,
      'conn-a',
      'cli',
    )
    const s = mgr.getSessionForTest('s1')!
    s.enqueueInput({ type: 'message', content: 'from-a', connectionId: 'conn-a' })
    s.enqueueInput({ type: 'message', content: 'from-b', connectionId: 'conn-b' })
    s.enqueueInput({ type: 'message', content: 'from-a-2', connectionId: 'conn-a' })
    expect(s.dropQueuedInputsFrom('conn-a')).toBe(2)
    expect((s as unknown as { inputQueue: Array<{ content: string }> }).inputQueue.map((i) => i.content)).toEqual([
      'from-b',
    ])
  })
})
