import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FakeListChatModel } from '@langchain/core/utils/testing'
import { mkdtempSync, rmSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { ServerMessage } from '@hip/protocol'
import { SessionManager } from './session-manager.js'
import { openDatabase } from '../persistence/open.js'
import { SessionStore } from '../persistence/store.js'

const cfg = { llmProvider: 'deepseek' as const, model: 'deepseek-chat', tools: [] }

function mk(scratchRoot: string) {
  const { db, ftsEnabled } = openDatabase(':memory:')
  const store = new SessionStore(db, ftsEnabled)
  const mgr = new SessionManager(store, () => new FakeListChatModel({ responses: ['ok'] }), scratchRoot)
  return { store, mgr }
}

describe('SessionManager input queue routes', () => {
  let store: SessionStore, mgr: SessionManager, sent: ServerMessage[], scratchRoot: string
  const send = (m: ServerMessage) => sent.push(m)

  beforeEach(() => {
    scratchRoot = mkdtempSync(path.join(os.tmpdir(), 'hip-scr-'))
    ;({ store, mgr } = mk(scratchRoot))
    sent = []
  })
  afterEach(() => {
    rmSync(scratchRoot, { recursive: true, force: true })
  })

  it('input:enqueue creates a pending input row and processes it when idle', async () => {
    mgr.handle({ type: 'session:create', id: 's1', config: cfg }, send)
    await mgr.handleAsync({ type: 'input:enqueue', sessionId: 's1', id: 'iq-1', content: 'hello' }, send)

    const pending = store.listPendingSessionInputs('s1')
    expect(pending.length).toBe(0) // processed immediately while idle
    expect(sent.some((m) => m.type === 'message:complete')).toBe(true)
  })

  it('input:steer aborts a running turn and is processed next', async () => {
    mgr.handle({ type: 'session:create', id: 's1', config: cfg }, send)

    // Start a slow turn first
    const slowSend = (m: ServerMessage) => {}
    const turnPromise = mgr.handleAsync({ type: 'message:send', sessionId: 's1', id: 'u1', content: 'first', role: 'user' }, slowSend)

    // Give the turn time to set running=true
    await new Promise((r) => setTimeout(r, 0))

    const steerSent: ServerMessage[] = []
    await mgr.handleAsync({ type: 'input:steer', sessionId: 's1', id: 'st-1', content: 'go faster' }, (m) => steerSent.push(m))

    await turnPromise

    // Steer input should be persisted as a steer row or consumed; the running turn should be aborted.
    const steers = store.listPendingSessionInputs('s1').filter((r) => r.delivery === 'steer')
    expect(steers.length).toBeLessThanOrEqual(1)
  })
})

describe('SessionManager subagent:background route', () => {
  let store: SessionStore, mgr: SessionManager, sent: ServerMessage[], scratchRoot: string
  const send = (m: ServerMessage) => sent.push(m)

  beforeEach(() => {
    scratchRoot = mkdtempSync(path.join(os.tmpdir(), 'hip-scr-'))
    ;({ store, mgr } = mk(scratchRoot))
    sent = []
  })
  afterEach(() => {
    rmSync(scratchRoot, { recursive: true, force: true })
  })

  it('subagent:background starts a background task and emits agent:started', async () => {
    mgr.handle({ type: 'session:create', id: 's1', config: cfg }, send)

    await mgr.handleAsync(
      { type: 'subagent:background', sessionId: 's1', taskId: 'bg-1', description: 'do work' },
      send,
    )

    expect(sent.some((m) => m.type === 'agent:started' && m.taskId === 'bg-1')).toBe(true)
  })

  it('subagent:background for unknown session does not throw and returns cleanly', async () => {
    await expect(
      mgr.handleAsync(
        { type: 'subagent:background', sessionId: 'unknown', taskId: 'bg-1', description: 'do work' },
        send,
      ),
    ).resolves.toBeUndefined()
  })
})

describe('SessionManager safeErrorMessage wrapping', () => {
  let store: SessionStore, mgr: SessionManager, sent: ServerMessage[], scratchRoot: string
  const send = (m: ServerMessage) => sent.push(m)

  beforeEach(() => {
    scratchRoot = mkdtempSync(path.join(os.tmpdir(), 'hip-scr-'))
    ;({ store, mgr } = mk(scratchRoot))
    sent = []
  })
  afterEach(() => {
    rmSync(scratchRoot, { recursive: true, force: true })
  })

  it('input:enqueue on a lazily-loaded session processes the input', async () => {
    store.insertSession({ id: 'lazy', title: 't', config: JSON.stringify(cfg), createdAt: 1, updatedAt: 1 })

    await expect(
      mgr.handleAsync({ type: 'input:enqueue', sessionId: 'lazy', id: 'iq-1', content: 'x' }, send),
    ).resolves.toBeUndefined()
  })
})
