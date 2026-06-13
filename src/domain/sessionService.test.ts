// src/domain/sessionService.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import type { ClientMessage, ServerMessage } from '@hip/protocol'
import { SessionService } from './sessionService'
import { useDomainStore } from './sessionStore'
import { useFsStore } from '@/store/fsStore'
import { useDraftStore } from '@/store/draftStore'
import { useUiStore } from '@/store/uiStore'
import { useDiffStore } from '@/store/diffStore'
import type { ConnectionStatus, Transport } from './transport'

class FakeTransport implements Transport {
  sent: ClientMessage[] = []
  private handler: ((m: ServerMessage) => void) | null = null
  private statusHandler: ((s: ConnectionStatus) => void) | null = null
  // Mirror the real transport: opening drives a 'connected' status through onStatus.
  async connect() { this.statusHandler?.('connected') }
  disconnect() {}
  send(msg: ClientMessage) { this.sent.push(msg) }
  onMessage(h: (m: ServerMessage) => void) { this.handler = h; return () => { this.handler = null } }
  onStatus(h: (s: ConnectionStatus) => void) { this.statusHandler = h; return () => { this.statusHandler = null } }
  push(m: ServerMessage) { this.handler?.(m) }
  pushStatus(s: ConnectionStatus) { this.statusHandler?.(s) }
}

beforeEach(() => {
  // NOTE: drop the `true` (replace) flag — Zustand v5 setState with replace=true
  // wipes action methods from the store, causing "X is not a function" errors.
  // Using merge (no second arg) keeps actions intact and resets only data fields.
  useDomainStore.setState({ sessions: [{ id: 's1', config: { llmProvider: 'deepseek', model: 'm', tools: [] }, title: 'T', preview: 'P', updatedAtMs: 0, loaded: true, messages: [], status: 'idle', error: null }], activeSessionId: 's1', connection: 'disconnected' })
  useFsStore.setState({ bySession: {} })
  useDraftStore.setState({ draft: null })
  useDiffStore.setState({ bySession: {} })
  useUiStore.setState({ scrollTargetMessageId: null, activeTab: 'agents' })
})

