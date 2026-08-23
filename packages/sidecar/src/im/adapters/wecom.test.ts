import { describe, expect, it, vi, beforeEach } from 'vitest'
import { WecomAdapter, WS_OPEN, type WebSocketLike } from './wecom.js'
import type { ImMessageEvent } from '../types.js'

function createMockWS(): WebSocketLike & { _sent: string[] } {
  const sent: string[] = []
  return {
    _sent: sent,
    readyState: WS_OPEN,
    send: vi.fn((data: string) => { sent.push(data) }),
    close: vi.fn(),
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
  }
}

describe('WecomAdapter', () => {
  let ws: ReturnType<typeof createMockWS>
  let adapter: WecomAdapter

  beforeEach(() => {
    ws = createMockWS()
    adapter = new WecomAdapter(
      { connectorId: 'conn-1', botId: 'bot-1', secret: 'sec-1' },
      { wsFactory: () => ws },
    )
  })

  it('connects and subscribes', async () => {
    await adapter.connect()
    expect(adapter.status).toBe('connected')
    // Trigger onopen to send subscribe
    ws.onopen?.()
    expect(ws._sent.some((s) => s.includes('aibot_subscribe'))).toBe(true)
  })

  it('handles inbound message', async () => {
    const received: ImMessageEvent[] = []
    adapter.setMessageHandler((e) => received.push(e))

    await adapter.connect()

    ws.onmessage?.({
      data: JSON.stringify({
        action: 'aibot_msg_callback',
        msgid: 'msg-1',
        req_id: 'req-1',
        from: { userid: 'user-1', name: 'Alice' },
        chatid: 'chat-1',
        content: 'Hello!',
      }),
    })

    expect(received).toHaveLength(1)
    expect(received[0].messageId).toBe('msg-1')
    expect(received[0].senderId).toBe('user-1')
    expect(received[0].text).toBe('Hello!')
    expect(received[0].chatKind).toBe('group')
    expect(received[0].platform).toBe('wecom')
  })

  it('handles DM message (no chatid)', async () => {
    const received: ImMessageEvent[] = []
    adapter.setMessageHandler((e) => received.push(e))

    await adapter.connect()

    ws.onmessage?.({
      data: JSON.stringify({
        action: 'aibot_msg_callback',
        msgid: 'msg-dm',
        from: { userid: 'user-2', name: 'Bob' },
        content: 'DM hello',
      }),
    })

    expect(received).toHaveLength(1)
    expect(received[0].chatId).toBe('dm:user-2')
    expect(received[0].chatKind).toBe('dm')
  })

  it('handles card event callback', async () => {
    const received: ImMessageEvent[] = []
    adapter.setMessageHandler((e) => received.push(e))

    await adapter.connect()

    ws.onmessage?.({
      data: JSON.stringify({
        action: 'aibot_event_callback',
        msgid: 'card-msg-1',
        action_id: 'allow_once',
        operator_userid: 'user-1',
        chatid: 'chat-1',
      }),
    })

    expect(received).toHaveLength(1)
    expect(received[0].interactive?.actionId).toBe('allow_once')
  })

  it('sends text message', async () => {
    await adapter.connect()
    const result = await adapter.send(
      { chatId: 'chat-1', chatKind: 'group' },
      { kind: 'text', text: 'Reply!' },
    )

    expect(result.ok).toBe(true)
    expect(ws._sent.some((s) => s.includes('aibot_respond_msg') && s.includes('Reply!'))).toBe(true)
  })

  it('sends markdown message', async () => {
    await adapter.connect()
    const result = await adapter.send(
      { chatId: 'chat-1', chatKind: 'group' },
      { kind: 'markdown', markdown: '**bold**' },
    )

    expect(result.ok).toBe(true)
    expect(ws._sent.some((s) => s.includes('markdown'))).toBe(true)
  })

  it('returns error when not connected', async () => {
    const result = await adapter.send(
      { chatId: 'chat-1', chatKind: 'group' },
      { kind: 'text', text: 'fail' },
    )
    expect(result.ok).toBe(false)
    expect(result.error).toContain('not connected')
  })

  it('silently drops malformed messages', async () => {
    const received: ImMessageEvent[] = []
    adapter.setMessageHandler((e) => received.push(e))

    await adapter.connect()

    ws.onmessage?.({ data: 'not json' })
    ws.onmessage?.({ data: JSON.stringify({ action: 'unknown' }) })

    expect(received).toHaveLength(0)
  })

  it('disconnects cleanly', async () => {
    await adapter.connect()
    await adapter.disconnect()
    expect(adapter.status).toBe('disconnected')
  })
})
