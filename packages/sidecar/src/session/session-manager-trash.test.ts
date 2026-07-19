import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FakeListChatModel } from '@langchain/core/utils/testing'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { ServerMessage } from '@hip/protocol'
import { openDatabase } from '../persistence/open.js'
import { SessionStore } from '../persistence/store.js'
import { SessionManager } from './session-manager.js'

const cfg = { llmProvider: 'deepseek' as const, model: 'm', tools: [] as string[] }

describe('SessionManager soft-delete / trash', () => {
  let scratchRoot: string
  let store: SessionStore
  let mgr: SessionManager
  let sent: ServerMessage[]

  beforeEach(() => {
    scratchRoot = mkdtempSync(path.join(os.tmpdir(), 'hip-trash-'))
    const { db, ftsEnabled } = openDatabase(':memory:')
    store = new SessionStore(db, ftsEnabled)
    mgr = new SessionManager(store, () => new FakeListChatModel({ responses: ['ok'] }), scratchRoot)
    sent = []
  })

  afterEach(() => {
    mgr.stopTrashRetentionHousekeeping()
    rmSync(scratchRoot, { recursive: true, force: true })
  })

  function send(m: ServerMessage) {
    sent.push(m)
  }

  it('session:softDelete emits session:trashed, keeps row + scratch, drops from list', () => {
    mgr.handle({ type: 'session:create', id: 's1', config: cfg }, send)
    expect(existsSync(path.join(scratchRoot, 's1'))).toBe(true)
    sent = []
    mgr.handle({ type: 'session:softDelete', sessionId: 's1', reason: 'user' }, send)
    expect(sent.some((m) => m.type === 'session:trashed')).toBe(true)
    expect(store.isSessionTrashed('s1')).toBe(true)
    expect(store.listSessions()).toHaveLength(0)
    expect(existsSync(path.join(scratchRoot, 's1'))).toBe(true) // soft keeps scratch
  })

  it('session:delete (hard) still removes scratch', () => {
    mgr.handle({ type: 'session:create', id: 's1', config: cfg }, send)
    expect(existsSync(path.join(scratchRoot, 's1'))).toBe(true)
    mgr.handle({ type: 'session:delete', sessionId: 's1' }, send)
    expect(existsSync(path.join(scratchRoot, 's1'))).toBe(false)
    expect(store.getSession('s1')).toBeUndefined()
  })

  it('session:restore returns session:restored and list includes session', () => {
    mgr.handle({ type: 'session:create', id: 's1', config: cfg }, send)
    mgr.handle({ type: 'session:softDelete', sessionId: 's1' }, send)
    sent = []
    mgr.handle({ type: 'session:restore', sessionId: 's1' }, send)
    const restored = sent.find((m) => m.type === 'session:restored') as Extract<
      ServerMessage,
      { type: 'session:restored' }
    >
    expect(restored).toBeDefined()
    expect(restored.summary.id).toBe('s1')
    expect(store.isSessionTrashed('s1')).toBe(false)
    expect(store.listSessions().map((s) => s.id)).toContain('s1')
  })

  it('mutations on trashed session return SESSION_TRASHED', async () => {
    mgr.handle({ type: 'session:create', id: 's1', config: cfg }, send)
    mgr.handle({ type: 'session:softDelete', sessionId: 's1' }, send)
    sent = []
    await mgr.handleAsync({ type: 'session:load', sessionId: 's1' }, send)
    const err = sent.find((m) => m.type === 'error') as Extract<ServerMessage, { type: 'error' }>
    expect(err?.code).toBe('SESSION_TRASHED')

    sent = []
    await mgr.handleAsync(
      { type: 'message:send', sessionId: 's1', id: 'm1', content: 'hi', role: 'user' },
      send,
    )
    expect(sent.some((m) => m.type === 'error' && (m as { code: string }).code === 'SESSION_TRASHED')).toBe(
      true,
    )

    sent = []
    await mgr.handleAsync({ type: 'session:rename', sessionId: 's1', title: 'nope' }, send)
    expect(sent.some((m) => m.type === 'error' && (m as { code: string }).code === 'SESSION_TRASHED')).toBe(
      true,
    )
  })

  it('session:trash:list returns soft-deleted sessions', () => {
    mgr.handle({ type: 'session:create', id: 'a', config: cfg }, send)
    mgr.handle({ type: 'session:create', id: 'b', config: cfg }, send)
    mgr.handle({ type: 'session:softDelete', sessionId: 'a' }, send)
    sent = []
    mgr.handle({ type: 'session:trash:list' }, send)
    const list = sent.find((m) => m.type === 'session:trash:list:result') as Extract<
      ServerMessage,
      { type: 'session:trash:list:result' }
    >
    expect(list.sessions.map((s) => s.id)).toContain('a')
    expect(list.sessions.map((s) => s.id)).not.toContain('b')
  })

  it('session:trash:empty hard-deletes all trashed sessions', () => {
    mgr.handle({ type: 'session:create', id: 'a', config: cfg }, send)
    mgr.handle({ type: 'session:create', id: 'b', config: cfg }, send)
    mgr.handle({ type: 'session:softDelete', sessionId: 'a' }, send)
    mgr.handle({ type: 'session:softDelete', sessionId: 'b' }, send)
    sent = []
    mgr.handle({ type: 'session:trash:empty' }, send)
    expect(store.listTrashedSessions()).toHaveLength(0)
    expect(store.getSession('a')).toBeUndefined()
    expect(sent.filter((m) => m.type === 'session:deleted')).toHaveLength(2)
  })

  it('session:trash:purge hard-deletes only expired trash', () => {
    store.insertSession({ id: 'old', title: 'old', config: JSON.stringify(cfg), createdAt: 1, updatedAt: 1 })
    store.insertSession({ id: 'new', title: 'new', config: JSON.stringify(cfg), createdAt: 1, updatedAt: 2 })
    const now = Date.now()
    store.softDeleteSession('old', { deletedAt: now - 10 * 24 * 60 * 60 * 1000 })
    store.softDeleteSession('new', { deletedAt: now - 1 * 24 * 60 * 60 * 1000 })
    sent = []
    mgr.handle({ type: 'session:trash:purge', retentionDays: 7 }, send)
    const result = sent.find((m) => m.type === 'session:trash:purge:result') as Extract<
      ServerMessage,
      { type: 'session:trash:purge:result' }
    >
    expect(result.purgedIds).toEqual(['old'])
    expect(result.retentionDays).toBe(7)
    expect(store.getSession('old')).toBeUndefined()
    expect(store.isSessionTrashed('new')).toBe(true)
  })
})
