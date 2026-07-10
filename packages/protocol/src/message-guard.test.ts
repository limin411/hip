import { describe, it, expect } from 'vitest'
import { parseClientMessage, isClientMessageType, CLIENT_MESSAGE_TYPES } from './message-guard.js'

describe('message-guard', () => {
  it('accepts a known client message shape', () => {
    const msg = parseClientMessage({ type: 'session:list' })
    expect(msg).not.toBeNull()
    expect(msg!.type).toBe('session:list')
  })

  it('accepts message:send with extra fields', () => {
    const msg = parseClientMessage({
      type: 'message:send',
      sessionId: 's1',
      id: 'm1',
      content: 'hi',
      role: 'user',
    })
    expect(msg?.type).toBe('message:send')
  })

  it('rejects null, arrays, primitives', () => {
    expect(parseClientMessage(null)).toBeNull()
    expect(parseClientMessage(undefined)).toBeNull()
    expect(parseClientMessage('session:list')).toBeNull()
    expect(parseClientMessage(42)).toBeNull()
    expect(parseClientMessage([{ type: 'session:list' }])).toBeNull()
  })

  it('rejects missing or unknown type', () => {
    expect(parseClientMessage({})).toBeNull()
    expect(parseClientMessage({ type: 'not:a:real:message' })).toBeNull()
    expect(parseClientMessage({ type: 1 })).toBeNull()
  })

  it('isClientMessageType matches the catalog', () => {
    for (const t of CLIENT_MESSAGE_TYPES) {
      expect(isClientMessageType(t)).toBe(true)
    }
    expect(isClientMessageType('ready')).toBe(false)
  })

  it('accepts workflow:getActive', () => {
    const msg = parseClientMessage({ type: 'workflow:getActive', sessionId: 's1' })
    expect(msg?.type).toBe('workflow:getActive')
  })
})
