import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FakeListChatModel } from '@langchain/core/utils/testing'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { ServerMessage } from '@hip/protocol'
import { SessionManager } from './session-manager.js'

let root: string
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'hip-mgr-diff-'))
  await fs.writeFile(path.join(root, 'README.md'), '# Hi\n')
})
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })

function setup() {
  const sent: ServerMessage[] = []
  const send = (m: ServerMessage) => sent.push(m)
  const mgr = new SessionManager(undefined, () => new FakeListChatModel({ responses: ['ok'] }), path.join(root, '.scratch'))
  mgr.handle({ type: 'session:create', id: 's1', config: { llmProvider: 'deepseek', model: 'm', tools: [], cwd: root } }, send)
  return { mgr, sent, send }
}
const last = <T extends ServerMessage['type']>(sent: ServerMessage[], type: T) =>
  sent.filter((m) => m.type === type).at(-1) as Extract<ServerMessage, { type: T }>

describe('session-manager diff', () => {
  it('fs:diff on a non-repo cwd reports not_a_repo', async () => {
    const { mgr, sent, send } = setup()
    await mgr.handleAsync({ type: 'fs:diff', sessionId: 's1' }, send)
    expect(last(sent, 'fs:diff:result')).toMatchObject({ sessionId: 's1', state: 'not_a_repo' })
  })

  it('fs:gitInit then fs:diff reports a clean ok state', async () => {
    const { mgr, sent, send } = setup()
    await mgr.handleAsync({ type: 'fs:gitInit', sessionId: 's1' }, send)
    expect(last(sent, 'fs:gitInit:result')).toMatchObject({ sessionId: 's1', ok: true })
    await mgr.handleAsync({ type: 'fs:diff', sessionId: 's1' }, send)
    expect(last(sent, 'fs:diff:result')).toMatchObject({ sessionId: 's1', state: 'ok', files: [], summary: { totalFiles: 0, totalAdditions: 0, totalDeletions: 0 } })
  })

  it('fs:diff surfaces a modification made after init', async () => {
    const { mgr, sent, send } = setup()
    await mgr.handleAsync({ type: 'fs:gitInit', sessionId: 's1' }, send)
    await fs.writeFile(path.join(root, 'README.md'), '# Changed\n')
    await mgr.handleAsync({ type: 'fs:diff', sessionId: 's1' }, send)
    const r = last(sent, 'fs:diff:result')
    expect(r.state).toBe('ok')
    expect(r.files![0]).toMatchObject({ path: 'README.md', additions: 1, deletions: 1 })
  })

  it('fs:diff result carries base=head, hasSessionStart=false and a summary', async () => {
    const { mgr, sent, send } = setup()
    await mgr.handleAsync({ type: 'fs:gitInit', sessionId: 's1' }, send)
    await fs.writeFile(path.join(root, 'README.md'), '# Changed\n')
    await mgr.handleAsync({ type: 'fs:diff', sessionId: 's1' }, send)
    const msg = last(sent, 'fs:diff:result')
    expect(msg).toMatchObject({ state: 'ok', base: 'head', hasSessionStart: false })
    expect(msg.summary!.totalFiles).toBeGreaterThanOrEqual(1)
    expect('totalFiles' in msg).toBe(false) // old top-level field removed
  })

  it('fs:diffSummary returns only the summary (no files)', async () => {
    const { mgr, sent, send } = setup()
    await mgr.handleAsync({ type: 'fs:gitInit', sessionId: 's1' }, send)
    await fs.writeFile(path.join(root, 'README.md'), '# Changed\n')
    await mgr.handleAsync({ type: 'fs:diffSummary', sessionId: 's1' }, send)
    const msg = last(sent, 'fs:diffSummary:result')
    expect(msg).toMatchObject({ state: 'ok', base: 'head', hasSessionStart: false })
    expect(msg.summary).toBeDefined()
    expect((msg as Record<string, unknown>)['files']).toBeUndefined()
  })
})
