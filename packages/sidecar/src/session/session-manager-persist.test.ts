import { describe, it, expect, beforeEach } from 'vitest'
import { FakeListChatModel } from '@langchain/core/utils/testing'
import type { ServerMessage } from '@hip/protocol'
import { SessionManager } from './session-manager.js'
import { openDatabase } from '../persistence/open.js'
import { SessionStore } from '../persistence/store.js'

const cfg = { llmProvider: 'deepseek' as const, model: 'deepseek-chat', tools: [] }
function mk() {
  const { db, ftsEnabled } = openDatabase(':memory:')
  const store = new SessionStore(db, ftsEnabled)
  const mgr = new SessionManager(store, () => new FakeListChatModel({ responses: ['ok'] }))
  return { store, mgr }
}

describe('SessionManager persistence', () => {
  let store: SessionStore, mgr: SessionManager, sent: ServerMessage[]
  const send = (m: ServerMessage) => sent.push(m)
  beforeEach(() => { ({ store, mgr } = mk()); sent = [] })

  it('persists the session row on session:create', () => {
    mgr.handle({ type: 'session:create', id: 's1', config: cfg }, send)
    expect(store.getSession('s1')).toBeDefined()
  })

  it('session:list returns persisted sessions', () => {
    mgr.handle({ type: 'session:create', id: 's1', config: cfg }, send)
    sent = []
    mgr.handle({ type: 'session:list' }, send)
    const res = sent.find((m) => m.type === 'session:list:result') as Extract<ServerMessage, { type: 'session:list:result' }>
    expect(res.sessions.map((s) => s.id)).toContain('s1')
  })

  it('session:load returns messages + agentRuns', async () => {
    mgr.handle({ type: 'session:create', id: 's1', config: cfg }, send)
    await mgr.handleAsync({ type: 'message:send', sessionId: 's1', id: 'u1', content: 'hi', role: 'user' }, send)
    sent = []
    mgr.handle({ type: 'session:load', sessionId: 's1' }, send)
    const loaded = sent.find((m) => m.type === 'session:loaded') as Extract<ServerMessage, { type: 'session:loaded' }>
    expect(loaded.messages.some((m) => m.id === 'u1')).toBe(true)
    expect(loaded.agentRuns.length).toBeGreaterThan(0)
  })

  it('rehydrates a cold session from the DB on message:send', async () => {
    store.insertSession({ id: 's9', title: 't', config: JSON.stringify(cfg), createdAt: 1, updatedAt: 1 })
    store.insertMessage({ id: 'u0', sessionId: 's9', role: 'user', agentId: null, content: '我叫小明', timestamp: 1 })
    await mgr.handleAsync({ type: 'message:send', sessionId: 's9', id: 'u1', content: '再见', role: 'user' }, send)
    const ids = store.loadMessages('s9').map((m) => m.id)
    expect(ids).toEqual(expect.arrayContaining(['u0', 'u1']))
  })

  it('session:delete removes the session and emits session:deleted', () => {
    mgr.handle({ type: 'session:create', id: 's1', config: cfg }, send)
    sent = []
    mgr.handle({ type: 'session:delete', sessionId: 's1' }, send)
    expect(store.getSession('s1')).toBeUndefined()
    expect(sent.some((m) => m.type === 'session:deleted')).toBe(true)
  })

  it('session:rename sets a pinned custom title and echoes session:title', () => {
    mgr.handle({ type: 'session:create', id: 's1', config: cfg }, send)
    sent = []
    mgr.handle({ type: 'session:rename', sessionId: 's1', title: '  我的项目  ' }, send)
    expect(store.getSession('s1')!.title).toBe('我的项目')
    const echo = sent.find((m) => m.type === 'session:title') as Extract<ServerMessage, { type: 'session:title' }>
    expect(echo).toMatchObject({ sessionId: 's1', title: '我的项目' })
  })

  it('session:rename falls back to 新对话 for blank input', () => {
    mgr.handle({ type: 'session:create', id: 's1', config: cfg }, send)
    mgr.handle({ type: 'session:rename', sessionId: 's1', title: '   ' }, send)
    expect(store.getSession('s1')!.title).toBe('新对话')
  })
})
