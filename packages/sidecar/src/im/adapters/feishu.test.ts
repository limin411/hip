import { describe, expect, it, beforeEach, vi } from 'vitest'
import { FeishuAdapter } from './feishu.js'
import type { LarkImClient, LarkWSClient, LarkEventDispatcher } from './feishu.js'
import type { ImMessageEvent, ImChatTarget, ImOutbound } from '../types.js'

function createMockLarkClient(): LarkImClient {
  return {
    sendMessage: vi.fn().mockResolvedValue({ data: { message_id: 'msg-1' }, code: 0 }),
    patchMessage: vi.fn().mockResolvedValue({ code: 0 }),
  }
}

function createMockWSClient(): LarkWSClient & { _handlers: Map<string, Function[]> } {
  const handlers = new Map<string, Function[]>()
  return {
    _handlers: handlers,
    start: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    on: vi.fn((event: string, handler: Function) => {
      const list = handlers.get(event) ?? []
      list.push(handler)
      handlers.set(event, list)
    }),
  }
}

function createMockEventDispatcher(): LarkEventDispatcher & { _handlers: Map<string, Function>; _cardHandler?: Function } {
  const handlers = new Map<string, Function>()
  let cardHandler: Function | undefined
  return {
    _handlers: handlers,
    get _cardHandler() { return cardHandler },
    register: vi.fn((event: string, handler: Function) => {
      handlers.set(event, handler)
    }),
    registerCardAction: vi.fn((handler: Function) => {
      cardHandler = handler
    }),
  }
}

