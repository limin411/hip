import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FakeListChatModel } from '@langchain/core/utils/testing'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { Session } from './session.js'

let root: string
const fake = () => new FakeListChatModel({ responses: ['ok'] })
const cfg = { llmProvider: 'deepseek' as const, model: 'm', tools: [] }

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'hip-sess-'))
  await fs.writeFile(path.join(root, 'README.md'), '# Hi')
})
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })

describe('Session workspace', () => {
  it('lsDir returns no_workspace before a cwd is bound', async () => {
    const s = new Session('s1', cfg, fake())
    expect(await s.lsDir(root)).toMatchObject({ error: 'no_workspace' })
  })

  it('setCwd binds the workspace and exposes it via config', async () => {
    const s = new Session('s2', cfg, fake())
    s.setCwd(root)
    expect(s.config.cwd).toBe(root)
    const r = await s.lsDir(root)
    expect(r.entries?.some((e) => e.name === 'README.md')).toBe(true)
  })

  it('rebuilding the agent on setCwd keeps the session runnable', async () => {
    const s = new Session('s3', cfg, fake())
    s.hydrate([{ id: 'u1', role: 'user', content: 'earlier', timestamp: 1 }])
    s.setCwd(root)
    const events: { type: string }[] = []
    await s.sendMessage('hello', (m) => events.push(m as { type: string }))
    expect(events.some((e) => e.type === 'message:complete')).toBe(true)
  })
})
