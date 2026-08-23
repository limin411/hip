import { describe, expect, it, vi, beforeEach } from 'vitest'
import { SessionBridge } from './bridge.js'
import type { SessionBridgeDeps } from './bridge.js'
import type { ImMessageEvent, BaseImAdapter, SendResult, ImOutbound } from './types.js'
import type { ImConnectorRecord, ImSessionOrigin, PermissionMode } from '@hip/protocol'

function makeEvent(overrides: Partial<ImMessageEvent> = {}): ImMessageEvent {
  return {
    connectorId: 'conn-1',
    platform: 'feishu',
    messageId: 'msg-1',
    chatId: 'chat-1',
    chatName: 'Test Group',
    chatKind: 'group',
    senderId: 'user-1',
    senderName: 'Alice',
    text: 'hello',
    replyToken: 'chat-1',
    ...overrides,
  }
}

function makeConnector(overrides: Partial<ImConnectorRecord> = {}): ImConnectorRecord {
  return {
    id: 'conn-1',
    platform: 'feishu',
    name: 'Test Bot',
    enabled: true,
    credentials: { appId: 'cli', appSecret: 'secret' },
    permissionMode: 'confirm',
    allowlist: [{ kind: 'user', id: 'user-1', name: 'Alice' }],
    parked: [],
    status: 'connected',
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  }
}

function createMockDeps(): SessionBridgeDeps & {
  _turnCallbacks: Map<string, (text: string, error?: string) => void>
  _permissionCallbacks: Map<string, (requestId: string, tool: string, options: unknown[]) => void>
} {
  const turnCallbacks = new Map<string, (text: string, error?: string) => void>()
  const permissionCallbacks = new Map<string, (requestId: string, tool: string, options: unknown[]) => void>()
  return {
    _turnCallbacks: turnCallbacks,
    _permissionCallbacks: permissionCallbacks,
    createSession: vi.fn(),
    hasSession: vi.fn().mockReturnValue(false),
    sendMessage: vi.fn(),
    onTurnComplete: vi.fn((sessionId: string, cb: (text: string, error?: string) => void) => {
      turnCallbacks.set(sessionId, cb)
    }),
    onPermissionRequest: vi.fn((sessionId: string, cb: (requestId: string, tool: string, options: unknown[]) => void) => {
      permissionCallbacks.set(sessionId, cb)
    }),
    respondPermission: vi.fn(),
  }
}

function createMockAdapter(): BaseImAdapter & { _sent: ImOutbound[] } {
  const sent: ImOutbound[] = []
  return {
    _sent: sent,
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    send: vi.fn((chat: any, payload: any) => {
      sent.push(payload)
      return Promise.resolve({ ok: true } as SendResult)
    }),
    updateCard: vi.fn().mockResolvedValue(undefined),
    setMessageHandler: vi.fn(),
  }
}

describe('SessionBridge', () => {
  let deps: ReturnType<typeof createMockDeps>
  let adapter: ReturnType<typeof createMockAdapter>
  let bridge: SessionBridge

  beforeEach(() => {
    deps = createMockDeps()
    adapter = createMockAdapter()
    bridge = new SessionBridge(deps)
    bridge.registerAdapter('conn-1', adapter)
  })

  it('creates a new session on first inbound message', () => {
    const event = makeEvent()
    const connector = makeConnector()
    bridge.handleInbound(event, connector)

    expect(deps.createSession).toHaveBeenCalledWith(
      'im:feishu:chat-1',
      expect.stringContaining('IM'),
      'edit', // 'confirm' ImPermissionMode maps to 'edit' PermissionMode
      expect.objectContaining({ kind: 'im', platform: 'feishu', connectorId: 'conn-1', chatId: 'chat-1' }),
    )
  })

  it('does not create duplicate session for existing one', () => {
    deps.hasSession = vi.fn().mockReturnValue(true)
    const event = makeEvent()
    const connector = makeConnector()
    bridge.handleInbound(event, connector)

    expect(deps.createSession).not.toHaveBeenCalled()
    expect(deps.sendMessage).toHaveBeenCalledWith('im:feishu:chat-1', expect.stringContaining('hello'))
  })

  it('injects framed message into session', () => {
    deps.hasSession = vi.fn().mockReturnValue(true)
    const event = makeEvent()
    const connector = makeConnector()
    bridge.handleInbound(event, connector)

    expect(deps.sendMessage).toHaveBeenCalledWith(
      'im:feishu:chat-1',
      '[feishu · Test Group · Alice] hello',
    )
  })

  it('queues message when session is busy and sends "busy" reply for second message', () => {
    deps.hasSession = vi.fn().mockReturnValue(true)
    const connector = makeConnector()

    // First message goes through
    bridge.handleInbound(makeEvent({ messageId: 'msg-1' }), connector)
    expect(deps.sendMessage).toHaveBeenCalledTimes(1)

    // Second message while busy → "busy" reply
    bridge.handleInbound(makeEvent({ messageId: 'msg-2' }), connector)
    expect(adapter.send).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: 'chat-1' }),
      expect.objectContaining({ kind: 'text', text: expect.stringContaining('正在处理') }),
    )
  })

  it('sends reply on turn completion', () => {
    // First message creates session and registers turn listener
    bridge.handleInbound(makeEvent(), makeConnector())
    expect(deps.createSession).toHaveBeenCalled()

    // Simulate turn completion
    const cb = deps._turnCallbacks.get('im:feishu:chat-1')!
    expect(cb).toBeDefined()
    cb('Agent reply text')

    expect(adapter.send).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: 'chat-1' }),
      expect.objectContaining({ kind: 'markdown', markdown: 'Agent reply text' }),
    )
  })

  it('sends error on turn failure', () => {
    bridge.handleInbound(makeEvent(), makeConnector())

    const cb = deps._turnCallbacks.get('im:feishu:chat-1')!
    expect(cb).toBeDefined()
    cb('', 'Something went wrong')

    expect(adapter.send).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: 'chat-1' }),
      expect.objectContaining({ kind: 'text', text: expect.stringContaining('Something went wrong') }),
    )
  })

  it('handles HITL card button click', () => {
    // First message creates session and registers permission listener
    bridge.handleInbound(makeEvent(), makeConnector())

    // Simulate permission request
    const permCb = deps._permissionCallbacks.get('im:feishu:chat-1')!
    permCb('req-1', 'run_script', [])

    // Now simulate card button click
    bridge.handleInbound(
      makeEvent({
        messageId: 'card:msg-1:allow_once',
        interactive: { actionId: 'allow_once', cardMessageId: 'msg-1' },
      }),
      makeConnector(),
    )

    expect(deps.respondPermission).toHaveBeenCalledWith('im:feishu:chat-1', 'req-1', 'allow_once')
    expect(adapter.updateCard).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: 'chat-1' }),
      'msg-1',
      expect.objectContaining({ processed: true, action: 'allow_once' }),
    )
  })

  it('registers and unregisters adapters', () => {
    bridge.unregisterAdapter('conn-1')
    deps.hasSession = vi.fn().mockReturnValue(true)
    bridge.handleInbound(makeEvent(), makeConnector())
    // No adapter → send should not be called for replies
    // (turn completion would fail silently)
  })
})