describe('SessionService', () => {
  it('sendMessage optimistically appends user message and sends message:send', () => {
    const t = new FakeTransport()
    const svc = new SessionService(t)
    svc.sendMessage('  hello  ')
    expect(useDomainStore.getState().sessions[0].messages.at(-1)).toMatchObject({ role: 'user', content: 'hello' })
    expect(useDomainStore.getState().sessions[0].status).toBe('running')
    expect(t.sent.at(-1)).toMatchObject({ type: 'message:send', sessionId: 's1', content: 'hello' })
    expect((t.sent.at(-1) as { id?: string }).id).toBeTruthy()
  })

  it('sendMessage ignores blank input', () => {
    const t = new FakeTransport()
    new SessionService(t).sendMessage('   ')
    expect(t.sent).toHaveLength(0)
  })

  it('inbound ServerMessage flows into the store', () => {
    const t = new FakeTransport()
    new SessionService(t)
    t.push({ type: 'agent:started', sessionId: 's1', agentId: 'supervisor', role: 'supervisor', turnId: 't1' })
    expect(useDomainStore.getState().sessions[0].messages.at(-1)!.agentRuns).toMatchObject([{ agentId: 'supervisor', role: 'supervisor' }])
  })

  it('createSession sends session:create and activates', () => {
    const t = new FakeTransport()
    const id = new SessionService(t).createSession()
    expect(useDomainStore.getState().activeSessionId).toBe(id)
    expect(t.sent.at(-1)).toMatchObject({ type: 'session:create', id })
  })

  it('connect updates connection status', async () => {
    // New model: status flows via transport.onStatus(...) -> setConnection,
    // not a direct setConnection inside connect(). FakeTransport.connect() drives
    // a 'connected' status through the stored handler to mirror a real WS open.
    const t = new FakeTransport()
    await new SessionService(t).connect()
    expect(useDomainStore.getState().connection).toBe('connected')
  })

  it('transport status changes propagate to the store', () => {
    const t = new FakeTransport()
    new SessionService(t)
    t.pushStatus('connecting')
    expect(useDomainStore.getState().connection).toBe('connecting')
    t.pushStatus('disconnected')
    expect(useDomainStore.getState().connection).toBe('disconnected')
    t.pushStatus('error')
    expect(useDomainStore.getState().connection).toBe('error')
  })

  it('renameSession optimistically updates the store and sends session:rename', () => {
    const t = new FakeTransport()
    new SessionService(t).renameSession('s1', 'My Title')
    expect(useDomainStore.getState().sessions[0].title).toBe('My Title')
    expect(t.sent.at(-1)).toMatchObject({ type: 'session:rename', sessionId: 's1', title: 'My Title' })
  })

  it('setProjectDir optimistically sets cwd and sends session:setCwd', () => {
    const t = new FakeTransport()
    new SessionService(t).setProjectDir('s1', '/proj')
    expect(useDomainStore.getState().sessions[0].config.cwd).toBe('/proj')
    expect(t.sent.at(-1)).toMatchObject({ type: 'session:setCwd', sessionId: 's1', cwd: '/proj' })
  })

  it('setSystemPrompt optimistically sets config and sends session:setSystemPrompt', () => {
    const t = new FakeTransport()
    new SessionService(t).setSystemPrompt('s1', 'Be terse')
    expect(useDomainStore.getState().sessions[0].config.systemPrompt).toBe('Be terse')
    expect(t.sent.at(-1)).toMatchObject({ type: 'session:setSystemPrompt', sessionId: 's1', systemPrompt: 'Be terse' })
  })

  it('setSystemPrompt null clears config and sends null', () => {
    const t = new FakeTransport()
    useDomainStore.setState({ sessions: [{ ...useDomainStore.getState().sessions[0], config: { llmProvider: 'deepseek', model: 'm', tools: [], systemPrompt: 'old' } }] })
    new SessionService(t).setSystemPrompt('s1', null)
    expect(useDomainStore.getState().sessions[0].config.systemPrompt).toBeUndefined()
    expect(t.sent.at(-1)).toMatchObject({ type: 'session:setSystemPrompt', sessionId: 's1', systemPrompt: null })
  })

  it('readFile marks the preview loading and sends fs:read', () => {
    const t = new FakeTransport()
    new SessionService(t).readFile('s1', '/proj/a.md')
    expect(useFsStore.getState().bySession.s1.preview).toMatchObject({ status: 'loading', path: '/proj/a.md' })
    expect(t.sent.at(-1)).toMatchObject({ type: 'fs:read', sessionId: 's1', path: '/proj/a.md' })
  })

  it('fs:ls:result populates entries', () => {
    const t = new FakeTransport()
    new SessionService(t)
    t.push({ type: 'fs:ls:result', sessionId: 's1', path: '/proj', entries: [{ name: 'a.md', path: '/proj/a.md', isDir: false }] })
    expect(useFsStore.getState().bySession.s1.entriesByDir['/proj']).toHaveLength(1)
  })

  it('fs:read:result populates the preview', () => {
    const t = new FakeTransport()
    new SessionService(t)
    t.push({ type: 'fs:read:result', sessionId: 's1', path: '/proj/a.md', content: '# Hi', encoding: 'utf8', mimeType: 'text/markdown' })
    expect(useFsStore.getState().bySession.s1.preview).toMatchObject({ status: 'ready', content: '# Hi' })
  })

  it('commits a project draft on first send: session:create with cwd, then message:send, draft cleared', () => {
    useDomainStore.setState({ activeSessionId: null })
    useDraftStore.setState({ draft: { tempId: 'd1', mode: 'project', cwd: '/proj', text: '' } })
    const t = new FakeTransport()
    new SessionService(t).sendMessage('hello')
    const create = t.sent.find((m) => m.type === 'session:create') as Extract<ClientMessage, { type: 'session:create' }>
    expect(create.config.cwd).toBe('/proj')
    expect(t.sent.at(-1)).toMatchObject({ type: 'message:send', content: 'hello' })
    expect(useDraftStore.getState().draft).toBeNull()
    expect(useDomainStore.getState().activeSessionId).toBe(create.id)
    expect(useFsStore.getState().bySession['/proj']).toMatchObject({ activePath: null, entriesByDir: {} })
  })

  it('commits a chat draft with no cwd in the config', () => {
    useDomainStore.setState({ activeSessionId: null })
    useDraftStore.setState({ draft: { tempId: 'd2', mode: 'chat', text: '' } })
    const t = new FakeTransport()
    new SessionService(t).sendMessage('hi there')
    const create = t.sent.find((m) => m.type === 'session:create') as Extract<ClientMessage, { type: 'session:create' }>
    expect(create.config.cwd).toBeUndefined()
  })

  it('lsDraft sends fs:lsCwd', () => {
    const t = new FakeTransport()
    new SessionService(t).lsDraft('/proj', '/proj/src')
    expect(t.sent.at(-1)).toMatchObject({ type: 'fs:lsCwd', cwd: '/proj', path: '/proj/src' })
  })

  it('readDraftFile marks preview loading (keyed by cwd) and sends fs:readCwd', () => {
    const t = new FakeTransport()
    new SessionService(t).readDraftFile('/proj', '/proj/a.md')
    expect(useFsStore.getState().bySession['/proj'].preview).toMatchObject({ status: 'loading', path: '/proj/a.md' })
    expect(t.sent.at(-1)).toMatchObject({ type: 'fs:readCwd', cwd: '/proj', path: '/proj/a.md' })
  })

  it('fs:lsCwd:result populates entries under the cwd key', () => {
    const t = new FakeTransport()
    new SessionService(t)
    t.push({ type: 'fs:lsCwd:result', cwd: '/proj', path: '/proj', entries: [{ name: 'a.md', path: '/proj/a.md', isDir: false }] })
    expect(useFsStore.getState().bySession['/proj'].entriesByDir['/proj']).toHaveLength(1)
  })

  it('fs:readCwd:result populates the preview under the cwd key', () => {
    const t = new FakeTransport()
    new SessionService(t)
    t.push({ type: 'fs:readCwd:result', cwd: '/proj', path: '/proj/a.md', content: '# Hi', encoding: 'utf8', mimeType: 'text/markdown' })
    expect(useFsStore.getState().bySession['/proj'].preview).toMatchObject({ status: 'ready', content: '# Hi' })
  })

  it('newConversation ensures a draft and deselects the active session', () => {
    useDomainStore.setState({ activeSessionId: 's1' })
    const t = new FakeTransport()
    new SessionService(t).newConversation()
    expect(useDomainStore.getState().activeSessionId).toBeNull()
    expect(useDraftStore.getState().draft).not.toBeNull()
  })

  it('regenerate optimistically drops the trailing assistant and sends message:regenerate', () => {
    useDomainStore.setState({
      sessions: [{ id: 's1', config: { llmProvider: 'deepseek', model: 'm', tools: [] }, title: 'T', preview: 'P', updatedAtMs: 0, loaded: true, messages: [{ id: 'u1', role: 'user', content: 'hi', timestamp: 0 }, { id: 'a1', role: 'assistant', content: 'ans', timestamp: 1 }], status: 'idle', error: null }],
      activeSessionId: 's1',
    })
    const t = new FakeTransport()
    new SessionService(t).regenerate()
    expect(useDomainStore.getState().sessions[0].messages.map((m) => m.role)).toEqual(['user'])
    expect(t.sent.at(-1)).toMatchObject({ type: 'message:regenerate', sessionId: 's1' })
  })

  it('regenerate is a no-op while a turn is running', () => {
    useDomainStore.setState({
      sessions: [{ id: 's1', config: { llmProvider: 'deepseek', model: 'm', tools: [] }, title: 'T', preview: 'P', updatedAtMs: 0, loaded: true, messages: [{ id: 'u1', role: 'user', content: 'hi', timestamp: 0 }], status: 'running', error: null }],
      activeSessionId: 's1',
    })
    const t = new FakeTransport()
    new SessionService(t).regenerate()
    expect(t.sent.some((m) => m.type === 'message:regenerate')).toBe(false)
    // The guard lives in the service: the store must be left untouched.
    expect(useDomainStore.getState().sessions[0].messages).toHaveLength(1)
    expect(useDomainStore.getState().sessions[0].status).toBe('running')
  })

  it('regenerate is a no-op when there is no active session', () => {
    useDomainStore.setState({ activeSessionId: null })
    const t = new FakeTransport()
    new SessionService(t).regenerate()
    expect(t.sent.some((m) => m.type === 'message:regenerate')).toBe(false)
  })

  it('routes a send to message:resume when an interrupt is pending, and clears it', () => {
    const t = new FakeTransport()
    const svc = new SessionService(t)
    useDomainStore.setState({ sessions: [{ ...useDomainStore.getState().sessions[0], interrupt: { turnId: 't1', question: 'q' } }] })
    svc.sendMessage('do this instead')
    expect(t.sent.at(-1)).toMatchObject({ type: 'message:resume', sessionId: 's1', content: 'do this instead' })
    expect(useDomainStore.getState().sessions[0].messages.at(-1)).toMatchObject({ role: 'user', content: 'do this instead' })
    expect(useDomainStore.getState().sessions[0].interrupt ?? null).toBeNull()
  })

  it('regenerate is a no-op while an interrupt is pending (avoids a stuck running state)', () => {
    const t = new FakeTransport()
    const svc = new SessionService(t)
    useDomainStore.setState({ sessions: [{ ...useDomainStore.getState().sessions[0], interrupt: { turnId: 't1', question: 'q' } }] })
    svc.regenerate()
    expect(t.sent.some((m) => m.type === 'message:regenerate')).toBe(false)
    expect(useDomainStore.getState().sessions[0].status).toBe('idle')
  })

  it('on ready, resyncs the active session when its turn was running', () => {
    useDomainStore.setState({
      sessions: [{ id: 's1', config: { llmProvider: 'deepseek', model: 'm', tools: [] }, title: 'T', preview: 'P', updatedAtMs: 0, loaded: true, messages: [], status: 'running', error: null }],
      activeSessionId: 's1',
    })
    const t = new FakeTransport()
    new SessionService(t)
    t.push({ type: 'ready', hasApiKey: true })
    expect(t.sent.some((m) => m.type === 'session:list')).toBe(true)
    const loads = t.sent.filter((m) => m.type === 'session:load' && (m as { sessionId: string }).sessionId === 's1')
    expect(loads).toHaveLength(1)
  })

  it('on ready with no running active session, only lists sessions (no session:load)', () => {
    // beforeEach sets status: 'idle' for s1
    const t = new FakeTransport()
    new SessionService(t)
    t.push({ type: 'ready', hasApiKey: true })
    expect(t.sent.some((m) => m.type === 'session:list')).toBe(true)
    expect(t.sent.some((m) => m.type === 'session:load')).toBe(false)
  })

  it('selectSession with a messageId sets activeSessionId and the scroll target', () => {
    const t = new FakeTransport()
    new SessionService(t).selectSession('s1', 'm9')
    expect(useDomainStore.getState().activeSessionId).toBe('s1')
    expect(useUiStore.getState().scrollTargetMessageId).toBe('m9')
  })

  it('selectSession without a messageId clears any stale scroll target', () => {
    useUiStore.setState({ scrollTargetMessageId: 'stale' })
    const t = new FakeTransport()
    new SessionService(t).selectSession('s1')
    expect(useUiStore.getState().scrollTargetMessageId).toBeNull()
  })

  it('selectSession lazy-loads history for an unloaded session and still sets the target', () => {
    useDomainStore.setState({
      sessions: [{ id: 's2', config: { llmProvider: 'deepseek', model: 'm', tools: [] }, title: 'T2', preview: 'P', updatedAtMs: 0, loaded: false, messages: [], status: 'idle', error: null }],
      activeSessionId: null,
    })
    const t = new FakeTransport()
    new SessionService(t).selectSession('s2', 'm1')
    expect(t.sent.some((m) => m.type === 'session:load' && (m as { sessionId: string }).sessionId === 's2')).toBe(true)
    expect(useUiStore.getState().scrollTargetMessageId).toBe('m1')
  })
})

