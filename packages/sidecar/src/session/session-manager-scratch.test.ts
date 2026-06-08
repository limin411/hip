import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FakeListChatModel } from '@langchain/core/utils/testing'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { ServerMessage } from '@hip/protocol'
import { SessionManager } from './session-manager.js'

const cfg = { llmProvider: 'deepseek' as const, model: 'm', tools: [] }
let scratchRoot: string
beforeEach(() => { scratchRoot = mkdtempSync(path.join(os.tmpdir(), 'hip-scrtest-')) })
afterEach(() => { rmSync(scratchRoot, { recursive: true, force: true }) })

function mgr(): SessionManager {
  return new SessionManager(undefined, () => new FakeListChatModel({ responses: ['ok'] }), scratchRoot)
}

describe('SessionManager scratch dir', () => {
  it('derives + creates a scratch cwd for a no-cwd session and reports it via session:cwd', () => {
    const sent: ServerMessage[] = []
    mgr().handle({ type: 'session:create', id: 'chat1', config: cfg }, (m) => sent.push(m))
    const cwdMsg = sent.find((m) => m.type === 'session:cwd') as Extract<ServerMessage, { type: 'session:cwd' }>
    expect(cwdMsg).toBeDefined()
    expect(cwdMsg.cwd).toBe(path.join(scratchRoot, 'chat1'))
    expect(existsSync(path.join(scratchRoot, 'chat1'))).toBe(true)
  })
  it('does NOT create a scratch dir when a cwd is provided (project session)', () => {
    const sent: ServerMessage[] = []
    mgr().handle({ type: 'session:create', id: 'proj1', config: { ...cfg, cwd: scratchRoot } }, (m) => sent.push(m))
    expect(sent.some((m) => m.type === 'session:cwd')).toBe(false)
    expect(existsSync(path.join(scratchRoot, 'proj1'))).toBe(false)
  })
  it('removes the scratch dir on session:delete', () => {
    const m = mgr()
    m.handle({ type: 'session:create', id: 'chat2', config: cfg }, () => {})
    expect(existsSync(path.join(scratchRoot, 'chat2'))).toBe(true)
    m.handle({ type: 'session:delete', sessionId: 'chat2' }, () => {})
    expect(existsSync(path.join(scratchRoot, 'chat2'))).toBe(false)
  })
})
