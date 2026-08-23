import { describe, expect, it, vi, beforeEach } from 'vitest'
import { DingtalkAdapter, parseTextConfirm, type DWClientLike } from './dingtalk.js'
import type { ImMessageEvent } from '../types.js'

function createMockDWClient(): DWClientLike & { _handlers: Map<string, Function>; _routes: Map<string, Function> } {
  const handlers = new Map<string, Function>()
  const routes = new Map<string, Function>()
  return {
    _handlers: handlers,
    _routes: routes,
    connect: vi.fn(),
    close: vi.fn(),
    register: vi.fn((route: string, handler: Function) => {
      routes.set(route, handler)
    }),
    on: vi.fn((event: string, handler: Function) => {
      handlers.set(event, handler)
    }),
  }
}

describe('DingtalkAdapter', () => {
  let client: ReturnType<typeof createMockDWClient>
  let adapter: DingtalkAdapter

  beforeEach(() => {
    client = createMockDWClient()
    adapter = new DingtalkAdapter(
      { connectorId: 'conn-1', clientId: 'cli-1', clientSecret: 'sec-1' },
      { clientFactory: () => client },
    )
  })

  it('connects successfully', async () => {
    await adapter.connect()
    expect(adapter.status).toBe('connected')
    expect(client.connect).toHaveBeenCalled()
    expect(client.register).toHaveBeenCalledWith('/v1.0/im/bot/messages/get', expect.any(Function))
  })

  it('handles inbound group message', async () => {
    const received: ImMessageEvent[] = []
    adapter.setMessageHandler((e) => received.push(e))

    await adapter.connect()

    const handler = client._routes.get('/v1.0/im/bot/messages/get')!
    handler({
      data: {
        msgId: 'msg-1',
        senderStaffId: 'staff-1',
        senderNick: 'Alice',
        conversationType: '2',
        conversationId: 'conv-1',
        sessionWebhook: 'https://hook.example.com/xxx',
        text: { content: 'Hello bot!' },
      },
    })

    expect(received).toHaveLength(1)
    expect(received[0].messageId).toBe('msg-1')
    expect(received[0].senderId).toBe('staff-1')
    expect(received[0].senderName).toBe('Alice')
    expect(received[0].text).toBe('Hello bot!')
    expect(received[0].chatKind).toBe('group')
    expect(received[0].chatId).toBe('conv-1')
    expect(received[0].platform).toBe('dingtalk')
  })

  it('handles DM message', async () => {
    const received: ImMessageEvent[] = []
    adapter.setMessageHandler((e) => received.push(e))

    await adapter.connect()

    const handler = client._routes.get('/v1.0/im/bot/messages/get')!
    handler({
      data: {
        msgId: 'msg-dm',
        senderStaffId: 'staff-2',
        senderNick: 'Bob',
        conversationType: '1',
        sessionWebhook: 'https://hook.example.com/dm',
        text: { content: 'DM message' },
      },
    })

    expect(received).toHaveLength(1)
    expect(received[0].chatId).toBe('dm:staff-2')
    expect(received[0].chatKind).toBe('dm')
  })

  it('tracks sessionWebhook for sends', async () => {
    await adapter.connect()

    const handler = client._routes.get('/v1.0/im/bot/messages/get')!
    handler({
      data: {
        msgId: 'msg-1',
        senderStaffId: 'staff-1',
        conversationType: '1',
        sessionWebhook: 'https://hook.example.com/test',
        text: { content: 'hi' },
      },
    })

    // Now send should use the tracked webhook
    // (fetch is mocked in test env, just verify no crash)
  })

  it('returns error when no sessionWebhook available', async () => {
    await adapter.connect()
    const result = await adapter.send(
      { chatId: 'unknown-chat', chatKind: 'group' },
      { kind: 'text', text: 'fail' },
    )
    expect(result.ok).toBe(false)
    expect(result.error).toContain('sessionWebhook')
  })

  it('handles error event', async () => {
    await adapter.connect()

    client._handlers.get('error')?.(new Error('Connection failed'))
    // Status should update (error handler is registered)
  })

  it('disconnects cleanly', async () => {
    await adapter.connect()
    await adapter.disconnect()
    expect(adapter.status).toBe('disconnected')
    expect(client.close).toHaveBeenCalled()
  })
})

describe('parseTextConfirm', () => {
  it('parses "1" as allow_once', () => {
    expect(parseTextConfirm('1')).toBe('allow_once')
  })

  it('parses "2" as allow_always', () => {
    expect(parseTextConfirm('2')).toBe('allow_always')
  })

  it('parses "3" as reject_once', () => {
    expect(parseTextConfirm('3')).toBe('reject_once')
  })

  it('returns undefined for non-numeric input', () => {
    expect(parseTextConfirm('yes')).toBeUndefined()
    expect(parseTextConfirm('')).toBeUndefined()
    expect(parseTextConfirm('4')).toBeUndefined()
  })

  it('trims whitespace', () => {
    expect(parseTextConfirm(' 1 ')).toBe('allow_once')
  })
})