describe('FeishuAdapter', () => {
  let larkClient: ReturnType<typeof createMockLarkClient>
  let wsClient: ReturnType<typeof createMockWSClient>
  let eventDispatcher: ReturnType<typeof createMockEventDispatcher>
  let adapter: FeishuAdapter

  beforeEach(() => {
    larkClient = createMockLarkClient()
    wsClient = createMockWSClient()
    eventDispatcher = createMockEventDispatcher()
    adapter = new FeishuAdapter(
      { connectorId: 'conn-1', appId: 'cli_xxx', appSecret: 'secret' },
      { larkClient, wsClient, eventDispatcher },
    )
  })

  it('connects successfully', async () => {
    await adapter.connect()
    expect(adapter.status).toBe('connected')
    expect(wsClient.start).toHaveBeenCalled()
  })

  it('registers message and card action handlers on connect', async () => {
    await adapter.connect()
    expect(eventDispatcher.register).toHaveBeenCalledWith('im.message.receive_v1', expect.any(Function))
    expect(eventDispatcher.registerCardAction).toHaveBeenCalledWith(expect.any(Function))
  })

  it('handles message receive event', async () => {
    const received: ImMessageEvent[] = []
    adapter.setMessageHandler((e) => received.push(e))

    await adapter.connect()

    // Simulate a message event from Lark
    const handler = eventDispatcher._handlers.get('im.message.receive_v1')!
    handler({
      event: {
        message: {
          message_id: 'msg-123',
          chat_id: 'oc_chat1',
          chat_type: 'group',
          content: JSON.stringify({ text: 'Hello bot!' }),
        },
        sender: {
          sender_id: { open_id: 'ou_user1', name: 'Alice' },
        },
      },
    })

    expect(received).toHaveLength(1)
    expect(received[0].messageId).toBe('msg-123')
    expect(received[0].chatId).toBe('oc_chat1')
    expect(received[0].chatKind).toBe('group')
    expect(received[0].senderId).toBe('ou_user1')
    expect(received[0].text).toBe('Hello bot!')
    expect(received[0].platform).toBe('feishu')
  })

  it('handles p2p (DM) message', async () => {
    const received: ImMessageEvent[] = []
    adapter.setMessageHandler((e) => received.push(e))

    await adapter.connect()

    const handler = eventDispatcher._handlers.get('im.message.receive_v1')!
    handler({
      event: {
        message: {
          message_id: 'msg-dm',
          chat_id: 'oc_dm',
          chat_type: 'p2p',
          content: JSON.stringify({ text: 'DM message' }),
        },
        sender: {
          sender_id: { open_id: 'ou_user2' },
        },
      },
    })

    expect(received).toHaveLength(1)
    expect(received[0].chatKind).toBe('dm')
  })

  it('handles card action (HITL button click)', async () => {
    const received: ImMessageEvent[] = []
    adapter.setMessageHandler((e) => received.push(e))

    await adapter.connect()

    const cardHandler = eventDispatcher._cardHandler!
    cardHandler({
      event: {
        action: { value: 'allow_once' },
        operator: { open_id: 'ou_user1' },
        context: { open_chat_id: 'oc_chat1', message_id: 'card-msg-1' },
      },
    })

    expect(received).toHaveLength(1)
    expect(received[0].interactive?.actionId).toBe('allow_once')
    expect(received[0].interactive?.cardMessageId).toBe('card-msg-1')
  })

  it('sends text message', async () => {
    await adapter.connect()
    const chat: ImChatTarget = { chatId: 'oc_chat1', chatKind: 'group' }
    const payload: ImOutbound = { kind: 'text', text: 'Hello!' }
    const result = await adapter.send(chat, payload)

    expect(result.ok).toBe(true)
    expect(result.messageId).toBe('msg-1')
    expect(larkClient.sendMessage).toHaveBeenCalledWith({
      receive_id_type: 'chat_id',
      receive_id: 'oc_chat1',
      msg_type: 'text',
      content: JSON.stringify({ text: 'Hello!' }),
    })
  })

  it('sends markdown message', async () => {
    await adapter.connect()
    const chat: ImChatTarget = { chatId: 'oc_chat1', chatKind: 'group' }
    const payload: ImOutbound = { kind: 'markdown', markdown: '**bold** text' }
    const result = await adapter.send(chat, payload)

    expect(result.ok).toBe(true)
    expect(larkClient.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ msg_type: 'post' }),
    )
  })

  it('sends card message', async () => {
    await adapter.connect()
    const chat: ImChatTarget = { chatId: 'oc_chat1', chatKind: 'group' }
    const card = { type: 'template', data: { template_id: 'tpl' } }
    const payload: ImOutbound = { kind: 'card', card }
    const result = await adapter.send(chat, payload)

    expect(result.ok).toBe(true)
    expect(larkClient.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ msg_type: 'interactive' }),
    )
  })

  it('handles send failure', async () => {
    larkClient.sendMessage = vi.fn().mockResolvedValue({ code: 99991, msg: 'Invalid token' })
    await adapter.connect()
    const chat: ImChatTarget = { chatId: 'oc_chat1', chatKind: 'group' }
    const result = await adapter.send(chat, { kind: 'text', text: 'fail' })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('Invalid token')
  })

  it('returns error when larkClient not configured', async () => {
    const noClientAdapter = new FeishuAdapter(
      { connectorId: 'conn-1', appId: 'cli_xxx', appSecret: 'secret' },
      { wsClient, eventDispatcher },
    )
    await noClientAdapter.connect()
    const result = await noClientAdapter.send(
      { chatId: 'oc_chat1', chatKind: 'group' },
      { kind: 'text', text: 'fail' },
    )
    expect(result.ok).toBe(false)
    expect(result.error).toContain('not configured')
  })

  it('disconnects idempotently', async () => {
    await adapter.connect()
    await adapter.disconnect()
    expect(adapter.status).toBe('disconnected')
    await adapter.disconnect() // second call should be no-op
    expect(adapter.status).toBe('disconnected')
  })

  it('reports error status on connect failure', async () => {
    wsClient.start = vi.fn().mockRejectedValue(new Error('Connection refused'))
    await expect(adapter.connect()).rejects.toThrow('Connection refused')
    expect(adapter.status).toBe('error')
  })

  it('silently drops malformed message events', async () => {
    const received: ImMessageEvent[] = []
    adapter.setMessageHandler((e) => received.push(e))

    await adapter.connect()

    const handler = eventDispatcher._handlers.get('im.message.receive_v1')!
    handler(null) // malformed
    handler({}) // no event
    handler({ event: {} }) // no message

    expect(received).toHaveLength(0)
  })

  it('silently drops malformed card action events', async () => {
    const received: ImMessageEvent[] = []
    adapter.setMessageHandler((e) => received.push(e))

    await adapter.connect()

    const cardHandler = eventDispatcher._cardHandler!
    cardHandler(null)
    cardHandler({ event: {} }) // no action
    cardHandler({ event: { action: { value: 'allow_once' } } }) // no operator

    expect(received).toHaveLength(0)
  })
})