describe('workspace diff', () => {
  it('requestDiff sets loading and sends fs:diff, deduping while in flight', () => {
    const t = new FakeTransport()
    const svc = new SessionService(t)
    svc.requestDiff('s1')
    svc.requestDiff('s1') // in flight → dropped
    expect(t.sent.filter((m) => m.type === 'fs:diff')).toHaveLength(1)
    expect(useDiffStore.getState().bySession['s1'].status).toBe('loading')
    t.push({ type: 'fs:diff:result', sessionId: 's1', state: 'ok', files: [], base: 'head', hasSessionStart: false })
    svc.requestDiff('s1') // ready again → allowed
    expect(t.sent.filter((m) => m.type === 'fs:diff')).toHaveLength(2)
  })

  it('fs:diff:result folds into diffStore', () => {
    const t = new FakeTransport()
    new SessionService(t)
    t.push({ type: 'fs:diff:result', sessionId: 's1', state: 'ok', files: [], base: 'head', hasSessionStart: false })
    expect(useDiffStore.getState().bySession['s1']).toMatchObject({ status: 'ready', state: 'ok' })
  })

  it('gitInitWorkspace sends fs:gitInit; an ok result chains a fresh fs:diff', () => {
    const t = new FakeTransport()
    const svc = new SessionService(t)
    svc.gitInitWorkspace('s1')
    expect(t.sent.at(-1)).toMatchObject({ type: 'fs:gitInit', sessionId: 's1' })
    expect(useDiffStore.getState().bySession['s1'].initPending).toBe(true)
    t.push({ type: 'fs:gitInit:result', sessionId: 's1', ok: true })
    expect(useDiffStore.getState().bySession['s1'].initPending).toBe(false)
    expect(t.sent.at(-1)).toMatchObject({ type: 'fs:diff', sessionId: 's1' })
  })

  it('a failed fs:gitInit:result keeps not_a_repo with the error inline', () => {
    const t = new FakeTransport()
    new SessionService(t)
    t.push({ type: 'fs:gitInit:result', sessionId: 's1', ok: false, error: 'boom' })
    expect(useDiffStore.getState().bySession['s1']).toMatchObject({ state: 'not_a_repo', error: 'boom', initPending: false })
    expect(t.sent.filter((m) => m.type === 'fs:diff')).toHaveLength(0)
  })

  it('message:complete refreshes the diff only while the 更改 tab is active', () => {
    const t = new FakeTransport()
    new SessionService(t)
    const message = { id: 'm1', role: 'assistant' as const, content: 'x', timestamp: 1 }
    t.push({ type: 'message:complete', sessionId: 's1', message })
    expect(t.sent.filter((m) => m.type === 'fs:diff')).toHaveLength(0)
    useUiStore.setState({ activeTab: 'changes' })
    t.push({ type: 'message:complete', sessionId: 's2', message })
    const diffs = t.sent.filter((m) => m.type === 'fs:diff')
    expect(diffs).toHaveLength(1)
    expect(diffs[0]).toMatchObject({ sessionId: 's2' })
  })

  it('ready resets a wedged loading state so requestDiff works again', () => {
    const t = new FakeTransport()
    const svc = new SessionService(t)
    svc.requestDiff('s1') // gets stuck — no reply ever arrives
    t.push({ type: 'ready', hasApiKey: true })
    svc.requestDiff('s1')
    expect(t.sent.filter((m) => m.type === 'fs:diff')).toHaveLength(2)
  })

  it('setProjectDir clears the stale diff for that session', () => {
    const t = new FakeTransport()
    const svc = new SessionService(t)
    useDiffStore.getState().setResult('s1', { state: 'ok', files: [], base: 'head', hasSessionStart: false })
    svc.setProjectDir('s1', '/tmp/other')
    expect(useDiffStore.getState().bySession['s1'].status).toBe('idle')
  })

  it('routes fs:diffSummary:result into the diff store summary', () => {
    const t = new FakeTransport(); new SessionService(t)
    t.push({ type: 'fs:diffSummary:result', sessionId: 's1', state: 'ok', base: 'head', hasSessionStart: false, summary: { totalFiles: 2, totalAdditions: 5, totalDeletions: 1 } })
    expect(useDiffStore.getState().bySession['s1'].summary).toEqual({ totalFiles: 2, totalAdditions: 5, totalDeletions: 1 })
  })

  it('on message:complete always requests a diff summary even when the diff tab is inactive', () => {
    const t = new FakeTransport(); new SessionService(t)
    useUiStore.setState({ activeTab: 'files' })
    t.push({ type: 'message:complete', sessionId: 's1', message: { id: 'm', role: 'assistant', content: '', timestamp: 0 } as any })
    expect(t.sent.some((m) => m.type === 'fs:diffSummary' && m.sessionId === 's1')).toBe(true)
  })

  it('requestDiff sends the current store base', () => {
    const t = new FakeTransport(); const svc = new SessionService(t)
    useDiffStore.getState().setResult('s1', { state: 'ok', files: [], base: 'head', hasSessionStart: true })
    svc.requestDiff('s1')
    expect(t.sent).toContainEqual({ type: 'fs:diff', sessionId: 's1', base: 'head' })
  })

  it('selectSession refreshes the Diff badge via fs:diffSummary', () => {
    const t = new FakeTransport(); const svc = new SessionService(t)
    svc.selectSession('s1')
    expect(t.sent.some((m) => m.type === 'fs:diffSummary' && m.sessionId === 's1')).toBe(true)
  })
})

