// src/domain/sessionService.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { ClientMessage, ServerMessage } from '@hip/protocol'
import { toast } from 'sonner'
import { SessionService } from './sessionService'
import { useDomainStore, DEFAULT_CONFIG } from './sessionStore'
import { useFsStore } from '@/store/fsStore'
import { useDraftStore } from '@/store/draftStore'
import { useUiStore } from '@/store/uiStore'
import { useDiffStore } from '@/store/diffStore'
import { useProvidersStore } from '@/store/providersStore'
import { useHipConfigStore } from '@/store/hipConfigStore'
import { useProjectPathStore } from '@/store/projectPathStore'
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

const multimodalCatalog = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    env: [],
    models: { 'gpt-4o': { id: 'gpt-4o', name: 'GPT-4o', attachment: true } },
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    env: [],
    models: { 'deepseek-v4-flash': { id: 'deepseek-v4-flash', name: 'V4 Flash', attachment: false } },
  },
}

const textActiveConfig = {
  providers: { deepseek: { enabled: true } },
  activeModel: { providerID: 'deepseek', modelID: 'deepseek-v4-flash' },
}

const visionAgent = {
  id: 'a1',
  name: 'Vision',
  kind: 'internal' as const,
  command: '',
  args: [],
  enabled: true,
  boundModel: { providerID: 'openai', modelID: 'gpt-4o' },
  prompt: '',
}

