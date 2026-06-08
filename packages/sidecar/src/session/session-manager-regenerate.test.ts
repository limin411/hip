import { describe, it, expect, afterAll } from 'vitest'
import * as os from 'node:os'
import * as path from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { FakeListChatModel } from '@langchain/core/utils/testing'
import type { ServerMessage } from '@hip/protocol'
import { SessionManager } from './session-manager.js'
import { openDatabase } from '../persistence/open.js'
import { SessionStore } from '../persistence/store.js'

const cfg = { llmProvider: 'deepseek' as const, model: 'deepseek-chat', tools: [] }

const scratch = mkdtempSync(path.join(os.tmpdir(), 'hip-test-scratch-regen-'))
afterAll(() => { rmSync(scratch, { recursive: true, force: true }) })

describe('SessionManager message:regenerate routing', () => {
  it('routes message:regenerate to Session.regenerate (assistant count stays 1)', async () => {
    const { db, ftsEnabled } = openDatabase(':memory:')
    const store = new SessionStore(db, ftsEnabled)
    const mgr = new SessionManager(store, () => new FakeListChatModel({ responses: ['answer'] }), scratch)
    const events: ServerMessage[] = []
    const send = (m: ServerMessage) => events.push(m)

    mgr.handle({ type: 'session:create', id: 's1', config: cfg }, send)
    await mgr.handleAsync({ type: 'message:send', sessionId: 's1', id: 'u1', content: 'hi', role: 'user' }, send)
    expect(store.loadMessages('s1').filter((m) => m.role === 'assistant')).toHaveLength(1)

    await mgr.handleAsync({ type: 'message:regenerate', sessionId: 's1' }, send)
    expect(store.loadMessages('s1').filter((m) => m.role === 'assistant')).toHaveLength(1)
    expect(store.loadMessages('s1').filter((m) => m.role === 'user')).toHaveLength(1)
  })
})
