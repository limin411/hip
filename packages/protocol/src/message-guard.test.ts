import { describe, it, expect } from 'vitest'
import { parseClientMessage, isClientMessageType, CLIENT_MESSAGE_TYPES } from './message-guard.js'
import type { ClientMessage } from './messages.js'

/** Compile-time: the guard catalog must cover every ClientMessage discriminator. */
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
  ? true
  : false
const _catalogCoversClientMessage: Equal<
  ClientMessage['type'],
  (typeof CLIENT_MESSAGE_TYPES)[number]
> extends true
  ? true
  : never = true

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

  it('accepts memory:setConfig', () => {
    const msg = parseClientMessage({
      type: 'memory:setConfig',
      config: { useMemories: true, generateMemories: false },
    })
    expect(msg?.type).toBe('memory:setConfig')
  })

  it('accepts memory:reindex and memory:indexStatus', () => {
    expect(parseClientMessage({ type: 'memory:reindex' })?.type).toBe('memory:reindex')
    expect(parseClientMessage({ type: 'memory:indexStatus' })?.type).toBe('memory:indexStatus')
  })

  it('accepts session:setMemoryFlags', () => {
    const msg = parseClientMessage({
      type: 'session:setMemoryFlags',
      sessionId: 's1',
      useMemories: true,
      generateMemories: false,
      incognito: true,
    })
    expect(msg?.type).toBe('session:setMemoryFlags')
  })

  it('accepts session:delete with deleteDerivedMemories', () => {
    const msg = parseClientMessage({
      type: 'session:delete',
      sessionId: 's1',
      deleteDerivedMemories: true,
    })
    expect(msg?.type).toBe('session:delete')
    expect(msg!.deleteDerivedMemories).toBe(true)
  })

  it('accepts task:list / task:stop / task:getOutput', () => {
    expect(parseClientMessage({ type: 'task:list', sessionId: 's1' })?.type).toBe('task:list')
    expect(
      parseClientMessage({ type: 'task:stop', sessionId: 's1', taskId: 'shell-1', reason: 'user' })
        ?.type,
    ).toBe('task:stop')
    expect(
      parseClientMessage({ type: 'task:getOutput', sessionId: 's1', taskId: 'shell-1', offsetBytes: 0 })
        ?.type,
    ).toBe('task:getOutput')
  })

  it('accepts session:delete with reason audit tag', () => {
    const msg = parseClientMessage({
      type: 'session:delete',
      sessionId: 's1',
      reason: 'clearAll',
    })
    expect(msg?.type).toBe('session:delete')
    expect(msg!.reason).toBe('clearAll')
  })

  it('accepts im:config:* messages', () => {
    expect(parseClientMessage({ type: 'im:config:list' })?.type).toBe('im:config:list')
    expect(parseClientMessage({ type: 'im:config:upsert', connector: { id: 'c1' } })?.type).toBe('im:config:upsert')
    expect(parseClientMessage({ type: 'im:config:delete', connectorId: 'c1' })?.type).toBe('im:config:delete')
    expect(parseClientMessage({ type: 'im:test', connectorId: 'c1' })?.type).toBe('im:test')
    expect(parseClientMessage({ type: 'im:parked:list', connectorId: 'c1' })?.type).toBe('im:parked:list')
    expect(parseClientMessage({ type: 'im:parked:resolve', connectorId: 'c1', entryId: 'e1', action: 'allow' })?.type).toBe('im:parked:resolve')
  })

  it('accepts session soft-delete / restore / trash RPCs', () => {
    expect(parseClientMessage({ type: 'session:softDelete', sessionId: 's1' })?.type).toBe('session:softDelete')
    expect(
      parseClientMessage({
        type: 'session:softDelete',
        sessionId: 's1',
        deleteDerivedMemories: true,
        reason: 'user',
      })?.type,
    ).toBe('session:softDelete')
    expect(parseClientMessage({ type: 'session:restore', sessionId: 's1' })?.type).toBe('session:restore')
    expect(parseClientMessage({ type: 'session:trash:list' })?.type).toBe('session:trash:list')
    expect(parseClientMessage({ type: 'session:trash:empty' })?.type).toBe('session:trash:empty')
    expect(parseClientMessage({ type: 'session:trash:purge', retentionDays: 7 })?.type).toBe(
      'session:trash:purge',
    )
  })

  it('accepts config:testProvider', () => {
    const msg = parseClientMessage({
      type: 'config:testProvider',
      requestId: 'r1',
      purpose: 'chat',
      providerID: 'deepseek',
      baseURL: 'https://api.deepseek.com/v1',
    })
    expect(msg?.type).toBe('config:testProvider')
    expect(msg!.requestId).toBe('r1')
  })

  it('accepts terminal bridge client messages (uiToolResult/uiToolRead/uiToolWrite/terminalContext)', () => {
    expect(
      parseClientMessage({
        type: 'session:uiToolResult',
        sessionId: 's1',
        callId: 'c1',
        ok: true,
        status: 'completed',
      })?.type,
    ).toBe('session:uiToolResult')
    expect(
      parseClientMessage({
        type: 'session:uiToolRead:result',
        sessionId: 's1',
        callId: 'c1',
        ok: true,
        output: 'x',
      })?.type,
    ).toBe('session:uiToolRead:result')
    expect(
      parseClientMessage({
        type: 'session:uiToolWrite:result',
        sessionId: 's1',
        callId: 'c1',
        ok: true,
      })?.type,
    ).toBe('session:uiToolWrite:result')
    expect(parseClientMessage({ type: 'session:terminalContext', sessionId: 's1' })?.type).toBe(
      'session:terminalContext',
    )
  })
})
