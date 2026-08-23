import { describe, expect, it, beforeEach } from 'vitest'
import {
  createDedupeFilter,
  createRateLimiter,
  isAuthorized,
  createParkedEntry,
  resolveSessionId,
  frameInbound,
  deriveSessionTitle,
  buildOrigin,
} from './gateway.js'
import type { ImMessageEvent } from './types.js'
import type { ImConnectorRecord } from '@hip/protocol'

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
    replyToken: 'rt-1',
    ...overrides,
  }
}

describe('createDedupeFilter', () => {
  it('returns true for new messages', () => {
    const isDuplicate = createDedupeFilter()
    expect(isDuplicate('c1', 'msg-1')).toBe(true)
  })

  it('returns false for duplicate messages within TTL', () => {
    const isDuplicate = createDedupeFilter()
    expect(isDuplicate('c1', 'msg-1')).toBe(true)
    expect(isDuplicate('c1', 'msg-1')).toBe(false)
  })

  it('treats different message ids as unique', () => {
    const isDuplicate = createDedupeFilter()
    expect(isDuplicate('c1', 'msg-1')).toBe(true)
    expect(isDuplicate('c1', 'msg-2')).toBe(true)
  })

  it('treats different connector ids as unique', () => {
    const isDuplicate = createDedupeFilter()
    expect(isDuplicate('c1', 'msg-1')).toBe(true)
    expect(isDuplicate('c2', 'msg-1')).toBe(true)
  })
})

describe('createRateLimiter', () => {
  it('allows up to 10 messages per window', () => {
    const isAllowed = createRateLimiter()
    for (let i = 0; i < 10; i++) {
      expect(isAllowed('c1', `user-${i}`)).toBe(true)
    }
    // Different senders are independent
    expect(isAllowed('c1', 'user-new')).toBe(true)
  })

  it('rate limits the 11th message from the same sender within 60s', () => {
    const isAllowed = createRateLimiter()
    for (let i = 0; i < 10; i++) {
      expect(isAllowed('c1', 'user-1')).toBe(true)
    }
    expect(isAllowed('c1', 'user-1')).toBe(false)
  })

  it('different connector ids have independent buckets', () => {
    const isAllowed = createRateLimiter()
    for (let i = 0; i < 10; i++) {
      isAllowed('c1', 'user-1')
    }
    expect(isAllowed('c2', 'user-1')).toBe(true)
  })
})

describe('isAuthorized', () => {
  const allowlist: ImConnectorRecord['allowlist'] = [
    { kind: 'user', id: 'ou_123', name: 'Alice' },
    { kind: 'chat', id: 'oc_456', name: 'Dev Team' },
  ]

  it('authorizes by user id', () => {
    expect(isAuthorized(allowlist, 'ou_123', 'any-chat')).toBe(true)
  })

  it('authorizes by chat id', () => {
    expect(isAuthorized(allowlist, 'any-user', 'oc_456')).toBe(true)
  })

  it('rejects unknown sender and chat', () => {
    expect(isAuthorized(allowlist, 'unknown', 'unknown')).toBe(false)
  })

  it('empty allowlist rejects everyone', () => {
    expect(isAuthorized([], 'ou_123', 'oc_456')).toBe(false)
  })
})

describe('createParkedEntry', () => {
  it('creates a parked entry from an event', () => {
    const event = makeEvent()
    const entry = createParkedEntry(event)
    expect(entry.kind).toBe('user')
    expect(entry.id).toBe('user-1')
    expect(entry.name).toBe('Alice')
    expect(entry.firstSeenAt).toBeGreaterThan(0)
  })
})

describe('resolveSessionId', () => {
  it('creates deterministic session id', () => {
    expect(resolveSessionId('feishu', 'chat-1')).toBe('im:feishu:chat-1')
    expect(resolveSessionId('wecom', 'dm:user-1')).toBe('im:wecom:dm:user-1')
  })
})

describe('frameInbound', () => {
  it('formats group message with all tags', () => {
    const event = makeEvent()
    expect(frameInbound(event)).toBe('[feishu · Test Group · Alice] hello')
  })

  it('formats DM without chatName', () => {
    const event = makeEvent({ chatName: undefined, chatKind: 'dm' })
    expect(frameInbound(event)).toBe('[feishu · Alice] hello')
  })

  it('formats minimal message', () => {
    const event = makeEvent({ chatName: undefined, senderName: undefined })
    expect(frameInbound(event)).toBe('[feishu] hello')
  })
})

describe('deriveSessionTitle', () => {
  it('uses chatName for group chats', () => {
    const event = makeEvent({ chatKind: 'group', chatName: 'Dev Team' })
    expect(deriveSessionTitle(event)).toBe('Dev Team（IM）')
  })

  it('uses senderName for DM', () => {
    const event = makeEvent({ chatKind: 'dm', senderName: 'Bob' })
    expect(deriveSessionTitle(event)).toBe('Bob（IM）')
  })

  it('falls back to id when name is missing', () => {
    const event = makeEvent({ chatKind: 'dm', senderName: undefined, senderId: 'ou_999' })
    expect(deriveSessionTitle(event)).toBe('ou_999（IM）')
  })
})

describe('buildOrigin', () => {
  it('builds origin metadata from event', () => {
    const event = makeEvent()
    const origin = buildOrigin(event, 'conn-1')
    expect(origin).toEqual({
      kind: 'im',
      platform: 'feishu',
      connectorId: 'conn-1',
      chatId: 'chat-1',
      chatName: 'Test Group',
    })
  })
})