beforeEach(() => {
  // NOTE: drop the `true` (replace) flag — Zustand v5 setState with replace=true
  // wipes action methods from the store, causing "X is not a function" errors.
  // Using merge (no second arg) keeps actions intact and resets only data fields.
  // Default fixture is chat (sandbox): code sessions require a live cwd to send.
  useDomainStore.setState({ sessions: [{ id: 's1', config: { llmProvider: 'deepseek', model: 'm', tools: [], surface: 'chat' }, title: 'T', preview: 'P', updatedAtMs: 0, loaded: true, messages: [], status: 'idle', error: null }], activeSessionId: 's1', connection: 'disconnected' })
  useFsStore.setState({ bySession: {} })
  useDraftStore.setState({ draft: null })
  useDiffStore.setState({ bySession: {} })
  useUiStore.setState({ scrollTargetMessageId: null, activeTab: 'agents' })
  useProvidersStore.setState({ catalog: multimodalCatalog, config: textActiveConfig, keyConfigured: {}, loaded: true })
  useHipConfigStore.setState({ config: { version: 1, agents: [visionAgent] }, loaded: true, error: null })
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

  it('sendMessage blocks code sessions without a project folder', () => {
    useDomainStore.setState({
      sessions: [
        {
          id: 's1',
          config: { llmProvider: 'deepseek', model: 'm', tools: [], surface: 'code' },
          title: 'T',
          preview: 'P',
          updatedAtMs: 0,
          loaded: true,
          messages: [],
          status: 'idle',
          error: null,
        },
      ],
      activeSessionId: 's1',
    })
    const t = new FakeTransport()
    new SessionService(t).sendMessage('hello')
    expect(t.sent.filter((m) => m.type === 'message:send')).toHaveLength(0)
    expect(useDomainStore.getState().sessions[0].messages).toHaveLength(0)
  })

  it('sendMessage blocks code sessions when project path is missing', () => {
    useDomainStore.setState({
      sessions: [
        {
          id: 's1',
          config: { llmProvider: 'deepseek', model: 'm', tools: [], surface: 'code', cwd: '/gone' },
          title: 'T',
          preview: 'P',
          updatedAtMs: 0,
          loaded: true,
          messages: [],
          status: 'idle',
          error: null,
        },
      ],
      activeSessionId: 's1',
    })
    useProjectPathStore.setState({
      byKey: { '/gone': { exists: false, checkedAt: Date.now() } },
    })
    const t = new FakeTransport()
    new SessionService(t).sendMessage('hello')
    expect(t.sent.filter((m) => m.type === 'message:send')).toHaveLength(0)
    useProjectPathStore.setState({ byKey: {} })
  })

  it('sendMessage ignores blank input', () => {
    const t = new FakeTransport()
    new SessionService(t).sendMessage('   ')
    expect(t.sent).toHaveLength(0)
  })

  it('sendMessage forwards attachments to the store and transport', () => {
    const t = new FakeTransport()
    const svc = new SessionService(t)
    const attachments = [{ id: 'a1', name: 'notes.md', mimeType: 'text/markdown', path: '/proj/notes.md' }]
    svc.sendMessage('summarize', attachments)
    expect(useDomainStore.getState().sessions[0].messages.at(-1)).toMatchObject({ role: 'user', content: 'summarize', attachments })
    expect(t.sent.at(-1)).toMatchObject({ type: 'message:send', sessionId: 's1', content: 'summarize', attachments: [{ id: 'a1', name: 'notes.md', mimeType: 'text/markdown', path: '/proj/notes.md' }] })
  })

  it('sendMessage allows attachment-only submission', () => {
    const t = new FakeTransport()
    const svc = new SessionService(t)
    const attachments = [{ id: 'a2', name: 'image.png', mimeType: 'image/png', path: '/tmp/image.png' }]
    svc.sendMessage('   ', attachments)
    expect(useDomainStore.getState().sessions[0].messages.at(-1)).toMatchObject({ role: 'user', content: '', attachments })
    expect(t.sent.at(-1)).toMatchObject({ type: 'message:send', content: '', attachments })
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

  it('createSession with activate:false leaves prior activeSessionId and surface pointers unchanged', () => {
    useUiStore.setState({
      activeView: 'chat',
      chatSessionId: 's1',
      codeSessionId: 'code-keep',
    })
    const t = new FakeTransport()
    const svc = new SessionService(t)
    const bgId = svc.createSession({ ...DEFAULT_CONFIG, surface: 'chat' }, { activate: false })
    expect(useDomainStore.getState().activeSessionId).toBe('s1')
    expect(useDomainStore.getState().sessions.some((s) => s.id === bgId)).toBe(true)
    expect(t.sent.at(-1)).toMatchObject({ type: 'session:create', id: bgId })
    expect(useUiStore.getState().chatSessionId).toBe('s1')
    expect(useUiStore.getState().codeSessionId).toBe('code-keep')
  })

  it('createSession default still activates (back-compat)', () => {
    useUiStore.setState({
      activeView: 'chat',
      chatSessionId: 's1',
      codeSessionId: 'code-keep',
    })
    const t = new FakeTransport()
    const id = new SessionService(t).createSession({ ...DEFAULT_CONFIG, surface: 'chat' })
    expect(useDomainStore.getState().activeSessionId).toBe(id)
    // rememberActiveForSurface still runs on activate path (restore-on-switch pointer).
    expect(useUiStore.getState().chatSessionId).toBe(id)
    expect(useUiStore.getState().codeSessionId).toBe('code-keep')
  })

  it('createSession with activate:true refreshes chat surface pointer', () => {
    useUiStore.setState({
      activeView: 'chat',
      chatSessionId: 's1',
      codeSessionId: 'code-keep',
    })
    const t = new FakeTransport()
    const id = new SessionService(t).createSession(
      { ...DEFAULT_CONFIG, surface: 'chat' },
      { activate: true },
    )
    expect(useDomainStore.getState().activeSessionId).toBe(id)
    expect(useUiStore.getState().chatSessionId).toBe(id)
    expect(useUiStore.getState().codeSessionId).toBe('code-keep')
  })

  it('sendMessageToSession sends to target session without switching active', () => {
    const t = new FakeTransport()
    const svc = new SessionService(t)
    const bgId = svc.createSession({ ...DEFAULT_CONFIG, surface: 'chat' }, { activate: false })
    expect(useDomainStore.getState().activeSessionId).toBe('s1')
    svc.sendMessageToSession(bgId, '  automation prompt  ')
    expect(useDomainStore.getState().activeSessionId).toBe('s1')
    const bg = useDomainStore.getState().sessions.find((s) => s.id === bgId)!
    expect(bg.messages.at(-1)).toMatchObject({ role: 'user', content: 'automation prompt' })
    expect(bg.status).toBe('running')
    expect(t.sent.at(-1)).toMatchObject({
      type: 'message:send',
      sessionId: bgId,
      content: 'automation prompt',
      role: 'user',
    })
    // Active chat messages untouched.
    expect(useDomainStore.getState().sessions.find((s) => s.id === 's1')!.messages).toHaveLength(0)
  })

  it('sendMessageToSession forwards attachments without changing active', () => {
    const t = new FakeTransport()
    const svc = new SessionService(t)
    const bgId = svc.createSession({ ...DEFAULT_CONFIG, surface: 'chat' }, { activate: false })
    const attachments = [{ id: 'a1', name: 'notes.md', mimeType: 'text/markdown', path: '/proj/notes.md' }]
    svc.sendMessageToSession(bgId, 'look', attachments)
    expect(useDomainStore.getState().activeSessionId).toBe('s1')
    expect(t.sent.at(-1)).toMatchObject({
      type: 'message:send',
      sessionId: bgId,
      content: 'look',
      attachments: [{ id: 'a1', name: 'notes.md', mimeType: 'text/markdown', path: '/proj/notes.md' }],
    })
  })

  it('sendMessageToSession no-ops for unknown sessionId (no wire split-brain)', () => {
    const t = new FakeTransport()
    const svc = new SessionService(t)
    const before = t.sent.length
    svc.sendMessageToSession('missing-session', 'hello')
    expect(useDomainStore.getState().activeSessionId).toBe('s1')
    expect(t.sent.filter((m) => m.type === 'message:send')).toHaveLength(0)
    expect(t.sent.length).toBe(before)
    expect(useDomainStore.getState().sessions.find((s) => s.id === 's1')!.messages).toHaveLength(0)
  })

  it('deleteSession soft-deletes (recycle bin) and notifies backend', () => {
    const t = new FakeTransport()
    const svc = new SessionService(t)
    const id = svc.createSession()
    svc.deleteSession(id, { reason: 'user' })
    expect(useDomainStore.getState().sessions.some((s) => s.id === id)).toBe(false)
    expect(t.sent.at(-1)).toMatchObject({
      type: 'session:softDelete',
      sessionId: id,
      reason: 'user',
    })
  })

  it('deleteSession defaults reason to unknown when omitted', () => {
    const t = new FakeTransport()
    const svc = new SessionService(t)
    const id = svc.createSession()
    svc.deleteSession(id)
    expect(t.sent.at(-1)).toMatchObject({
      type: 'session:softDelete',
      sessionId: id,
      reason: 'unknown',
    })
  })

  it('hardDeleteSession permanently removes via session:delete', () => {
    const t = new FakeTransport()
    const svc = new SessionService(t)
    const id = svc.createSession()
    svc.hardDeleteSession(id, { reason: 'trash-permanent' })
    expect(t.sent.at(-1)).toMatchObject({
      type: 'session:delete',
      sessionId: id,
      reason: 'trash-permanent',
    })
  })


  it('session:list:result prunes stale surface pointers and stays on New Conversation', () => {
    const t = new FakeTransport()
    new SessionService(t)
    useDomainStore.setState({ sessions: [], activeSessionId: null })
    useUiStore.setState({
      activeView: 'chat',
      chatSessionId: 'gone',
      codeSessionId: 'keep-code',
    })

    t.push({
      type: 'session:list:result',
      sessions: [
        { id: 'keep-chat', title: 'Chat', preview: '', updatedAt: 2, messageCount: 1, surface: 'chat' },
        { id: 'keep-code', title: 'Code', preview: '', updatedAt: 1, messageCount: 1, surface: 'code' },
      ],
    })

    expect(useUiStore.getState().chatSessionId).toBeNull()
    expect(useUiStore.getState().codeSessionId).toBe('keep-code')
    expect(useDomainStore.getState().activeSessionId).toBeNull()
    expect(useUiStore.getState().activeView).toBe('chat')
  })

  it('session:list:result keeps an already-active session while pruning surface pointers', () => {
    const t = new FakeTransport()
    new SessionService(t)
    useDomainStore.setState({
      sessions: [{
        id: 'live',
        config: { ...DEFAULT_CONFIG, surface: 'chat' },
        title: 'Live',
        preview: '',
        updatedAtMs: 1,
        loaded: true,
        messages: [],
        status: 'idle',
        error: null,
      }],
      activeSessionId: 'live',
    })
    useUiStore.setState({
      activeView: 'chat',
      chatSessionId: 'live',
      codeSessionId: 'stale',
    })

    t.push({
      type: 'session:list:result',
      sessions: [
        { id: 'live', title: 'Live', preview: '', updatedAt: 1, messageCount: 1, surface: 'chat' },
        { id: 'other', title: 'Other', preview: '', updatedAt: 0, messageCount: 0, surface: 'chat' },
      ],
    })

    expect(useDomainStore.getState().activeSessionId).toBe('live')
    expect(useUiStore.getState().chatSessionId).toBe('live')
    expect(useUiStore.getState().codeSessionId).toBeNull()
  })

  it('session:list:result forces knowledge/settings/history back to chat New Conversation', () => {
    const t = new FakeTransport()
    new SessionService(t)
    useDomainStore.setState({ sessions: [], activeSessionId: null })
    useUiStore.setState({
      activeView: 'knowledge',
      chatSessionId: 'keep-chat',
    })

    t.push({
      type: 'session:list:result',
      sessions: [
        { id: 'keep-chat', title: 'Chat', preview: '', updatedAt: 2, messageCount: 1, surface: 'chat' },
      ],
    })

    expect(useDomainStore.getState().activeSessionId).toBeNull()
    expect(useUiStore.getState().activeView).toBe('chat')
    expect(useUiStore.getState().sidebarSection).toBe('chats')
  })

  it('session:list:result marks automation sessionListReady and invokes recoverOrphanRuns', async () => {
    const {
      useAutomationStore,
      __resetAutomationStoreInternalsForTests,
    } = await import('@/store/automationStore')
    __resetAutomationStoreInternalsForTests()
    const mark = vi.fn(() => {
      useAutomationStore.setState({ sessionListReady: true })
    })
    const recover = vi.fn().mockResolvedValue(undefined)
    useAutomationStore.setState({
      markSessionListReady: mark,
      recoverOrphanRuns: recover,
    })

    const t = new FakeTransport()
    new SessionService(t)
    t.push({
      type: 'session:list:result',
      sessions: [
        { id: 'keep-chat', title: 'Chat', preview: '', updatedAt: 2, messageCount: 1, surface: 'chat' },
      ],
    })

    await vi.waitFor(() => {
      expect(mark).toHaveBeenCalledTimes(1)
      expect(recover).toHaveBeenCalledTimes(1)
    })
    __resetAutomationStoreInternalsForTests()
  })

  it('previewSurface changes activeView without restoring a remembered session', () => {
    const svc = new SessionService(new FakeTransport())
    const id = svc.createSession({ ...DEFAULT_CONFIG, surface: 'chat' })
    useUiStore.setState({ chatSessionId: id, activeView: 'chat' })
    useDomainStore.getState().deselect()

    svc.previewSurface('code')
    expect(useUiStore.getState().activeView).toBe('code')
    expect(useDomainStore.getState().activeSessionId).toBeNull()
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

  it('clearProjectDir clears cwd and sends empty session:setCwd', () => {
    const t = new FakeTransport()
    useDomainStore.setState({
      sessions: [
        {
          ...useDomainStore.getState().sessions[0],
          config: { ...useDomainStore.getState().sessions[0].config, cwd: '/proj' },
        },
      ],
    })
    new SessionService(t).clearProjectDir('s1')
    expect(useDomainStore.getState().sessions[0].config.cwd).toBeUndefined()
    expect(t.sent.at(-1)).toMatchObject({ type: 'session:setCwd', sessionId: 's1', cwd: '' })
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

  it('setForcePlan optimistically sets config and sends session:setForcePlan', () => {
    const t = new FakeTransport()
    useDomainStore.setState({ sessions: [{ id: 's1', config: { llmProvider: 'deepseek', model: 'm', tools: [] }, title: '', preview: '', updatedAtMs: 0, loaded: true, messages: [], status: 'idle', error: null, interrupt: null, activeTurnPlan: null, planDeltaDraft: {}, planApprovalPending: false, codePanelOpen: false, chatPanelOpen: false }], activeSessionId: 's1' } as never)
    new SessionService(t).setForcePlan('s1', true)
    expect(useDomainStore.getState().sessions[0].config.forcePlan).toBe(true)
    expect(t.sent.at(-1)).toMatchObject({ type: 'session:setForcePlan', sessionId: 's1', forcePlan: true })
  })

  it('setPermissionMode optimistically sets config and sends session:setPermissionMode', () => {
    const t = new FakeTransport()
    new SessionService(t).setPermissionMode('s1', 'full')
    expect(useDomainStore.getState().sessions[0].config.permissionMode).toBe('full')
    expect(t.sent.at(-1)).toMatchObject({ type: 'session:setPermissionMode', sessionId: 's1', permissionMode: 'full' })
  })

  it('setAgent sends session:setAgent without optimistic config write', () => {
    const t = new FakeTransport()
    useDomainStore.getState().sessions[0].config.agentId = undefined
    new SessionService(t).setAgent('s1', 'opencode')
    expect(useDomainStore.getState().sessions[0].config.agentId).toBeUndefined()
    expect(t.sent.at(-1)).toMatchObject({ type: 'session:setAgent', sessionId: 's1', agentId: 'opencode' })
  })

  it('session:agentChanged from wire updates session agentId', () => {
    const t = new FakeTransport()
    new SessionService(t)
    t.push({ type: 'session:agentChanged', sessionId: 's1', agentId: 'grok' })
    expect(useDomainStore.getState().sessions[0].config.agentId).toBe('grok')
    t.push({ type: 'session:agentChanged', sessionId: 's1', agentId: null })
    expect(useDomainStore.getState().sessions[0].config.agentId).toBeUndefined()
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

  it('newConversation ensures a fresh draft and deselects the active session', () => {
    useDomainStore.setState({ activeSessionId: 's1' })
    useDraftStore.setState({ draft: { tempId: 'd1', mode: 'chat', text: '/stale' } })
    const t = new FakeTransport()
    new SessionService(t).newConversation()
    expect(useDomainStore.getState().activeSessionId).toBeNull()
    expect(useDraftStore.getState().draft).not.toBeNull()
    expect(useDraftStore.getState().draft?.text).toBe('')
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

  it('KD-8: planApprovalPending send defaults to plan:respond amend (not resume)', () => {
    const t = new FakeTransport()
    const svc = new SessionService(t)
    svc.seedPlanApproval('s1')
    useDomainStore.setState({ activeSessionId: 's1' })
    useHipConfigStore.setState({ config: { version: 1 }, loaded: true, error: null })
    svc.sendMessage('please revise step 2')
    // FE-only seed completes amend locally (no wire plan:respond); still not resume.
    expect(t.sent.some((m) => m.type === 'message:resume')).toBe(false)
    expect(t.sent.some((m) => m.type === 'plan:respond')).toBe(false)
    const sess = useDomainStore.getState().sessions.find((s) => s.id === 's1')!
    expect(sess.planApprovalPending).toBe(false)
    expect(sess.status).toBe('running')
  })

  it('KD-PA-1: softApproveOnComposer is ignored; pending send still amends (never resume)', () => {
    const t = new FakeTransport()
    const svc = new SessionService(t)
    svc.seedPlanApproval('s1')
    useDomainStore.setState({ activeSessionId: 's1' })
    useHipConfigStore.setState({
      config: { version: 1, plan: { softApproveOnComposer: true } },
      loaded: true,
      error: null,
    })
    svc.sendMessage('go ahead with proxy 127.0.0.1:7890')
    // Deprecated flag must not soft-approve via message:resume.
    expect(t.sent.some((m) => m.type === 'message:resume')).toBe(false)
    // FE-only seed completes amend locally (no wire plan:respond).
    expect(t.sent.some((m) => m.type === 'plan:respond')).toBe(false)
    const sess = useDomainStore.getState().sessions.find((s) => s.id === 's1')!
    expect(sess.planApprovalPending).toBe(false)
    expect(sess.status).toBe('running')
  })

  it('resume forwards attachments and does not require text', () => {
    const t = new FakeTransport()
    const svc = new SessionService(t)
    useDomainStore.setState({ sessions: [{ ...useDomainStore.getState().sessions[0], interrupt: { turnId: 't1', question: 'q' } }] })
    const attachments = [{ id: 'a1', name: 'diagram.png', mimeType: 'image/png', path: '/tmp/diagram.png' }]
    svc.resume('   ', attachments)
    expect(t.sent.at(-1)).toMatchObject({ type: 'message:resume', sessionId: 's1', content: '', attachments })
    expect(useDomainStore.getState().sessions[0].messages.at(-1)).toMatchObject({ role: 'user', content: '', attachments })
  })

  it('resume ignores empty text with no attachments', () => {
    const t = new FakeTransport()
    const svc = new SessionService(t)
    useDomainStore.setState({ sessions: [{ ...useDomainStore.getState().sessions[0], interrupt: { turnId: 't1', question: 'q' } }] })
    svc.resume('   ')
    expect(t.sent).toHaveLength(0)
  })

  it('regenerate sends message:regenerate when an interrupt is pending (user retries paused turn)', () => {
    const t = new FakeTransport()
    const svc = new SessionService(t)
    useDomainStore.setState({ sessions: [{ ...useDomainStore.getState().sessions[0], status: 'running', interrupt: { turnId: 't1', question: 'q' } }] })
    svc.regenerate()
    expect(t.sent.some((m) => m.type === 'message:regenerate')).toBe(true)
    expect(useDomainStore.getState().sessions[0].status).toBe('running') // regenerateLastTurn sets running
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

  it('sendMessage with an image does not switch the draft model', () => {
    useDomainStore.setState({ activeSessionId: null })
    useDraftStore.setState({ draft: { tempId: 'd1', mode: 'chat', text: '', modelKey: 'deepseek/deepseek-v4-flash' } })
    const t = new FakeTransport()
    const svc = new SessionService(t)
    const attachments = [{ id: 'a1', name: 'image.png', mimeType: 'image/png', path: '/tmp/image.png' }]
    svc.sendMessage('describe', attachments)
    expect(t.sent.some((m) => m.type === 'session:setModel')).toBe(false)
    expect(t.sent.some((m) => m.type === 'session:create' && m.config.model === 'deepseek-v4-flash')).toBe(true)
    expect(t.sent.at(-1)).toMatchObject({ type: 'message:send', content: 'describe', attachments })
  })

  it('sendMessage with an image does not switch the active session model', () => {
    useDomainStore.setState({
      sessions: [{ id: 's1', config: { llmProvider: 'deepseek', model: 'deepseek-v4-flash', tools: [], surface: 'chat' }, title: 'T', preview: 'P', updatedAtMs: 0, loaded: true, messages: [], status: 'idle', error: null }],
      activeSessionId: 's1',
    })
    const t = new FakeTransport()
    const svc = new SessionService(t)
    const attachments = [{ id: 'a1', name: 'image.png', mimeType: 'image/png', path: '/tmp/image.png' }]
    svc.sendMessage('describe', attachments)
    expect(t.sent.some((m) => m.type === 'session:setModel')).toBe(false)
    expect(t.sent.at(-1)).toMatchObject({ type: 'message:send', content: 'describe', attachments })
  })

  it('regenerate does not switch model when the session history contains an image', () => {
    useDomainStore.setState({
      sessions: [{
        id: 's1',
        config: { llmProvider: 'deepseek', model: 'deepseek-v4-flash', tools: [] },
        title: 'T',
        preview: 'P',
        updatedAtMs: 0,
        loaded: true,
        messages: [
          { id: 'u1', role: 'user', content: 'what is this', timestamp: 0, attachments: [{ id: 'a1', name: 'image.png', mimeType: 'image/png' }] },
          { id: 'a1', role: 'assistant', content: 'ans', timestamp: 1 },
        ],
        status: 'idle',
        error: null,
      }],
      activeSessionId: 's1',
    })
    const t = new FakeTransport()
    const svc = new SessionService(t)
    svc.regenerate()
    expect(t.sent.some((m) => m.type === 'session:setModel')).toBe(false)
    expect(t.sent.some((m) => m.type === 'message:regenerate')).toBe(true)
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

  it('gitInitWorkspace sends fs:gitInit; an ok result chains a fresh fs:diff + checkpoint list', () => {
    const t = new FakeTransport()
    const svc = new SessionService(t)
    svc.gitInitWorkspace('s1')
    expect(t.sent.at(-1)).toMatchObject({ type: 'fs:gitInit', sessionId: 's1' })
    expect(useDiffStore.getState().bySession['s1'].initPending).toBe(true)
    t.push({ type: 'fs:gitInit:result', sessionId: 's1', ok: true })
    expect(useDiffStore.getState().bySession['s1'].initPending).toBe(false)
    expect(t.sent.slice(-2)).toEqual([
      expect.objectContaining({ type: 'fs:diff', sessionId: 's1' }),
      expect.objectContaining({ type: 'git:checkpoint:list', sessionId: 's1' }),
    ])
  })

  it('a failed fs:gitInit:result keeps not_a_repo with the error inline', () => {
    const t = new FakeTransport()
    new SessionService(t)
    t.push({ type: 'fs:gitInit:result', sessionId: 's1', ok: false, error: 'boom' })
    expect(useDiffStore.getState().bySession['s1']).toMatchObject({ state: 'not_a_repo', error: 'boom', initPending: false })
    expect(t.sent.filter((m) => m.type === 'fs:diff')).toHaveLength(0)
  })

  it('message:complete refreshes full diff on Code surface or when Changes tab is active', () => {
    const t = new FakeTransport()
    new SessionService(t)
    const message = { id: 'm1', role: 'assistant' as const, content: 'x', timestamp: 1 }
    // Chat surface + non-changes tab: summary/checkpoint only, no full fs:diff
    useUiStore.setState({ activeTab: 'files', activeView: 'chat' })
    t.push({ type: 'message:complete', sessionId: 's1', message })
    expect(t.sent.filter((m) => m.type === 'fs:diff')).toHaveLength(0)
    // Changes tab: full diff
    useUiStore.setState({ activeTab: 'changes', activeView: 'chat' })
    t.push({ type: 'message:complete', sessionId: 's2', message })
    expect(t.sent.filter((m) => m.type === 'fs:diff' && m.sessionId === 's2')).toHaveLength(1)
    // Code surface always refreshes full diff (Sprint B)
    useUiStore.setState({ activeTab: 'files', activeView: 'code' })
    t.push({ type: 'message:complete', sessionId: 's3', message })
    expect(t.sent.filter((m) => m.type === 'fs:diff' && m.sessionId === 's3')).toHaveLength(1)
  })

  it('simulateAgentWriteFinished seeds write_file and refreshes fs:diff on code surface', () => {
    vi.useFakeTimers()
    const t = new FakeTransport()
    const svc = new SessionService(t)
    useUiStore.setState({ activeTab: 'changes', activeView: 'code' })
    const ids = svc.simulateAgentWriteFinished('s1')
    expect(ids.callId).toMatch(/^e2e-write-/)
    const sess = useDomainStore.getState().sessions.find((s) => s.id === 's1')!
    const turn = sess.messages.find((m) => m.id === ids.turnId)
    expect(turn?.toolCalls?.[0]).toMatchObject({ name: 'write_file', callId: ids.callId, status: 'finished' })
    // Immediate requestDiff (E2E reliability) plus debounced summary/diff from tool:finished.
    expect(t.sent.some((m) => m.type === 'fs:diff' && m.sessionId === 's1')).toBe(true)
    vi.advanceTimersByTime(300)
    expect(t.sent.some((m) => m.type === 'fs:diffSummary' && m.sessionId === 's1')).toBe(true)
    vi.useRealTimers()
  })

  it('simulateTurnRunning then simulateTurnCancelled keeps partial assistant stopped', () => {
    const t = new FakeTransport()
    const svc = new SessionService(t)
    const { turnId } = svc.simulateTurnRunning('s1')
    let sess = useDomainStore.getState().sessions.find((s) => s.id === 's1')!
    expect(sess.status).toBe('running')
    expect(sess.messages.find((m) => m.id === turnId)?.content).toContain('partial e2e reply')
    svc.simulateTurnCancelled('s1')
    sess = useDomainStore.getState().sessions.find((s) => s.id === 's1')!
    expect(sess.status).toBe('idle')
    expect(sess.error).toBeNull()
    const turn = sess.messages.find((m) => m.id === turnId)
    expect(turn?.content).toContain('partial e2e reply')
    expect(turn?.stopped).toBe(true)
  })

  it('simulateSessionError surfaces error and getSessionDebugBundleJson redacts secrets', () => {
    const t = new FakeTransport()
    const svc = new SessionService(t)
    useDomainStore.setState({
      sessions: [
        {
          id: 's1',
          config: { ...DEFAULT_CONFIG, surface: 'chat', apiKey: 'sk-secret' } as typeof DEFAULT_CONFIG,
          title: 'T',
          preview: 'P',
          updatedAtMs: 0,
          loaded: true,
          messages: [{ id: 'u1', role: 'user', content: 'hi', timestamp: 1 }],
          status: 'idle',
          error: null,
        },
      ],
      activeSessionId: 's1',
      connection: 'connected',
    })
    svc.simulateSessionError('s1', 'AGENT_ERROR', 'boom')
    const sess = useDomainStore.getState().sessions.find((s) => s.id === 's1')!
    expect(sess.status).toBe('error')
    expect(sess.error).toMatchObject({ code: 'AGENT_ERROR', message: 'boom' })
    const json = svc.getSessionDebugBundleJson()
    expect(json).toBeTruthy()
    expect(json).toContain('"version": 3')
    expect(json).not.toContain('sk-secret')
    expect(json).toContain('AGENT_ERROR')
  })

  it('seedRoundtableCouncil adds five council seats and edges meta', () => {
    const t = new FakeTransport()
    const svc = new SessionService(t)
    useDomainStore.setState({
      sessions: [
        {
          id: 's1',
          config: { ...DEFAULT_CONFIG, surface: 'chat' },
          title: 't',
          preview: '',
          updatedAtMs: 0,
          loaded: true,
          messages: [],
          status: 'idle',
          error: null,
        },
      ],
      activeSessionId: 's1',
    })
    const { turnId } = svc.seedRoundtableCouncil('s1')
    const sess = useDomainStore.getState().sessions.find((s) => s.id === 's1')!
    const msg = sess.messages.find((m) => m.id === turnId)
    expect(msg?.roundtable?.engine).toBe('council')
    expect(msg?.roundtable?.edges?.length).toBeGreaterThanOrEqual(1)
    const runs = msg?.agentRuns ?? []
    expect(runs.some((r) => r.agentId === 'roundtable:strategist')).toBe(true)
    expect(runs.filter((r) => r.agentId.startsWith('roundtable:')).length).toBe(5)
  })

  it('seedAgentCollaboration adds supervisor and coder runs with tool', () => {
    const t = new FakeTransport()
    const svc = new SessionService(t)
    const { turnId, callId } = svc.seedAgentCollaboration('s1')
    const sess = useDomainStore.getState().sessions.find((s) => s.id === 's1')!
    expect(sess.status).toBe('running')
    const turn = sess.messages.find((m) => m.id === turnId)!
    expect(turn.agentRuns?.map((r) => r.agentId).sort()).toEqual(['coder-1', 'supervisor'])
    expect(turn.toolCalls?.[0]).toMatchObject({ callId, name: 'read_file', status: 'running' })
  })

  it('simulatePermissionRequest sets pendingPermission', () => {
    const t = new FakeTransport()
    const svc = new SessionService(t)
    const { requestId } = svc.simulatePermissionRequest('s1')
    const sess = useDomainStore.getState().sessions.find((s) => s.id === 's1')!
    expect(sess.pendingPermission?.requestId).toBe(requestId)
    expect(sess.pendingPermission?.tool.title).toBe('e2e-run-script')
    expect(sess.pendingPermission?.options).toHaveLength(2)
  })

  it('seedSubagentPause projects marker without Error: sub-agent paused prefix', () => {
    const t = new FakeTransport()
    const svc = new SessionService(t)
    const { turnId, callId, marker } = svc.seedSubagentPause('s1')
    expect(marker).toBe('[hip:subagent_paused]')
    const sess = useDomainStore.getState().sessions.find((s) => s.id === 's1')!
    const turn = sess.messages.find((m) => m.id === turnId)!
    expect(turn.agentRuns?.map((r) => r.agentId).sort()).toEqual(['coder-1', 'supervisor'])
    const task = turn.toolCalls?.find((tc) => tc.callId === callId)
    expect(task).toMatchObject({ name: 'task', status: 'finished' })
    expect(task?.output).toMatch(/^\[hip:subagent_paused\]/)
    expect(task?.output).not.toMatch(/^Error:\s*sub-agent paused/i)
    expect(svc.getLastAssistantText('s1')).toContain('[hip:subagent_paused]')
  })

  it('seedAgentInterrupt sets session.interrupt', () => {
    const t = new FakeTransport()
    const svc = new SessionService(t)
    const { turnId } = svc.seedAgentInterrupt('s1', 'e2e question?')
    const sess = useDomainStore.getState().sessions.find((s) => s.id === 's1')!
    expect(sess.interrupt).toEqual({ turnId, question: 'e2e question?', context: undefined })
    expect(svc.getPendingInterrupt('s1')).toEqual({ turnId, question: 'e2e question?' })
  })

  it('seedPlanApproval sets planApprovalPending and activeTurnPlan', () => {
    const t = new FakeTransport()
    const svc = new SessionService(t)
    const { planItems, markdown } = svc.seedPlanApproval('s1')
    const sess = useDomainStore.getState().sessions.find((s) => s.id === 's1')!
    expect(sess.planApprovalPending).toBe(true)
    expect(sess.activeTurnPlan).toEqual(planItems)
    expect(sess.interrupt?.question).toBe('plan_approval')
    expect(sess.activeTurnPlanMarkdown).toBe(markdown)
    expect(sess.activeTurnPlanMarkdown).toContain('E2E plan')
    expect(sess.activeTurnPlanPath).toContain('s1.md')
  })

  it('seedPlanProgress sets activeTurnPlan without approval', () => {
    const t = new FakeTransport()
    const svc = new SessionService(t)
    const { planItems } = svc.seedPlanProgress('s1')
    const sess = useDomainStore.getState().sessions.find((s) => s.id === 's1')!
    expect(sess.planApprovalPending).toBeFalsy()
    expect(sess.activeTurnPlan).toEqual(planItems)
    expect(sess.status).toBe('running')
    expect(sess.interrupt).toBeFalsy()
  })

  it('seedPlanProgress complete retains activeTurnPlan after message:complete', () => {
    const t = new FakeTransport()
    const svc = new SessionService(t)
    const { planItems } = svc.seedPlanProgress('s1', { complete: true })
    const sess = useDomainStore.getState().sessions.find((s) => s.id === 's1')!
    expect(sess.status).toBe('idle')
    expect(sess.activeTurnPlan).toEqual(planItems)
    // Seed path never sets pending; KD-7 (complete preserves prior true) is covered in sessionStore.test.ts.
    expect(sess.planApprovalPending).toBeFalsy()
  })

  it('message:complete preserves prior planApprovalPending true (KD-7 harness)', () => {
    const t = new FakeTransport()
    const svc = new SessionService(t)
    svc.seedPlanApproval('s1')
    useDomainStore.setState({ activeSessionId: 's1' })
    const before = useDomainStore.getState().sessions.find((s) => s.id === 's1')!
    expect(before.planApprovalPending).toBe(true)
    const plan = before.activeTurnPlan
    useDomainStore.getState().apply({
      type: 'message:complete',
      sessionId: 's1',
      message: { id: 'm-complete', role: 'assistant', content: 'ready', timestamp: Date.now(), stopped: true },
    })
    const after = useDomainStore.getState().sessions.find((s) => s.id === 's1')!
    expect(after.planApprovalPending).toBe(true)
    expect(after.activeTurnPlan).toEqual(plan)
    expect(after.status).toBe('idle')
  })


  it('respondPlan on seedPlanApproval completes FE-only (no wire plan:respond)', () => {
    const t = new FakeTransport()
    const svc = new SessionService(t)
    svc.seedPlanApproval('s1')
    useDomainStore.setState({ activeSessionId: 's1' })
    const beforeSent = t.sent.length
    svc.respondPlan('approve')
    const sess = useDomainStore.getState().sessions.find((s) => s.id === 's1')!
    expect(sess.planApprovalPending).toBe(false)
    expect(sess.interrupt).toBeNull()
    expect(sess.status).toBe('running')
    expect(sess.planRespondRollback).toBeNull()
    // FE-only seed must not hit sidecar (would not_awaiting → KD-16 re-show card).
    expect(t.sent.slice(beforeSent).some((m) => m.type === 'plan:respond')).toBe(false)
  })

  it('respondPlan is idempotent after optimistic dismiss', () => {
    const t = new FakeTransport()
    const svc = new SessionService(t)
    svc.seedPlanApproval('s1')
    useDomainStore.setState({ activeSessionId: 's1' })
    svc.respondPlan('approve')
    const n = t.sent.length
    svc.respondPlan('approve')
    expect(t.sent.length).toBe(n)
  })

  it('respondPlan reject on seedPlanApproval sets status idle (FE-only)', () => {
    const t = new FakeTransport()
    const svc = new SessionService(t)
    svc.seedPlanApproval('s1')
    useDomainStore.setState({ activeSessionId: 's1' })
    svc.respondPlan('reject')
    const sess = useDomainStore.getState().sessions.find((s) => s.id === 's1')!
    expect(sess.planApprovalPending).toBe(false)
    expect(sess.status).toBe('idle')
    expect(t.sent.some((m) => m.type === 'plan:respond')).toBe(false)
  })

  it('KD-16: plan:respond:result ok:false restores planApprovalPending and interrupt', () => {
    const t = new FakeTransport()
    const svc = new SessionService(t)
    // Real wire path (not seedPlanApproval FE-only): seed pending manually then send.
    useDomainStore.setState({
      sessions: [
        {
          id: 's1',
          config: { surface: 'chat', llmProvider: 'openai', model: 'gpt-4o', tools: [] },
          title: '',
          preview: '',
          updatedAtMs: 0,
          loaded: true,
          messages: [],
          status: 'idle',
          error: null,
          planApprovalPending: true,
          activeTurnPlan: [{ content: 'step', status: 'pending' }],
          interrupt: {
            turnId: 'turn-real',
            question: 'Approve this plan?',
            context: JSON.stringify({ kind: 'plan_approval' }),
          },
        },
      ],
      activeSessionId: 's1',
    })
    const before = useDomainStore.getState().sessions.find((s) => s.id === 's1')!
    expect(before.planApprovalPending).toBe(true)
    expect(before.interrupt?.turnId).toBe('turn-real')

    svc.respondPlan('approve')
    const mid = useDomainStore.getState().sessions.find((s) => s.id === 's1')!
    expect(mid.planApprovalPending).toBe(false)
    expect(mid.interrupt).toBeNull()
    expect(mid.planRespondRollback?.interrupt?.turnId).toBe('turn-real')
    expect(t.sent.at(-1)).toMatchObject({ type: 'plan:respond', sessionId: 's1', action: 'approve' })

    t.push({
      type: 'plan:respond:result',
      sessionId: 's1',
      ok: false,
      action: 'approve',
      reason: 'not_awaiting',
    })
    const after = useDomainStore.getState().sessions.find((s) => s.id === 's1')!
    expect(after.planApprovalPending).toBe(true)
    expect(after.interrupt?.turnId).toBe('turn-real')
    expect(after.interrupt?.question).toContain('Approve')
    expect(after.status).toBe('idle')
    expect(after.planRespondRollback).toBeNull()
  })

  it('KD-16: plan:respond:result ok:true clears rollback stash (wire path)', () => {
    const t = new FakeTransport()
    const svc = new SessionService(t)
    useDomainStore.setState({
      sessions: [
        {
          id: 's1',
          config: { surface: 'chat', llmProvider: 'openai', model: 'gpt-4o', tools: [] },
          title: '',
          preview: '',
          updatedAtMs: 0,
          loaded: true,
          messages: [],
          status: 'idle',
          error: null,
          planApprovalPending: true,
          activeTurnPlan: [{ content: 'step', status: 'pending' }],
          interrupt: {
            turnId: 'turn-real',
            question: 'Approve this plan?',
            context: JSON.stringify({ kind: 'plan_approval' }),
          },
        },
      ],
      activeSessionId: 's1',
    })
    svc.respondPlan('approve')
    expect(useDomainStore.getState().sessions.find((s) => s.id === 's1')!.planRespondRollback).toBeTruthy()
    t.push({
      type: 'plan:respond:result',
      sessionId: 's1',
      ok: true,
      action: 'approve',
    })
    const sess = useDomainStore.getState().sessions.find((s) => s.id === 's1')!
    expect(sess.planRespondRollback).toBeNull()
    expect(sess.planApprovalPending).toBe(false)
  })

  it('seedBackgroundTaskKilled appends synthetic killed notification', () => {
    const t = new FakeTransport()
    const svc = new SessionService(t)
    const { taskId, turnId } = svc.seedBackgroundTaskKilled('s1')
    const sess = useDomainStore.getState().sessions.find((s) => s.id === 's1')!
    const msg = sess.messages.find((m) => m.id === turnId)
    expect(msg?.role).toBe('notice')
    expect(msg?.content).toContain('killed')
    expect(msg?.content).toContain('e2e background job')
    expect(msg?.id).toMatch(new RegExp(`^notif-${taskId}-killed-`))
    expect(turnId).toBe(msg?.id)
  })

  it('simulateInvalidWorkflowError sets INVALID_WORKFLOW error', () => {
    const t = new FakeTransport()
    const svc = new SessionService(t)
    svc.simulateInvalidWorkflowError('s1', 'tool nodes rejected')
    const sess = useDomainStore.getState().sessions.find((s) => s.id === 's1')!
    expect(sess.status).toBe('error')
    expect(sess.error).toMatchObject({ code: 'INVALID_WORKFLOW', message: 'tool nodes rejected' })
  })

  it('seedCheckpoints folds isGitRepo and rows into diffStore', () => {
    const t = new FakeTransport()
    const svc = new SessionService(t)
    const { count } = svc.seedCheckpoints('s1')
    expect(count).toBe(2)
    const slice = useDiffStore.getState().bySession['s1']
    expect(slice.isGitRepo).toBe(true)
    expect(slice.checkpoints).toHaveLength(2)
    expect(slice.currentBranch).toBe('main')
  })

  it('seedCheckpoints survives requestCheckpoints and empty list:result', () => {
    const t = new FakeTransport()
    const svc = new SessionService(t)
    svc.seedCheckpoints('s1')
    svc.requestCheckpoints('s1')
    expect(t.sent.filter((m) => m.type === 'git:checkpoint:list')).toHaveLength(0)
    expect(useDiffStore.getState().bySession['s1'].checkpoints).toHaveLength(2)
    t.push({
      type: 'git:checkpoint:list:result',
      sessionId: 's1',
      checkpoints: [],
      isGitRepo: true,
      currentBranch: 'main',
    })
    expect(useDiffStore.getState().bySession['s1'].checkpoints).toHaveLength(2)
  })

  it('revertCheckpoint auto-succeeds when e2e checkpoint seed is pinned', async () => {
    const t = new FakeTransport()
    const svc = new SessionService(t)
    svc.seedCheckpoints('s1')
    svc.revertCheckpoint('s1', 's1:t1')
    expect(t.sent.filter((m) => m.type === 'git:revert')).toHaveLength(0)
    await Promise.resolve() // flush queueMicrotask
    const slice = useDiffStore.getState().bySession['s1']
    expect(slice.lastRevertResult).toMatchObject({
      checkpointId: 's1:t1',
      ok: true,
      safetyCheckpointId: 's1:t1:e2e-safety',
    })
  })

  it('openCommandPaletteForE2e toggles command palette store', async () => {
    const { useCommandPaletteStore } = await import('@/store/commandPaletteStore')
    useCommandPaletteStore.setState({ open: false, page: null })
    const t = new FakeTransport()
    const svc = new SessionService(t)
    svc.openCommandPaletteForE2e()
    expect(useCommandPaletteStore.getState().open).toBe(true)
    svc.closeCommandPaletteForE2e()
    expect(useCommandPaletteStore.getState().open).toBe(false)
  })

  it('openSettingsPageForE2e sets activeView settings and settingsPage', () => {
    useUiStore.setState({ activeView: 'chat', settingsPage: 'general' })
    const t = new FakeTransport()
    const svc = new SessionService(t)
    svc.openSettingsPageForE2e('memory')
    expect(useUiStore.getState().activeView).toBe('settings')
    expect(useUiStore.getState().settingsPage).toBe('memory')
  })

  it('openHistoryPageForE2e sets overlay history without activeView change', () => {
    useUiStore.setState({ activeView: 'chat', overlay: null })
    const t = new FakeTransport()
    const svc = new SessionService(t)
    svc.openHistoryPageForE2e()
    expect(useUiStore.getState().overlay).toBe('history')
    expect(useUiStore.getState().activeView).toBe('chat')
  })

  it('openTrashPageForE2e sets overlay trash and requests trash list', () => {
    useUiStore.setState({ activeView: 'chat', overlay: null })
    const t = new FakeTransport()
    const svc = new SessionService(t)
    svc.openTrashPageForE2e()
    expect(useUiStore.getState().overlay).toBe('trash')
    expect(useUiStore.getState().activeView).toBe('chat')
    expect(t.sent.some((m) => (m as { type: string }).type === 'session:trash:list')).toBe(true)
  })

  it('closeOverlayForE2e clears overlay', () => {
    useUiStore.setState({ overlay: 'history' })
    const t = new FakeTransport()
    const svc = new SessionService(t)
    svc.closeOverlayForE2e()
    expect(useUiStore.getState().overlay).toBeNull()
  })

  it('simulatePluginInstallError sets pluginInstall result failure', () => {
    const t = new FakeTransport()
    const svc = new SessionService(t)
    svc.simulatePluginInstallError('structure bad')
    expect(useDomainStore.getState().pluginInstall).toMatchObject({
      status: 'error',
      result: { ok: false, error: 'structure bad' },
    })
  })

  it('inject workflow messages project via getWorkflowSession (e2e store path)', async () => {
    const { useWorkflowStore } = await import('@/store/workflowStore')
    useWorkflowStore.setState({ bySession: {} })
    const t = new FakeTransport()
    const svc = new SessionService(t)
    const def = {
      id: 'wf-unit',
      name: 'Unit WF',
      nodes: [{ id: 'n1', type: 'agent' as const, agentId: 'coder', inputTemplate: 'x' }],
      edges: [] as { from: string; to: string }[],
      entry: ['n1'],
    }
    svc.injectServerMessage({
      type: 'workflow:started',
      sessionId: 's1',
      runId: 'r1',
      def,
    })
    expect(svc.getWorkflowSession('s1')).toMatchObject({
      activeWorkflow: { id: 'wf-unit', name: 'Unit WF' },
      runId: 'r1',
      runStatus: 'pending',
    })
    svc.injectServerMessage({
      type: 'workflow:event',
      sessionId: 's1',
      runId: 'r1',
      event: { type: 'run:started' },
    })
    svc.injectServerMessage({
      type: 'workflow:event',
      sessionId: 's1',
      runId: 'r1',
      event: { type: 'node:started', nodeId: 'n1' },
    })
    expect(svc.getWorkflowSession('s1')).toMatchObject({
      runStatus: 'running',
      nodeStatuses: { n1: 'running' },
    })
    svc.injectServerMessage({ type: 'workflow:cleared', sessionId: 's1' })
    expect(svc.getWorkflowSession('s1')).toMatchObject({
      activeWorkflow: null,
      runId: null,
      runStatus: null,
    })
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

  it('deleteSession clears terminal ring for that session', async () => {
    const { useTerminalStore } = await import('@/store/terminalStore')
    useTerminalStore.setState({ bySession: {}, attachedSessionId: null, attachedTerminalId: null })
    useTerminalStore.getState().appendRing('s1', 'out')
    const t = new FakeTransport()
    new SessionService(t).deleteSession('s1')
    expect(useTerminalStore.getState().bySession.s1).toBeUndefined()
  })

  it('setProjectDir clears terminal ring for that session', async () => {
    const { useTerminalStore } = await import('@/store/terminalStore')
    useTerminalStore.setState({ bySession: {}, attachedSessionId: null, attachedTerminalId: null })
    useTerminalStore.getState().appendRing('s1', 'out')
    const t = new FakeTransport()
    new SessionService(t).setProjectDir('s1', '/tmp/other')
    expect(useTerminalStore.getState().bySession.s1).toBeUndefined()
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

  it('session:cwd result refreshes the checkpoint list and diff summary', () => {
    const t = new FakeTransport(); new SessionService(t)
    t.push({ type: 'session:cwd', sessionId: 's1', cwd: '/proj' })
    expect(t.sent.some((m) => m.type === 'git:checkpoint:list' && m.sessionId === 's1')).toBe(true)
    expect(t.sent.some((m) => m.type === 'fs:diffSummary' && m.sessionId === 's1')).toBe(true)
  })

  it('session:created refreshes the checkpoint list and diff summary', () => {
    const t = new FakeTransport(); new SessionService(t)
    t.push({ type: 'session:created', sessionId: 's1' })
    expect(t.sent.some((m) => m.type === 'git:checkpoint:list' && m.sessionId === 's1')).toBe(true)
    expect(t.sent.some((m) => m.type === 'fs:diffSummary' && m.sessionId === 's1')).toBe(true)
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
    expect(useDiffStore.getState().bySession['s1'].lastRevertResult).toMatchObject({
      checkpointId: 's1:t1',
      ok: true,
      safetyCheckpointId: 's1:pre-revert-1',
    })
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
    expect(useDiffStore.getState().bySession['s1'].lastRevertResult).toMatchObject({
      checkpointId: 's1:t1',
      ok: false,
    })
    // no refresh requests fire on a failed revert
    expect(t.sent.some((m) => m.type === 'git:checkpoint:list' && m.sessionId === 's1')).toBe(false)
  })

  describe('testProvider', () => {
    it('sends config:testProvider and resolves matching requestId', async () => {
      const t = new FakeTransport()
      const svc = new SessionService(t)
      const p = svc.testProvider({
        purpose: 'chat',
        providerID: 'deepseek',
        baseURL: 'https://api.deepseek.com/v1',
      })
      const sent = t.sent.at(-1) as {
        type: string
        requestId: string
        purpose: string
        providerID: string
      }
      expect(sent.type).toBe('config:testProvider')
      expect(sent.purpose).toBe('chat')
      expect(sent.providerID).toBe('deepseek')
      t.push({
        type: 'config:testProvider:result',
        requestId: sent.requestId,
        ok: true,
        code: 'OK',
        message: 'Key works',
        checkedAt: 1,
        latencyMs: 12,
      })
      await expect(p).resolves.toMatchObject({ ok: true, code: 'OK', latencyMs: 12 })
    })

    it('correlates concurrent probes by requestId (out of order)', async () => {
      const t = new FakeTransport()
      const svc = new SessionService(t)
      const p1 = svc.testProvider({ purpose: 'chat', providerID: 'a', baseURL: 'https://a' })
      const p2 = svc.testProvider({ purpose: 'chat', providerID: 'b', baseURL: 'https://b' })
      const id1 = (t.sent[t.sent.length - 2] as { requestId: string }).requestId
      const id2 = (t.sent[t.sent.length - 1] as { requestId: string }).requestId
      // Resolve second first
      t.push({
        type: 'config:testProvider:result',
        requestId: id2,
        ok: false,
        code: 'AUTH_FAILED',
        message: 'no',
        checkedAt: 2,
      })
      t.push({
        type: 'config:testProvider:result',
        requestId: id1,
        ok: true,
        code: 'OK',
        message: 'yes',
        checkedAt: 1,
      })
      await expect(p1).resolves.toMatchObject({ ok: true, code: 'OK' })
      await expect(p2).resolves.toMatchObject({ ok: false, code: 'AUTH_FAILED' })
    })
  })

  describe('worktree create path (G9 / D23 / D26)', () => {
    it('waitCreateWorktree sends reveal and hydrates list on success', async () => {
      const t = new FakeTransport()
      const svc = new SessionService(t)
      const p = svc.waitCreateWorktree('s1', {
        branch: 'hip-iso-abc',
        createBranch: true,
        pathKey: 'hip-iso-abc',
        reveal: true,
        source: 'protocol',
        label: 'My iso',
      })
      const createMsg = t.sent.find((m) => m.type === 'git:worktree:create') as {
        type: string
        sessionId: string
        branch: string
        reveal?: boolean
        createBranch?: boolean
        pathKey?: string
        source?: string
        label?: string
      }
      expect(createMsg).toMatchObject({
        type: 'git:worktree:create',
        sessionId: 's1',
        branch: 'hip-iso-abc',
        createBranch: true,
        pathKey: 'hip-iso-abc',
        reveal: true,
        source: 'protocol',
        label: 'My iso',
      })
      t.push({
        type: 'git:worktree:create:result',
        sessionId: 's1',
        ok: true,
        path: '/tmp/wt/hip-iso-abc',
        id: 'wtid1',
      })
      await expect(p).resolves.toEqual({
        ok: true,
        path: '/tmp/wt/hip-iso-abc',
        id: 'wtid1',
      })
      expect(t.sent.some((m) => m.type === 'git:worktree:list' && (m as { sessionId: string }).sessionId === 's1')).toBe(
        true,
      )
    })

    it('createManagedWorktree defaults reveal true, source protocol, and does not toast (opens session)', async () => {
      const t = new FakeTransport()
      const svc = new SessionService(t)
      // D23: success toast is effects-owned when reveal true — method must not toast.
      const toastSuccess = vi.spyOn(toast, 'success').mockImplementation(() => '')
      const toastMessage = vi.spyOn(toast, 'message').mockImplementation(() => '')
      // Host session with code cwd so create can open a child session.
      useDomainStore.setState({
        sessions: [
          {
            id: 'host1',
            config: { ...DEFAULT_CONFIG, surface: 'code', cwd: '/repo' },
            title: 'Host',
            preview: '',
            updatedAtMs: 0,
            loaded: true,
            messages: [],
            status: 'idle',
            error: null,
          },
        ],
        activeSessionId: 'host1',
        connection: 'disconnected',
      })
      const p = svc.createManagedWorktree({
        hostSessionId: 'host1',
        branch: 'hip-iso-xyz',
      })
      const createMsg = t.sent.find((m) => m.type === 'git:worktree:create') as {
        reveal?: boolean
        createBranch?: boolean
        branch: string
        source?: string
      }
      expect(createMsg.reveal).toBe(true)
      expect(createMsg.createBranch).toBe(true)
      expect(createMsg.branch).toBe('hip-iso-xyz')
      expect(createMsg.source).toBe('protocol')
      t.push({
        type: 'git:worktree:create:result',
        sessionId: 'host1',
        ok: true,
        path: '/tmp/wt/hip-iso-xyz',
        id: 'iso1',
      })
      const result = await p
      expect(result.ok).toBe(true)
      expect(result.path).toBe('/tmp/wt/hip-iso-xyz')
      expect(result.sessionId).toBeTruthy()
      const child = useDomainStore.getState().sessions.find((s) => s.id === result.sessionId)
      expect(child?.config.cwd).toBe('/tmp/wt/hip-iso-xyz')
      expect(toastSuccess).not.toHaveBeenCalled()
      expect(toastMessage).not.toHaveBeenCalled()
      toastSuccess.mockRestore()
      toastMessage.mockRestore()
    })

    it('startParallelRun uses reveal:false, source host_fanout, and hip-p-* pathKey convention', async () => {
      const t = new FakeTransport()
      // Auto-respond to sequential git:worktree:create messages.
      const origSend = t.send.bind(t)
      t.send = (msg: ClientMessage) => {
        origSend(msg)
        if (msg.type === 'git:worktree:create') {
          const m = msg as {
            sessionId: string
            branch: string
            pathKey?: string
            reveal?: boolean
            source?: string
          }
          queueMicrotask(() => {
            t.push({
              type: 'git:worktree:create:result',
              sessionId: m.sessionId,
              ok: true,
              path: `/tmp/wt/${m.branch}`,
              id: `id-${m.branch}`,
            })
          })
        }
      }

      const svc = new SessionService(t)
      useDomainStore.setState({
        sessions: [
          {
            id: 'host-p',
            config: { ...DEFAULT_CONFIG, surface: 'code', cwd: '/repo' },
            title: 'Host',
            preview: '',
            updatedAtMs: 0,
            loaded: true,
            messages: [],
            status: 'idle',
            error: null,
          },
        ],
        activeSessionId: 'host-p',
        connection: 'disconnected',
      })

      const result = await svc.startParallelRun({
        prompt: 'explore two approaches',
        baseCwd: '/repo',
        count: 2,
        hostSessionId: 'host-p',
        autoSend: false,
      })

      expect(result.slotSessionIds).toHaveLength(2)
      expect(result.slotPaths).toHaveLength(2)
      const creates = t.sent.filter((m) => m.type === 'git:worktree:create') as Array<{
        reveal?: boolean
        branch: string
        pathKey?: string
        source?: string
      }>
      expect(creates).toHaveLength(2)
      for (const c of creates) {
        expect(c.reveal).toBe(false)
        expect(c.source).toBe('host_fanout')
        expect(c.branch.startsWith('hip-p-')).toBe(true)
        expect(c.branch).toMatch(/^hip-p-[a-zA-Z0-9_-]+-[12]$/)
        expect(c.pathKey).toBe(`${result.runId}/${c.branch}`)
      }
    })

    it('removeWorktree passes through errorCode and dirtySummary', async () => {
      const t = new FakeTransport()
      const svc = new SessionService(t)
      const p = svc.removeWorktree('s1', '/tmp/wt/a', false)
      expect(t.sent.find((m) => m.type === 'git:worktree:remove')).toMatchObject({
        type: 'git:worktree:remove',
        sessionId: 's1',
        worktreePath: '/tmp/wt/a',
        force: false,
      })
      t.push({
        type: 'git:worktree:remove:result',
        sessionId: 's1',
        ok: false,
        error: 'Worktree is dirty (uncommitted changes): /tmp/wt/a',
        errorCode: 'WORKTREE_DIRTY',
        dirtySummary: ' M file.ts\n?? new.ts',
      })
      await expect(p).resolves.toEqual({
        ok: false,
        error: 'Worktree is dirty (uncommitted changes): /tmp/wt/a',
        errorCode: 'WORKTREE_DIRTY',
        dirtySummary: ' M file.ts\n?? new.ts',
      })
    })
  })

  describe('token:stream coalescing (PR-3)', () => {
    let rafCbs: FrameRequestCallback[]

    beforeEach(() => {
      rafCbs = []
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
        rafCbs.push(cb)
        return rafCbs.length
      })
      vi.stubGlobal('cancelAnimationFrame', (id: number) => {
        rafCbs[id - 1] = () => {}
      })
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    function flushRaf() {
      const cbs = rafCbs.splice(0, rafCbs.length)
      for (const cb of cbs) cb(0)
    }

    function assistantContent(): string {
      const msgs = useDomainStore.getState().sessions[0].messages
      const a = msgs.find((m) => m.role === 'assistant')
      return a?.content ?? ''
    }

    it('buffers supervisor token:stream until rAF', () => {
      const t = new FakeTransport()
      new SessionService(t)
      t.push({ type: 'agent:started', sessionId: 's1', turnId: 't1', agentId: 'supervisor', role: 'supervisor' })
      t.push({ type: 'token:stream', sessionId: 's1', turnId: 't1', agentId: 'supervisor', delta: 'Hel' })
      t.push({ type: 'token:stream', sessionId: 's1', turnId: 't1', agentId: 'supervisor', delta: 'lo' })
      expect(assistantContent()).toBe('')
      flushRaf()
      expect(assistantContent()).toBe('Hello')
    })

    it('flushTurn on tool:started applies pending tokens before the tool', () => {
      const t = new FakeTransport()
      new SessionService(t)
      t.push({ type: 'agent:started', sessionId: 's1', turnId: 't1', agentId: 'supervisor', role: 'supervisor' })
      t.push({ type: 'token:stream', sessionId: 's1', turnId: 't1', agentId: 'supervisor', delta: 'before tool' })
      expect(assistantContent()).toBe('')
      t.push({
        type: 'tool:started',
        sessionId: 's1',
        turnId: 't1',
        agentId: 'supervisor',
        role: 'supervisor',
        callId: 'c1',
        name: 'read_file',
        input: '{}',
        seq: 1,
      })
      expect(assistantContent()).toBe('before tool')
      const m = useDomainStore.getState().sessions[0].messages.find((x) => x.id === 't1')
      expect(m?.toolCalls?.some((tc) => tc.callId === 'c1')).toBe(true)
    })

    it('reasoning:delta applies immediately without coalescing', () => {
      const t = new FakeTransport()
      new SessionService(t)
      t.push({ type: 'agent:started', sessionId: 's1', turnId: 't1', agentId: 'supervisor', role: 'supervisor' })
      t.push({
        type: 'reasoning:delta',
        sessionId: 's1',
        turnId: 't1',
        agentId: 'supervisor',
        role: 'supervisor',
        stepSeq: 0,
        delta: 'think',
      })
      const m = useDomainStore.getState().sessions[0].messages.find((x) => x.id === 't1')
      expect(m?.timeline).toEqual([
        { kind: 'reasoning', stepSeq: 0, agentId: 'supervisor', role: 'supervisor', content: 'think' },
      ])
      // Pending token remains buffered separately (not mixed into reasoning).
      t.push({ type: 'token:stream', sessionId: 's1', turnId: 't1', agentId: 'supervisor', delta: 'ans' })
      expect(assistantContent()).toBe('')
      expect(m?.timeline?.[0]).toMatchObject({ kind: 'reasoning', content: 'think' })
      flushRaf()
      expect(assistantContent()).toBe('ans')
    })

    it('subagent token:stream coalesces into run.output, not content', () => {
      const t = new FakeTransport()
      new SessionService(t)
      t.push({ type: 'agent:started', sessionId: 's1', turnId: 't1', agentId: 'supervisor', role: 'supervisor' })
      t.push({
        type: 'agent:started',
        sessionId: 's1',
        turnId: 't1',
        agentId: 'coder-1',
        role: 'coder',
        parentAgentId: 'supervisor',
      })
      t.push({ type: 'token:stream', sessionId: 's1', turnId: 't1', agentId: 'coder-1', delta: 'plan' })
      t.push({ type: 'token:stream', sessionId: 's1', turnId: 't1', agentId: 'coder-1', delta: ' A' })
      expect(assistantContent()).toBe('')
      flushRaf()
      expect(assistantContent()).toBe('')
      const m = useDomainStore.getState().sessions[0].messages.find((x) => x.id === 't1')
      const run = m?.agentRuns?.find((r) => r.agentId === 'coder-1')
      expect(run?.output).toBe('plan A')
    })

    it('message:complete flushes pending tokens before finalize (apply order)', () => {
      const t = new FakeTransport()
      new SessionService(t)
      const applyOrder: string[] = []
      const store = useDomainStore.getState()
      const realApply = store.apply.bind(store)
      store.apply = ((msg: ServerMessage) => {
        applyOrder.push(msg.type)
        return realApply(msg)
      }) as typeof store.apply

      t.push({ type: 'agent:started', sessionId: 's1', turnId: 't1', agentId: 'supervisor', role: 'supervisor' })
      t.push({ type: 'token:stream', sessionId: 's1', turnId: 't1', agentId: 'supervisor', delta: 'partial' })
      t.push({
        type: 'message:complete',
        sessionId: 's1',
        message: {
          id: 't1',
          role: 'assistant',
          content: 'final from sidecar',
          timestamp: 1,
        },
      })
      // Barrier must flush token:stream before message:complete so streamed text is not lost
      // when complete content is incomplete; order proves flushTurn ran.
      const completeIdx = applyOrder.indexOf('message:complete')
      const tokenIdx = applyOrder.indexOf('token:stream')
      expect(tokenIdx).toBeGreaterThanOrEqual(0)
      expect(completeIdx).toBeGreaterThan(tokenIdx)
      const m = useDomainStore.getState().sessions[0].messages.find((x) => x.id === 't1')
      expect(m?.content).toBe('final from sidecar')
    })

    it('CANCELLED flushes buffered tokens so content is not deleted as empty provisional', () => {
      const t = new FakeTransport()
      new SessionService(t)
      t.push({ type: 'agent:started', sessionId: 's1', turnId: 't1', agentId: 'supervisor', role: 'supervisor' })
      t.push({ type: 'token:stream', sessionId: 's1', turnId: 't1', agentId: 'supervisor', delta: 'partial reply' })
      expect(assistantContent()).toBe('')
      t.push({ type: 'error', sessionId: 's1', code: 'CANCELLED', message: 'cancelled' })
      // Without flushSession, empty provisional would be deleted and later rAF would no-op.
      expect(useDomainStore.getState().sessions[0].status).toBe('idle')
      const m = useDomainStore.getState().sessions[0].messages.find((x) => x.id === 't1')
      expect(m).toBeDefined()
      expect(m?.content).toBe('partial reply')
      // Stale rAF must not re-apply after cancel flush.
      flushRaf()
      expect(
        useDomainStore.getState().sessions[0].messages.find((x) => x.id === 't1')?.content,
      ).toBe('partial reply')
    })

    it('session:loaded discards pending buckets (no content duplication after reconnect)', () => {
      const t = new FakeTransport()
      new SessionService(t)
      t.push({ type: 'agent:started', sessionId: 's1', turnId: 't1', agentId: 'supervisor', role: 'supervisor' })
      // Simulate partial flush already in store + more still buffered.
      t.push({ type: 'token:stream', sessionId: 's1', turnId: 't1', agentId: 'supervisor', delta: 'Hel' })
      flushRaf()
      expect(assistantContent()).toBe('Hel')
      t.push({ type: 'token:stream', sessionId: 's1', turnId: 't1', agentId: 'supervisor', delta: 'lo' })
      expect(assistantContent()).toBe('Hel') // still buffered
      // Reconnect load replaces with authoritative full text.
      t.push({
        type: 'session:loaded',
        sessionId: 's1',
        messages: [
          { id: 'u1', role: 'user', content: 'hi', timestamp: 0 },
          { id: 't1', role: 'assistant', content: 'Hello', timestamp: 1 },
        ],
      })
      expect(assistantContent()).toBe('Hello')
      // Stale rAF must NOT append "lo" → "Hellolo".
      flushRaf()
      expect(assistantContent()).toBe('Hello')
    })

    it('token:stream with stepSeq uses text kind and preserves stepSeq on flush', () => {
      const t = new FakeTransport()
      new SessionService(t)
      const flushed: ServerMessage[] = []
      const store = useDomainStore.getState()
      const realApply = store.apply.bind(store)
      store.apply = ((msg: ServerMessage) => {
        if (msg.type === 'token:stream') flushed.push(msg)
        return realApply(msg)
      }) as typeof store.apply

      t.push({ type: 'agent:started', sessionId: 's1', turnId: 't1', agentId: 'supervisor', role: 'supervisor' })
      t.push({
        type: 'token:stream',
        sessionId: 's1',
        turnId: 't1',
        agentId: 'supervisor',
        delta: 'a',
        stepSeq: 3,
        role: 'supervisor',
      } as ServerMessage)
      t.push({
        type: 'token:stream',
        sessionId: 's1',
        turnId: 't1',
        agentId: 'supervisor',
        delta: 'b',
        stepSeq: 3,
        role: 'supervisor',
      } as ServerMessage)
      expect(assistantContent()).toBe('')
      flushRaf()
      expect(assistantContent()).toBe('ab')
      expect(flushed).toHaveLength(1)
      expect(flushed[0]).toMatchObject({
        type: 'token:stream',
        delta: 'ab',
        stepSeq: 3,
        role: 'supervisor',
      })
    })
  })
})