describe('checkpoints + commit log', () => {
  it('requestCheckpoints sends git:checkpoint:list', () => {
    const t = new FakeTransport(); const svc = new SessionService(t)
    svc.requestCheckpoints('s1')
    expect(t.sent.at(-1)).toMatchObject({ type: 'git:checkpoint:list', sessionId: 's1' })
  })

  it('git:checkpoint:list:result folds checkpoints + isGitRepo into diffStore', () => {
    const t = new FakeTransport(); new SessionService(t)
    const checkpoint = { id: 's1:t1', sessionId: 's1', turnId: 't1', kind: 'turn' as const, label: 'x', treeSha: 'tr', commitSha: 'c', branch: 'main', createdAt: 1 }
    t.push({ type: 'git:checkpoint:list:result', sessionId: 's1', checkpoints: [checkpoint], isGitRepo: true, currentBranch: 'main' })
    const s = useDiffStore.getState().bySession['s1']
    expect(s.isGitRepo).toBe(true)
    expect(s.currentBranch).toBe('main')
    expect(s.checkpoints).toHaveLength(1)
  })

  it('checkpoint:created prepends a checkpoint (dedupe by id)', () => {
    const t = new FakeTransport(); new SessionService(t)
    const checkpoint = { id: 's1:t1', sessionId: 's1', turnId: 't1', kind: 'turn' as const, label: 'x', treeSha: 'tr', commitSha: 'c', branch: 'main', createdAt: 1 }
    t.push({ type: 'checkpoint:created', sessionId: 's1', checkpoint })
    t.push({ type: 'checkpoint:created', sessionId: 's1', checkpoint }) // duplicate id
    expect(useDiffStore.getState().bySession['s1'].checkpoints).toHaveLength(1)
  })

  it('requestCheckpointDiff sets loading and sends git:checkpoint:diff; result caches by key', () => {
    const t = new FakeTransport(); const svc = new SessionService(t)
    svc.requestCheckpointDiff('s1', 's1:t1', 'this-turn')
    expect(t.sent.at(-1)).toMatchObject({ type: 'git:checkpoint:diff', sessionId: 's1', checkpointId: 's1:t1', mode: 'this-turn' })
    expect(useDiffStore.getState().bySession['s1'].checkpointDiff['s1:t1|this-turn'].status).toBe('loading')
    t.push({ type: 'git:checkpoint:diff:result', sessionId: 's1', checkpointId: 's1:t1', mode: 'this-turn', state: 'ok', files: [] })
    expect(useDiffStore.getState().bySession['s1'].checkpointDiff['s1:t1|this-turn']).toMatchObject({ status: 'ready', state: 'ok' })
  })

  it('requestCommitLog sends git:commitLog; result folds into the store', () => {
    const t = new FakeTransport(); const svc = new SessionService(t)
    svc.requestCommitLog('s1')
    expect(t.sent.at(-1)).toMatchObject({ type: 'git:commitLog', sessionId: 's1' })
    expect(useDiffStore.getState().bySession['s1'].commitLog.status).toBe('loading')
    t.push({ type: 'git:commitLog:result', sessionId: 's1', state: 'ok', commits: [{ sha: 'a', shortSha: 'a', message: 'm', author: 'me', timestamp: 1 }] })
    expect(useDiffStore.getState().bySession['s1'].commitLog).toMatchObject({ status: 'ready', state: 'ok' })
    expect(useDiffStore.getState().bySession['s1'].commitLog.commits).toHaveLength(1)
  })

  it('selectSession requests the checkpoint list', () => {
    const t = new FakeTransport(); const svc = new SessionService(t)
    svc.selectSession('s1')
    expect(t.sent.some((m) => m.type === 'git:checkpoint:list' && m.sessionId === 's1')).toBe(true)
  })

  it('message:complete refreshes the checkpoint list', () => {
    const t = new FakeTransport(); new SessionService(t)
    t.push({ type: 'message:complete', sessionId: 's1', message: { id: 'm', role: 'assistant', content: '', timestamp: 0 } as any })
    expect(t.sent.some((m) => m.type === 'git:checkpoint:list' && m.sessionId === 's1')).toBe(true)
  })
})

