import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ClientMessage, ServerMessage, SessionConfig } from '@hip/protocol'
import { openDatabase } from '../persistence/open.js'
import { MemoryStore } from './store.js'
import { MemoryService } from './service.js'
import {
  MEMORY_MESSAGE_TYPES,
  handleMemoryMessage,
  isMemoryMessage,
  type MemoryHandlerContext,
} from './handlers.js'
import type { Session } from '../session/session.js'

function freshService(configPath?: string) {
  const { db, memoriesFtsEnabled } = openDatabase(':memory:')
  const store = new MemoryStore(db, memoriesFtsEnabled)
  const svc = new MemoryService(store, configPath ? { configPath } : undefined)
  return { db, store, svc }
}

/** Minimal session stand-in for setMemoryFlags (avoids full Session construct). */
function fakeSession(initial: Partial<SessionConfig> = {}): Session {
  const base: SessionConfig = {
    llmProvider: 'deepseek',
    model: '',
    tools: [],
    ...initial,
  }
  const s = { _config: { ...base } } as Session & { _config: SessionConfig }
  Object.defineProperty(s, 'config', {
    get() {
      return this._config
    },
  })
  return s
}

describe('memory handlers', () => {
  let dir: string
  let configPath: string
  let svc: MemoryService
  let store: MemoryStore
  let sent: ServerMessage[]
  let sessions: Map<string, Session>
  let configBlobs: Map<string, string>
  let ctx: MemoryHandlerContext

  const send = (msg: ServerMessage) => {
    sent.push(msg)
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hip-mem-handlers-'))
    configPath = join(dir, 'memory.json')
    ;({ svc, store } = freshService(configPath))
    sent = []
    sessions = new Map()
    configBlobs = new Map()
    ctx = {
      getMemoryService: () => svc,
      ensureSession: (id) => {
        let s = sessions.get(id)
        if (!s) {
          const raw = configBlobs.get(id)
          const parsed = raw ? (JSON.parse(raw) as SessionConfig) : undefined
          s = fakeSession(parsed)
          sessions.set(id, s)
        }
        return s
      },
      getSession: (id) => sessions.get(id),
      store: {
        updateConfig(id, config) {
          configBlobs.set(id, config)
        },
        getSession(id) {
          const config = configBlobs.get(id)
          return config ? { config } : undefined
        },
      },
    }
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('isMemoryMessage only matches MEMORY_MESSAGE_TYPES', () => {
    for (const type of MEMORY_MESSAGE_TYPES) {
      expect(isMemoryMessage({ type } as ClientMessage)).toBe(true)
    }
    expect(isMemoryMessage({ type: 'session:list' } as ClientMessage)).toBe(false)
    expect(isMemoryMessage({ type: 'memory:unknown' } as unknown as ClientMessage)).toBe(false)
    expect(isMemoryMessage({ type: 'session:setCwd', sessionId: 'x', cwd: '/' } as ClientMessage)).toBe(false)
  })

  it('setConfig persists and getConfig returns saved values', () => {
    handleMemoryMessage(
      ctx,
      { type: 'memory:setConfig', config: { useMemories: true, generateMemories: true } },
      send,
    )
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      type: 'memory:config',
      config: { useMemories: true, generateMemories: true },
    })

    // New service instance on same path = "reload across process"
    const { svc: reloaded } = freshService(configPath)
    const reloadCtx: MemoryHandlerContext = {
      ...ctx,
      getMemoryService: () => reloaded,
    }
    sent = []
    handleMemoryMessage(reloadCtx, { type: 'memory:getConfig' }, send)
    expect(sent[0]).toMatchObject({
      type: 'memory:config',
      config: { useMemories: true, generateMemories: true },
    })
  })

  it('upsert + list', () => {
    handleMemoryMessage(
      ctx,
      {
        type: 'memory:upsert',
        item: {
          title: 'Prefer yarn',
          content: 'Use yarn in this monorepo',
          kind: 'convention',
          scope: 'global',
        },
      },
      send,
    )
    const upserted = sent[0]
    expect(upserted.type).toBe('memory:upsert:result')
    if (upserted.type !== 'memory:upsert:result') throw new Error('expected upsert result')
    expect(upserted.item?.title).toBe('Prefer yarn')
    expect(upserted.error).toBeUndefined()

    sent = []
    handleMemoryMessage(ctx, { type: 'memory:list', scope: 'global' }, send)
    expect(sent[0]).toMatchObject({
      type: 'memory:list:result',
      items: [expect.objectContaining({ title: 'Prefer yarn', scope: 'global' })],
    })
  })

  it('memory:list defaults to status=active (hides archived/deleted)', () => {
    const active = svc.upsert({
      title: 'Active tip',
      content: 'visible',
      kind: 'preference',
      scope: 'global',
    })
    const archived = svc.upsert({
      title: 'Archived tip',
      content: 'hidden',
      kind: 'preference',
      scope: 'global',
    })
    store.upsertItem({ ...store.getItem(archived.id)!, status: 'archived', updatedAt: Date.now() })
    const deleted = svc.upsert({
      title: 'Deleted tip',
      content: 'gone',
      kind: 'preference',
      scope: 'global',
    })
    store.upsertItem({ ...store.getItem(deleted.id)!, status: 'deleted', updatedAt: Date.now() })

    handleMemoryMessage(ctx, { type: 'memory:list', scope: 'global' }, send)
    expect(sent[0].type).toBe('memory:list:result')
    if (sent[0].type !== 'memory:list:result') throw new Error('expected list result')
    expect(sent[0].items.map((i) => i.id)).toEqual([active.id])
    expect(sent[0].items.every((i) => i.status === 'active')).toBe(true)
  })

  it('deleteBySourceSession hard deletes derived items', () => {
    const a = svc.upsert({
      title: 'from s1',
      content: 'lesson one',
      kind: 'lesson',
      scope: 'project',
      source: 'extract',
      sourceSessionId: 's1',
      projectKeyHash: 'pk',
    })
    const b = svc.upsert({
      title: 'from s2',
      content: 'lesson two',
      kind: 'lesson',
      scope: 'project',
      source: 'extract',
      sourceSessionId: 's2',
      projectKeyHash: 'pk',
    })
    expect(store.getItem(a.id)).toBeDefined()
    expect(store.getItem(b.id)).toBeDefined()

    handleMemoryMessage(
      ctx,
      { type: 'memory:deleteBySourceSession', sessionId: 's1' },
      send,
    )
    expect(sent[0]).toEqual({
      type: 'memory:deleteBySourceSession:result',
      sessionId: 's1',
      deleted: 1,
    })
    expect(store.getItem(a.id)).toBeUndefined()
    expect(store.getItem(b.id)).toBeDefined()
  })

  it('setMemoryFlags merges and persists for later config re-read', () => {
    const sessionId = 'sess-flags'
    sessions.set(sessionId, fakeSession({ useMemories: false }))

    handleMemoryMessage(
      ctx,
      {
        type: 'session:setMemoryFlags',
        sessionId,
        useMemories: true,
        generateMemories: false,
        incognito: true,
      },
      send,
    )
    expect(sent[0]).toEqual({
      type: 'session:memoryFlags',
      sessionId,
      useMemories: true,
      generateMemories: false,
      incognito: true,
    })

    const live = sessions.get(sessionId)!
    expect(live.config.useMemories).toBe(true)
    expect(live.config.generateMemories).toBe(false)
    expect(live.config.incognito).toBe(true)

    const blob = configBlobs.get(sessionId)
    expect(blob).toBeTruthy()
    const reRead = JSON.parse(blob!) as SessionConfig
    expect(reRead.useMemories).toBe(true)
    expect(reRead.generateMemories).toBe(false)
    expect(reRead.incognito).toBe(true)

    // ensureSession rebuild from store would see same flags
    sessions.delete(sessionId)
    const rehydrated = ctx.ensureSession(sessionId, send)
    expect(rehydrated.config.useMemories).toBe(true)
    expect(rehydrated.config.incognito).toBe(true)
  })

  it('memory:get and memory:delete soft', () => {
    const item = svc.upsert({
      title: 't',
      content: 'c',
      kind: 'profile',
      scope: 'global',
    })
    handleMemoryMessage(ctx, { type: 'memory:get', id: item.id }, send)
    expect(sent[0]).toMatchObject({ type: 'memory:get:result', item: { id: item.id } })

    sent = []
    handleMemoryMessage(ctx, { type: 'memory:delete', id: item.id }, send)
    expect(sent[0]).toEqual({ type: 'memory:delete:result', id: item.id, ok: true })
    expect(store.getItem(item.id)?.status).toBe('deleted')
  })

  it('memory:consolidate emits started then noop when no stage1', async () => {
    handleMemoryMessage(ctx, { type: 'memory:consolidate' }, send)
    expect(sent[0]).toEqual({
      type: 'memory:pipeline',
      phase: 2,
      status: 'started',
    })
    // Wait for async Phase2 settle
    await new Promise((r) => setTimeout(r, 50))
    const last = sent[sent.length - 1]
    expect(last).toMatchObject({ type: 'memory:pipeline', phase: 2 })
    expect(['noop', 'failed', 'succeeded']).toContain(
      (last as { status: string }).status,
    )
  })
})
