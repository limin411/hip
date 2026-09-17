// Deleting a conversation deletes the scheduled tasks it owns.
// (The task has no transcript left to run in; re-homing it into a fresh session
// on every fire is exactly the litter the composer path exists to avoid.)
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ClientMessage, ServerMessage } from '@hip/protocol'
import { SessionActions } from './sessionActions'
import { DEFAULT_CONFIG, useDomainStore, type SessionVM } from '../sessionStore'
import type { SessionService } from '../sessionService'
import type { ConnectionStatus, Transport } from '../transport'
import type { Automation } from '@/domain/automations'
import { useAutomationStore } from '@/store/automationStore'

const softDeleteAutomation = vi.fn()

vi.mock('@/ipc/automations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/ipc/automations')>()),
  softDeleteAutomation: (...a: unknown[]) => softDeleteAutomation(...a),
}))

vi.mock('@/ipc/pty', () => ({ ptyKill: () => Promise.resolve() }))

// The real singleton graph is circular (providersStore → sessionService → …);
// this test drives SessionActions directly, so stub the facade out.
vi.mock('@/domain/sessionService', () => ({
  sessionService: {
    createSession: vi.fn(),
    sendMessageToSession: vi.fn(),
    renameSession: vi.fn(),
    selectSession: vi.fn(),
  },
}))

class FakeTransport implements Transport {
  sent: ClientMessage[] = []
  async connect() {}
  disconnect() {}
  send(msg: ClientMessage) {
    this.sent.push(msg)
  }
  onMessage(_h: (m: ServerMessage) => void) {
    return () => {}
  }
  onStatus(_h: (s: ConnectionStatus) => void) {
    return () => {}
  }
}

function vm(id: string): SessionVM {
  return {
    id,
    config: { ...DEFAULT_CONFIG, surface: 'chat' },
    title: id,
    preview: '',
    updatedAtMs: 1,
    loaded: true,
    messages: [],
    status: 'idle',
    error: null,
    interrupt: null,
  }
}

function auto(partial: Partial<Automation> & { id: string }): Automation {
  return {
    name: 'Task',
    prompt: 'go',
    enabled: true,
    trigger: { kind: 'interval', intervalMinutes: 5 },
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  }
}

let transport: FakeTransport
let actions: SessionActions

beforeEach(() => {
  softDeleteAutomation.mockReset().mockResolvedValue({
    id: 'tentry_1',
    automationId: 'auto_1',
    name: 'Task',
    deletedAt: 1,
    enabled: true,
    triggerKind: 'interval',
  })
  transport = new FakeTransport()
  actions = new SessionActions(
    transport,
    () => {},
    {} as unknown as Pick<SessionService, 'resume' | 'respondPlan'>,
  )
  useDomainStore.setState({ sessions: [vm('s-1'), vm('s-2')], activeSessionId: 's-1' })
})

describe('deleting a conversation', () => {
  it('deletes only the scheduled tasks owned by that conversation', async () => {
    useAutomationStore.setState({
      loaded: true,
      automations: [
        auto({ id: 'auto_1', sessionId: 's-1' }),
        auto({ id: 'auto_2', sessionId: 's-2' }),
      ],
      runs: [],
    })

    actions.trashSession('s-1', { reason: 'user' })

    await vi.waitFor(() => expect(softDeleteAutomation).toHaveBeenCalledTimes(1))
    expect(softDeleteAutomation).toHaveBeenCalledWith('auto_1')
    expect(useAutomationStore.getState().automations.map((a) => a.id)).toEqual([
      'auto_2',
    ])
    // The conversation itself still goes to the recycle bin.
    expect(
      transport.sent.some(
        (m) => m.type === 'session:softDelete' && m.sessionId === 's-1',
      ),
    ).toBe(true)
  })

  it('hard delete (empty recycle bin) drops owned tasks too', async () => {
    useAutomationStore.setState({
      loaded: true,
      automations: [auto({ id: 'auto_1', sessionId: 's-1' })],
      runs: [],
    })

    actions.hardDeleteSession('s-1')

    await vi.waitFor(() => expect(softDeleteAutomation).toHaveBeenCalledWith('auto_1'))
    expect(useAutomationStore.getState().automations).toHaveLength(0)
  })

  it('a conversation with no task is a no-op', async () => {
    useAutomationStore.setState({
      loaded: true,
      automations: [auto({ id: 'auto_2', sessionId: 's-2' })],
      runs: [],
    })

    actions.trashSession('s-1', { reason: 'user' })

    await vi.waitFor(() =>
      expect(
        transport.sent.some((m) => m.type === 'session:softDelete'),
      ).toBe(true),
    )
    expect(softDeleteAutomation).not.toHaveBeenCalled()
    expect(useAutomationStore.getState().automations).toHaveLength(1)
  })
})
