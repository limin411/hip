import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FakeListChatModel } from '@langchain/core/utils/testing'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { ServerMessage } from '@hip/protocol'
import { SessionManager } from './session-manager.js'

let root: string
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'hip-mgr-'))
  await fs.writeFile(path.join(root, 'README.md'), '# Hi')
})
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })

function setup() {
  const sent: ServerMessage[] = []
  const send = (m: ServerMessage) => sent.push(m)
  const mgr = new SessionManager(undefined, () => new FakeListChatModel({ responses: ['ok'] }), path.join(root, '.scratch'))
  mgr.handle({ type: 'session:create', id: 's1', config: { llmProvider: 'deepseek', model: 'm', tools: [] } }, send)
  return { mgr, sent, send }
}

describe('session-manager fs', () => {
  it('session:setCwd echoes session:cwd', () => {
    const { mgr, sent, send } = setup()
    mgr.handle({ type: 'session:setCwd', sessionId: 's1', cwd: root }, send)
    expect(sent).toContainEqual({ type: 'session:cwd', sessionId: 's1', cwd: root })
  })

  it('session:setThinking echoes session:thinking', () => {
    const { mgr, sent, send } = setup()
    mgr.handle({ type: 'session:setThinking', sessionId: 's1', thinking: false }, send)
    expect(sent).toContainEqual({ type: 'session:thinking', sessionId: 's1', thinking: false })
  })

  it('session:setThinking true echoes session:thinking true', () => {
    const { mgr, sent, send } = setup()
    mgr.handle({ type: 'session:setThinking', sessionId: 's1', thinking: true }, send)
    expect(sent).toContainEqual({ type: 'session:thinking', sessionId: 's1', thinking: true })
  })

  it('session:setPermissionMode echoes session:permissionMode and updates the live session', () => {
    const { mgr, sent, send } = setup()
    mgr.handle({ type: 'session:setPermissionMode', sessionId: 's1', permissionMode: 'chat' }, send)
    expect(sent).toContainEqual({ type: 'session:permissionMode', sessionId: 's1', permissionMode: 'chat' })
    expect(mgr.getSessionForTest('s1')!.config.permissionMode).toBe('chat')
  })

  it('session:setPermissionMode echoes the REAL mode (edit default) when rejected mid-turn', () => {
    const { mgr, sent, send } = setup()
    // Simulate an in-flight turn so setPermissionMode is a NO-OP; the echo must still report truth.
    ;(mgr.getSessionForTest('s1') as unknown as { running: boolean }).running = true
    mgr.handle({ type: 'session:setPermissionMode', sessionId: 's1', permissionMode: 'full' }, send)
    expect(sent).toContainEqual({ type: 'session:permissionMode', sessionId: 's1', permissionMode: 'edit' })
    // createSession normalizes defaults; rejected mid-turn must not flip to 'full'.
    expect(mgr.getSessionForTest('s1')!.config.permissionMode).toBe('edit')
  })

  it('fs:ls returns directory entries', async () => {
    const { mgr, sent, send } = setup()
    mgr.handle({ type: 'session:setCwd', sessionId: 's1', cwd: root }, send)
    await mgr.handleAsync({ type: 'fs:ls', sessionId: 's1', path: root }, send)
    const ls = sent.find((m) => m.type === 'fs:ls:result') as Extract<ServerMessage, { type: 'fs:ls:result' }>
    expect(ls.entries.some((e) => e.name === 'README.md')).toBe(true)
  })

  it('fs:read returns file content', async () => {
    const { mgr, sent, send } = setup()
    mgr.handle({ type: 'session:setCwd', sessionId: 's1', cwd: root }, send)
    await mgr.handleAsync({ type: 'fs:read', sessionId: 's1', path: path.join(root, 'README.md') }, send)
    const read = sent.find((m) => m.type === 'fs:read:result') as Extract<ServerMessage, { type: 'fs:read:result' }>
    expect(read.content).toContain('# Hi')
    expect(read.encoding).toBe('utf8')
  })

  it('fs:lsCwd lists a directory without a session', async () => {
    const sent: ServerMessage[] = []
    const send = (m: ServerMessage) => sent.push(m)
    const mgr2 = new SessionManager(undefined, () => new FakeListChatModel({ responses: ['ok'] }), path.join(root, '.scratch'))
    await mgr2.handleAsync({ type: 'fs:lsCwd', cwd: root, path: root }, send)
    const ls = sent.find((m) => m.type === 'fs:lsCwd:result') as Extract<ServerMessage, { type: 'fs:lsCwd:result' }>
    expect(ls.entries.some((e) => e.name === 'README.md')).toBe(true)
  })

  it('fs:readCwd reads a file without a session', async () => {
    const sent: ServerMessage[] = []
    const send = (m: ServerMessage) => sent.push(m)
    const mgr2 = new SessionManager(undefined, () => new FakeListChatModel({ responses: ['ok'] }), path.join(root, '.scratch'))
    await mgr2.handleAsync({ type: 'fs:readCwd', cwd: root, path: path.join(root, 'README.md') }, send)
    const read = sent.find((m) => m.type === 'fs:readCwd:result') as Extract<ServerMessage, { type: 'fs:readCwd:result' }>
    expect(read.content).toContain('# Hi')
  })

  it('fs:lsCwd rejects a path outside the cwd', async () => {
    const sent: ServerMessage[] = []
    const send = (m: ServerMessage) => sent.push(m)
    const mgr2 = new SessionManager(undefined, () => new FakeListChatModel({ responses: ['ok'] }), path.join(root, '.scratch'))
    await mgr2.handleAsync({ type: 'fs:lsCwd', cwd: root, path: '/etc' }, send)
    const ls = sent.find((m) => m.type === 'fs:lsCwd:result') as Extract<ServerMessage, { type: 'fs:lsCwd:result' }>
    expect(ls.error).toBeTruthy()
  })

  it('fs:readCwd rejects a path outside the cwd', async () => {
    const sent: ServerMessage[] = []
    const send = (m: ServerMessage) => sent.push(m)
    const mgr2 = new SessionManager(undefined, () => new FakeListChatModel({ responses: ['ok'] }), path.join(root, '.scratch'))
    await mgr2.handleAsync({ type: 'fs:readCwd', cwd: root, path: '/etc/hosts' }, send)
    const read = sent.find((m) => m.type === 'fs:readCwd:result') as Extract<ServerMessage, { type: 'fs:readCwd:result' }>
    expect(read.error).toBeTruthy()
  })

  it('fs:lsCwd rejects a relative cwd', async () => {
    const sent: ServerMessage[] = []
    const send = (m: ServerMessage) => sent.push(m)
    const mgr2 = new SessionManager(undefined, () => new FakeListChatModel({ responses: ['ok'] }), path.join(root, '.scratch'))
    await mgr2.handleAsync({ type: 'fs:lsCwd', cwd: 'relative/dir', path: 'relative/dir' }, send)
    const ls = sent.find((m) => m.type === 'fs:lsCwd:result') as Extract<ServerMessage, { type: 'fs:lsCwd:result' }>
    expect(ls.error).toBeTruthy()
  })
})
