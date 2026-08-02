import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FakeListChatModel } from '@langchain/core/utils/testing'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { ServerMessage } from '@hip/protocol'
import { SessionManager } from './session-manager.js'

const execFileP = promisify(execFile)
const git = (cwd: string, ...args: string[]) => execFileP('git', args, { cwd })

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

  it('fs:diff base=session-start reports hasSessionStart and scopes to post-create changes', async () => {
    // Set up a git repo before creating the session
    await git(root, 'init')
    await git(root, 'add', '-A')
    await git(root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'init', '--allow-empty')

    const sent: ServerMessage[] = []
    const send = (m: ServerMessage) => sent.push(m)
    const mgr = new SessionManager(undefined, () => new FakeListChatModel({ responses: ['ok'] }), path.join(root, '.scratch'))
    mgr.handle({ type: 'session:create', id: 's2', config: { llmProvider: 'deepseek', model: 'm', tools: [], cwd: root } }, send)

    // Explicitly await captureSnapshot so the test is deterministic (fire-and-forget in production is racy)
    await mgr.getSessionForTest('s2')!.captureSnapshot()

    // Make a post-create change
    await fs.writeFile(path.join(root, 'agent.txt'), 'by agent\n')

    await mgr.handleAsync({ type: 'fs:diff', sessionId: 's2', base: 'session-start' }, send)
    const msg = last(sent, 'fs:diff:result')
    expect(msg).toMatchObject({ base: 'session-start', hasSessionStart: true, state: 'ok' })
    // Only the post-create file should appear
    expect(msg.files!.map((f: { path: string }) => f.path)).toEqual(['agent.txt'])
  })

  it('git:commitDiff returns the diff of one commit with cwd-relative paths', async () => {
    const { mgr, sent, send } = setup()
    await mgr.handleAsync({ type: 'fs:gitInit', sessionId: 's1' }, send)
    await fs.writeFile(path.join(root, 'README.md'), '# Changed\n')
    await git(root, 'add', '-A')
    await git(root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'second')
    const sha = (await git(root, 'rev-parse', 'HEAD')).stdout.trim()
    await mgr.handleAsync({ type: 'git:commitDiff', sessionId: 's1', sha }, send)
    const r = last(sent, 'git:commitDiff:result')
    expect(r).toMatchObject({ sessionId: 's1', sha, state: 'ok' })
    expect(r.files![0]).toMatchObject({ path: 'README.md', status: 'modified' })
  })

  it('git:commitDiff rejects a non-hex sha', async () => {
    const { mgr, sent, send } = setup()
    await mgr.handleAsync({ type: 'fs:gitInit', sessionId: 's1' }, send)
    await mgr.handleAsync({ type: 'git:commitDiff', sessionId: 's1', sha: 'HEAD' }, send)
    expect(last(sent, 'git:commitDiff:result')).toMatchObject({ sessionId: 's1', state: 'error' })
  })

  it('git:discard restores a modified file to HEAD', async () => {
    const { mgr, sent, send } = setup()
    await mgr.handleAsync({ type: 'fs:gitInit', sessionId: 's1' }, send)
    await fs.writeFile(path.join(root, 'README.md'), '# Changed\n')
    await mgr.handleAsync(
      { type: 'git:discard', sessionId: 's1', path: 'README.md', status: 'modified' },
      send,
    )
    expect(last(sent, 'git:discard:result')).toMatchObject({ sessionId: 's1', path: 'README.md', ok: true })
    expect(await fs.readFile(path.join(root, 'README.md'), 'utf8')).toBe('# Hi\n')
  })
})
