import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FakeListChatModel } from '@langchain/core/utils/testing'
import type { BaseMessage } from '@langchain/core/messages'
import type { ChatGenerationChunk } from '@langchain/core/outputs'
import { mkdtempSync, rmSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { ServerMessage } from '@hip/protocol'
import { SessionManager } from './session-manager.js'
import { openDatabase } from '../persistence/open.js'
import { SessionStore } from '../persistence/store.js'

/** A model whose stream hangs until the abort signal fires (mirrors HangingChatModel in session-unit.test.ts). */
class HangingChatModel extends FakeListChatModel {
  constructor() { super({ responses: ['unreached'] }) }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bindTools(): any { return this }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async _generate(_messages: BaseMessage[], options: any): Promise<any> { return hang(options?.signal) }
  async *_streamResponseChunks(
    _messages: BaseMessage[],
    options: this['ParsedCallOptions'],
  ): AsyncGenerator<ChatGenerationChunk> {
    await hang(options.signal)
    yield undefined as unknown as ChatGenerationChunk
  }
}

function hang(signal?: AbortSignal): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    const fail = () => { const e = new Error('Aborted'); e.name = 'AbortError'; reject(e) }
    if (signal?.aborted) return fail()
    signal?.addEventListener('abort', fail, { once: true })
  })
}

const cfg = { llmProvider: 'deepseek' as const, model: 'deepseek-chat', tools: [] }
function mk(scratchRoot: string) {
  const { db, ftsEnabled } = openDatabase(':memory:')
  const store = new SessionStore(db, ftsEnabled)
  const mgr = new SessionManager(store, () => new FakeListChatModel({ responses: ['ok'] }), scratchRoot)
  return { store, mgr }
}

