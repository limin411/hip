import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { promisify } from 'node:util'
import { Session } from './session.js'
import type { SessionConfig } from '@hip/protocol'

const execFileP = promisify(execFile)
const git = (cwd: string, ...args: string[]) => execFileP('git', args, { cwd })

function makeConfig(overrides: Partial<SessionConfig> = {}): SessionConfig {
  return { llmProvider: 'test', model: 'test-model', tools: [], cwd: '/tmp/test-cwd', ...overrides }
}

describe('Session with extracted modules', () => {
  it('constructs with all modules wired', () => {
    const s = new Session('test-1', makeConfig())
    expect(s.git).toBeDefined()
    expect(s.permissions).toBeDefined()
    expect(s.agentProv).toBeDefined()
    expect(s.configMgr).toBeDefined()
    expect(s.config.cwd).toBe('/tmp/test-cwd')
  })

  it('git module delegates captureSnapshot', async () => {
    const s = new Session('test-2', makeConfig({ cwd: undefined }))
    await s.captureSnapshot()
    // No-op when cwd is undefined — just shouldn't throw
  })

  it('configMgr delegates setCwd', () => {
    const s = new Session('test-3', makeConfig({ cwd: '/tmp/old' }))
    s.setCwd('/tmp/new')
    expect(s.config.cwd).toBe('/tmp/new')
  })

  it('configMgr delegates setThinking', () => {
    const s = new Session('test-4', makeConfig())
    expect(s.setThinking(false)).toBe(true)
    expect(s.config.thinking).toBe(false)
  })

  it('configMgr delegates setModel', () => {
    const s = new Session('test-5', makeConfig({ llmProvider: 'deepseek' }))
    expect(s.setModel('openai')).toBe(true)
    expect(s.config.llmProvider).toBe('openai')
    expect(s.config.model).toBe('')
  })

  it('configMgr delegates setSystemPrompt', () => {
    const s = new Session('test-6', makeConfig())
    expect(s.setSystemPrompt('be helpful')).toBe(true)
    expect(s.config.systemPrompt).toBe('be helpful')
  })

  it('configMgr delegates applyActiveModel', () => {
    const s = new Session('test-7', makeConfig())
    expect(s.applyActiveModel()).toBe(true)
  })

  it('permission module delegates setPermissionMode', () => {
    const s = new Session('test-8', makeConfig())
    expect(s.setPermissionMode('chat')).toBe(true)
    expect(s.config.permissionMode).toBe('chat')
  })

  it('permission module delegates respondPermission', () => {
    const s = new Session('test-9', makeConfig())
    // No pending permission — just a no-op
    s.respondPermission('nonexistent', { cancelled: true })
  })

  it('agentProv module delegates setAgentConfigOption', async () => {
    const s = new Session('test-10', makeConfig({ agentId: 'builtin' }))
    // isExternalAgent is false for builtin — setAgentConfigOption no-ops
    await s.setAgentConfigOption('model', 'gpt-4')
  })

  it('agentProv reports isExternalAgent correctly', () => {
    const s1 = new Session('test-11', makeConfig({ agentId: undefined }))
    expect(s1.agentProv.isExternalAgent()).toBe(false)

    const s2 = new Session('test-12', makeConfig({ agentId: 'builtin' }))
    expect(s2.agentProv.isExternalAgent()).toBe(false)
  })

  it('configMgr delegates reloadPlugins', () => {
    const s = new Session('test-13', makeConfig({ agentId: 'builtin' }))
    s.reloadPlugins()
    // Should not throw and should keep caches populated
    expect(s.configMgr.skills).toBeDefined()
  })

  it('hydrate + reseedLastCheckpoint works after extraction', () => {
    const s = new Session('test-14', makeConfig())
    s.hydrate([{ id: 'm1', role: 'user', content: 'hello', timestamp: Date.now() }])
  })

  it('workspaceDiff delegates to git module', async () => {
    const s = new Session('test-16', makeConfig({ cwd: undefined }))
    const r = await s.workspaceDiff()
    expect(r.state).toBe('no_cwd')
  })

  it('workspaceDiffSummary delegates to git module', async () => {
    const s = new Session('test-17', makeConfig({ cwd: undefined }))
    const r = await s.workspaceDiffSummary()
    expect(r.state).toBe('no_cwd')
  })

  it('workspaceDiffFile delegates to git module', async () => {
    const s = new Session('test-18', makeConfig({ cwd: undefined }))
    const r = await s.workspaceDiffFile('/x')
    expect(r.state).toBe('no_cwd')
  })

  it('workspaceGitInit delegates to git module', async () => {
    const s = new Session('test-19', makeConfig({ cwd: undefined }))
    const r = await s.workspaceGitInit()
    expect(r.ok).toBe(false)
    expect(r.error).toBe('no_workspace')
  })

  it('listCheckpoints delegates to git module', async () => {
    const s = new Session('test-20', makeConfig({ cwd: undefined }))
    const r = await s.listCheckpoints()
    expect(r.checkpoints).toEqual([])
    expect(r.isGitRepo).toBe(false)
  })

  it('commitLog delegates to git module', async () => {
    const s = new Session('test-22', makeConfig({ cwd: undefined }))
    const r = await s.commitLog()
    expect(r.state).toBe('no_cwd')
  })

  it('commitLog returns repo history (not only session-scoped commits)', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hip-session-commitlog-'))
    try {
      await fs.writeFile(path.join(dir, 'a.txt'), 'one\n')
      await git(dir, 'init')
      await git(dir, 'add', '-A')
      await git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'pre-session', '--allow-empty')
      await fs.writeFile(path.join(dir, 'a.txt'), 'two\n')
      await git(dir, 'add', '-A')
      await git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'in-session')
      const s = new Session('test-commitlog', makeConfig({ cwd: dir }))
      const r = await s.commitLog()
      expect(r.state).toBe('ok')
      expect(r.commits!.map((c) => c.message)).toEqual(['in-session', 'pre-session'])
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('listBranches delegates to git module', async () => {
    const s = new Session('test-23', makeConfig({ cwd: undefined }))
    const r = await s.listBranches()
    expect(r.branches).toEqual([])
  })

  it('switchBranch delegates to git module', async () => {
    const s = new Session('test-24', makeConfig({ cwd: undefined }))
    const r = await s.switchBranch('main')
    expect(r.ok).toBe(false)
    expect(r.error).toBe('no_workspace')
  })
})
