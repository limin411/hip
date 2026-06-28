import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionManager } from './session-manager.js'
import type { ServerMessage } from '@hip/protocol'

let scratch: string
beforeEach(() => { scratch = mkdtempSync(join(tmpdir(), 'hip-mgr-')) })
afterEach(() => { rmSync(scratch, { recursive: true, force: true }) })

describe('SessionManager message:resume routing', () => {
  it('forwards message:resume to the session as a guarded no-op when not awaiting', async () => {
    const mgr = new SessionManager(undefined, () => undefined, scratch)
    const sent: ServerMessage[] = []
    mgr.handle({ type: 'session:create', id: 's1', config: { llmProvider: 'deepseek', model: '', tools: [] } }, (m) => sent.push(m))
    // Session never paused → resume() returns immediately (before any model/key access) → no error.
    await mgr.handleAsync({ type: 'message:resume', sessionId: 's1', content: 'hi' }, (m) => sent.push(m))
    expect(sent.some((m) => m.type === 'error')).toBe(false)
  })

  it('forwards message:resume with attachments without error when not awaiting', async () => {
    const mgr = new SessionManager(undefined, () => undefined, scratch)
    const sent: ServerMessage[] = []
    mgr.handle({ type: 'session:create', id: 's1', config: { llmProvider: 'deepseek', model: '', tools: [] } }, (m) => sent.push(m))
    await mgr.handleAsync({
      type: 'message:resume',
      sessionId: 's1',
      content: '',
      attachments: [{ id: 'a1', name: 'x.png', mimeType: 'image/png', path: '/tmp/x.png' }],
    }, (m) => sent.push(m))
    expect(sent.some((m) => m.type === 'error')).toBe(false)
  })
})