describe('SessionManager persistence', () => {
  let store: SessionStore, mgr: SessionManager, sent: ServerMessage[], scratchRoot: string
  const send = (m: ServerMessage) => sent.push(m)
  beforeEach(() => { scratchRoot = mkdtempSync(path.join(os.tmpdir(), 'hip-scr-')); ({ store, mgr } = mk(scratchRoot)); sent = [] })
  afterEach(() => { rmSync(scratchRoot, { recursive: true, force: true }) })

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

  it('session:load returns messages with per-message agentRuns', async () => {
    mgr.handle({ type: 'session:create', id: 's1', config: cfg }, send)
    await mgr.handleAsync({ type: 'message:send', sessionId: 's1', id: 'u1', content: 'hi', role: 'user' }, send)
    sent = []
    mgr.handle({ type: 'session:load', sessionId: 's1' }, send)
    const loaded = sent.find((m) => m.type === 'session:loaded') as Extract<ServerMessage, { type: 'session:loaded' }>
    expect(loaded.messages.some((m) => m.id === 'u1')).toBe(true)
    const assistant = loaded.messages.find((m) => m.role === 'assistant')!
    expect(assistant.agentRuns!.length).toBeGreaterThan(0)
  })

  it('session:load attaches agentRuns to each message', async () => {
    const sessionId = 's2'
    mgr.handle({ type: 'session:create', id: sessionId, config: cfg }, send)
    await mgr.handleAsync({ type: 'message:send', sessionId, id: 'u2', content: 'hello', role: 'user' }, send)
    sent = []
    // Use a fresh manager over the same store (shared in-memory DB) to prove cold-load path
    const mgr2 = new SessionManager(store, () => new FakeListChatModel({ responses: ['ok'] }), scratchRoot)
    mgr2.handle({ type: 'session:load', sessionId }, (m) => sent.push(m))
    await Promise.resolve()
    const loaded = sent.find((m) => m.type === 'session:loaded') as Extract<ServerMessage, { type: 'session:loaded' }>
    const assistant = loaded.messages.find((m) => m.role === 'assistant')!
    expect(assistant.agentRuns).toBeDefined()
    expect(assistant.agentRuns!.length).toBeGreaterThan(0)
    expect(assistant.agentRuns!.some((r) => r.messageId === assistant.id)).toBe(true)
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

  it('session:setThinking persists thinking into the session config', () => {
    mgr.handle({ type: 'session:create', id: 's1', config: cfg }, send)
    mgr.handle({ type: 'session:setThinking', sessionId: 's1', thinking: false }, send)
    const row = store.getSession('s1')
    expect(JSON.parse(row!.config).thinking).toBe(false)
  })

  it('session:setThinking echoes session:thinking with store-backed manager', () => {
    mgr.handle({ type: 'session:create', id: 's1', config: cfg }, send)
    sent = []
    mgr.handle({ type: 'session:setThinking', sessionId: 's1', thinking: false }, send)
    const echo = sent.find((m) => m.type === 'session:thinking') as Extract<ServerMessage, { type: 'session:thinking' }>
    expect(echo).toMatchObject({ sessionId: 's1', thinking: false })
  })

  it('session:setSystemPrompt persists systemPrompt into the session config', () => {
    mgr.handle({ type: 'session:create', id: 's1', config: cfg }, send)
    mgr.handle({ type: 'session:setSystemPrompt', sessionId: 's1', systemPrompt: 'Be terse' }, send)
    expect(JSON.parse(store.getSession('s1')!.config).systemPrompt).toBe('Be terse')
  })

  it('session:setSystemPrompt null clears the persisted systemPrompt', () => {
    mgr.handle({ type: 'session:create', id: 's1', config: { ...cfg, systemPrompt: 'old' } }, send)
    mgr.handle({ type: 'session:setSystemPrompt', sessionId: 's1', systemPrompt: null }, send)
    expect(JSON.parse(store.getSession('s1')!.config).systemPrompt).toBeUndefined()
  })

  it('session:setSystemPrompt echoes session:systemPrompt with the real state', () => {
    mgr.handle({ type: 'session:create', id: 's1', config: cfg }, send)
    sent = []
    mgr.handle({ type: 'session:setSystemPrompt', sessionId: 's1', systemPrompt: 'Be terse' }, send)
    const echo = sent.find((m) => m.type === 'session:systemPrompt') as Extract<ServerMessage, { type: 'session:systemPrompt' }>
    expect(echo).toMatchObject({ sessionId: 's1', systemPrompt: 'Be terse' })
  })

  it('session:setPermissionMode persists permissionMode into the session config', () => {
    mgr.handle({ type: 'session:create', id: 's1', config: cfg }, send)
    mgr.handle({ type: 'session:setPermissionMode', sessionId: 's1', permissionMode: 'full' }, send)
    expect(JSON.parse(store.getSession('s1')!.config).permissionMode).toBe('full')
  })

  it('session:setPermissionMode echoes session:permissionMode with the real state', () => {
    mgr.handle({ type: 'session:create', id: 's1', config: cfg }, send)
    sent = []
    mgr.handle({ type: 'session:setPermissionMode', sessionId: 's1', permissionMode: 'chat' }, send)
    const echo = sent.find((m) => m.type === 'session:permissionMode') as Extract<ServerMessage, { type: 'session:permissionMode' }>
    expect(echo).toMatchObject({ sessionId: 's1', permissionMode: 'chat' })
  })

  it('session:setPermissionMode echoes the default edit when the set is rejected mid-turn', () => {
    mgr.handle({ type: 'session:create', id: 's1', config: cfg }, send)
    // simulate a rejected set mid-turn: the session keeps its (undefined) mode → echo 'edit'.
    const s = mgr.getSessionForTest('s1')!
    ;(s as unknown as { running: boolean }).running = true
    sent = []
    mgr.handle({ type: 'session:setPermissionMode', sessionId: 's1', permissionMode: 'full' }, send)
    const echo = sent.find((m) => m.type === 'session:permissionMode') as Extract<ServerMessage, { type: 'session:permissionMode' }>
    expect(echo).toMatchObject({ sessionId: 's1', permissionMode: 'edit' })
  })

  it('session:load echoes the persisted config', () => {
    mgr.handle({ type: 'session:create', id: 's1', config: { ...cfg, systemPrompt: 'X' } }, send)
    sent = []
    mgr.handle({ type: 'session:load', sessionId: 's1' }, send)
    const loaded = sent.find((m) => m.type === 'session:loaded') as Extract<ServerMessage, { type: 'session:loaded' }>
    expect(loaded.config?.systemPrompt).toBe('X')
  })

  it('cancelAllRunning cancels an in-flight turn', async () => {
    // Build a manager that uses the HangingChatModel so the turn stays in-flight.
    const { db, ftsEnabled } = openDatabase(':memory:')
    const hangingStore = new SessionStore(db, ftsEnabled)
    const hangingMgr = new SessionManager(hangingStore, () => new HangingChatModel(), scratchRoot)

    hangingMgr.handle({ type: 'session:create', id: 'h1', config: cfg }, send)

    const turnEvents: ServerMessage[] = []
    const turnSend = (m: ServerMessage) => turnEvents.push(m)

    // Start the turn but don't await — it hangs until aborted.
    const turnPromise = hangingMgr.handleAsync(
      { type: 'message:send', sessionId: 'h1', id: 'u-hang', content: 'hang', role: 'user' },
      turnSend,
    )

    // Give the turn enough time to reach the model call (necessary for the abort
    // signal to have an effect — one microtask tick is insufficient).
    await new Promise((r) => setTimeout(r, 0))

    // Cancel all running turns (simulates ws close).
    hangingMgr.cancelAllRunning()

    // The turn must now settle.
    await turnPromise

    // Either an error (CANCELLED/TIMEOUT/AbortError) or a message:complete with stopped=true.
    const hasError = turnEvents.some((m) => m.type === 'error')
    const hasComplete = turnEvents.some((m) => m.type === 'message:complete')
    expect(hasError || hasComplete).toBe(true)
  })

  it('cancelAllRunning is a no-op when nothing is running', () => {
    // Fresh manager with no sessions — must not throw.
    const { db, ftsEnabled } = openDatabase(':memory:')
    const idleMgr = new SessionManager(new SessionStore(db, ftsEnabled), () => new FakeListChatModel({ responses: ['ok'] }), scratchRoot)
    expect(() => idleMgr.cancelAllRunning()).not.toThrow()
  })
})