describe('branches + revert', () => {
  it('requestBranches sends git:branch:list', () => {
    const t = new FakeTransport(); const svc = new SessionService(t)
    svc.requestBranches('s1')
    expect(t.sent.at(-1)).toMatchObject({ type: 'git:branch:list', sessionId: 's1' })
  })

  it('git:branch:list:result folds branches + currentBranch into diffStore', () => {
    const t = new FakeTransport(); new SessionService(t)
    t.push({ type: 'git:branch:list:result', sessionId: 's1', branches: [{ name: 'main', current: true }, { name: 'feature', current: false }], currentBranch: 'main' })
    const s = useDiffStore.getState().bySession['s1']
    expect(s.branches).toHaveLength(2)
    expect(s.currentBranch).toBe('main')
  })

  it('switchBranch sends git:branch:switch', () => {
    const t = new FakeTransport(); const svc = new SessionService(t)
    svc.switchBranch('s1', 'feature')
    expect(t.sent.at(-1)).toMatchObject({ type: 'git:branch:switch', sessionId: 's1', branch: 'feature' })
  })

  it('git:branch:switch:result on ok updates currentBranch and re-requests branches + checkpoints', () => {
    const t = new FakeTransport(); new SessionService(t)
    t.push({ type: 'git:branch:switch:result', sessionId: 's1', branch: 'feature', ok: true, currentBranch: 'feature' })
    expect(useDiffStore.getState().bySession['s1'].currentBranch).toBe('feature')
    expect(t.sent.some((m) => m.type === 'git:branch:list' && m.sessionId === 's1')).toBe(true)
    expect(t.sent.some((m) => m.type === 'git:checkpoint:list' && m.sessionId === 's1')).toBe(true)
  })

  it('revertCheckpoint sends git:revert', () => {
    const t = new FakeTransport(); const svc = new SessionService(t)
    svc.revertCheckpoint('s1', 's1:t1')
    expect(t.sent.at(-1)).toMatchObject({ type: 'git:revert', sessionId: 's1', checkpointId: 's1:t1' })
  })

  it('git:revert:result on ok re-requests the checkpoint list + diff summary', () => {
    const t = new FakeTransport(); new SessionService(t)
    t.push({ type: 'git:revert:result', sessionId: 's1', checkpointId: 's1:t1', ok: true, safetyCheckpointId: 's1:pre-revert-1' })
    expect(t.sent.some((m) => m.type === 'git:checkpoint:list' && m.sessionId === 's1')).toBe(true)
    expect(t.sent.some((m) => m.type === 'fs:diffSummary' && m.sessionId === 's1')).toBe(true)
  })

  it('git:branch:switch:result on FAILURE records switchError so the confirm modal can recover', () => {
    const t = new FakeTransport(); new SessionService(t)
    // dropdown was populated first (on 'main')
    t.push({ type: 'git:branch:list:result', sessionId: 's1', branches: [{ name: 'main', current: true }, { name: 'feature', current: false }], currentBranch: 'main' })
    t.push({ type: 'git:branch:switch:result', sessionId: 's1', branch: 'feature', ok: false, currentBranch: 'main', error: 'dirty tree' })
    expect(useDiffStore.getState().bySession['s1'].switchError).toBe('dirty tree')
    // currentBranch stays put (the switch did not happen)
    expect(useDiffStore.getState().bySession['s1'].currentBranch).toBe('main')
  })

  it('a successful branch list clears a prior switchError', () => {
    const t = new FakeTransport(); new SessionService(t)
    t.push({ type: 'git:branch:switch:result', sessionId: 's1', branch: 'feature', ok: false, currentBranch: 'main', error: 'dirty tree' })
    t.push({ type: 'git:branch:list:result', sessionId: 's1', branches: [{ name: 'main', current: true }], currentBranch: 'main' })
    expect(useDiffStore.getState().bySession['s1'].switchError).toBeNull()
  })

  it('git:revert:result on FAILURE records revertError so the confirm modal can recover', () => {
    const t = new FakeTransport(); new SessionService(t)
    t.push({ type: 'git:revert:result', sessionId: 's1', checkpointId: 's1:t1', ok: false, error: 'safety checkpoint failed' })
    expect(useDiffStore.getState().bySession['s1'].revertError).toBe('safety checkpoint failed')
    // no refresh requests fire on a failed revert
    expect(t.sent.some((m) => m.type === 'git:checkpoint:list' && m.sessionId === 's1')).toBe(false)
  })
})
