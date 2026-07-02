import type { AgentProfileInfo, ClientMessage, ServerMessage, SessionConfig, FsEntry } from '@hip/protocol'
import type { BaseLanguageModel } from '@langchain/core/language_models/base'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Session } from './session.js'
import type { SessionStore } from '../persistence/store.js'
import { ensureScratchDir, removeScratchDir, defaultScratchRoot } from './scratch.js'
import * as workspaceFs from './workspace-fs.js'
import * as workspaceGit from './workspace-git.js'
import { getWorktreesDir } from './worktree-config.js'
import { setActiveModel } from '../config/providers.js'
import { resolveApiKey } from '../config/auth-file.js'
import { mcpManager } from './mcp/manager.js'
import { promptRegistry } from './mcp/prompt-registry.js'
import { safeErrorMessage } from './error.js'
import { logDebug } from '../debug-logger.js'
import { validatePluginUrl, type PluginInstallResult } from './plugin-install.js'
import { buildTools } from './tools.js'
import { SessionReplay } from './replay.js'
import { EventStore } from '../persistence/event-store.js'
import { AttachmentError } from './attachments.js'

type SendFn = (msg: ServerMessage) => void
type ModelFactory = (config: SessionConfig) => BaseLanguageModel | undefined

/** Normalize a user-typed rename: one line, bounded length, blank → default. */
function sanitizeRename(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, 200) || '新对话'
}

export class SessionManager {
  private readonly sessions = new Map<string, Session>()

  // modelFactory defaults to undefined → Session builds the real env-keyed model.
  constructor(
    private readonly store?: SessionStore,
    private readonly modelFactory: ModelFactory = () => undefined,
    private readonly scratchRoot: string = defaultScratchRoot(),
  ) {}

  handle(msg: ClientMessage, send: SendFn): void {
    // Fire-and-forget, but never let a rejection (e.g. a rehydrate failure) become
    // an unhandled promise rejection — surface it to the client instead.
    this.handleAsync(msg, send).catch((err) => {
      console.error('[session-manager] handler error', err)
      const sessionId = 'sessionId' in msg ? (msg as { sessionId?: string }).sessionId : undefined
      const code = err instanceof AttachmentError ? err.code : 'INTERNAL'
      send({ type: 'error', sessionId, code, message: safeErrorMessage(err) })
    })
  }

  async handleAsync(msg: ClientMessage, send: SendFn): Promise<void> {
    const t0 = Date.now()
    logDebug('mgr', 'msg:handle', { type: msg.type, sessionId: (msg as { sessionId?: string }).sessionId ?? undefined })
    switch (msg.type) {
      case 'session:create':
        this.createSession(msg.id, msg.config, send)
        break
      case 'session:destroy':
        await this.destroySession(msg.sessionId)
        break
      case 'message:compact': {
        const session = this.sessions.get(msg.sessionId)
        if (!session) {
          send({ type: 'compact:result', sessionId: msg.sessionId, ok: false, inputTokens: 0, outputTokens: 0, messagesBefore: 0, messagesAfter: 0, error: 'session not found' })
          return
        }
        try {
          const result = await session.compactNow()
          send({ type: 'compact:result', sessionId: msg.sessionId, ok: true, ...result })
        } catch (e) {
          send({ type: 'compact:result', sessionId: msg.sessionId, ok: false, inputTokens: 0, outputTokens: 0, messagesBefore: 0, messagesAfter: 0, error: String(e) })
        }
        return
      }
      case 'message:send':
        await this.ensureSession(msg.sessionId, send).sendMessage(msg.content, send, msg.id, msg.attachments)
        break
      case 'input:enqueue': {
        const s = this.ensureSession(msg.sessionId, send)
        s.enqueueInput({ type: 'message', content: msg.content, messageId: msg.id })
        await s.drainInputQueue(send)
        break
      }
      case 'input:steer': {
        const s = this.ensureSession(msg.sessionId, send)
        s.enqueueInput({ type: 'steer', content: msg.content, messageId: msg.id })
        await s.drainInputQueue(send)
        break
      }
      case 'message:cancel':
        this.sessions.get(msg.sessionId)?.cancel()
        break
      case 'message:regenerate':
        await this.ensureSession(msg.sessionId, send).regenerate(send)
        break
      case 'message:resume':
        await this.ensureSession(msg.sessionId, send).resume(msg.content, send, msg.attachments)
        break
      case 'subagent:background': {
        const s = this.ensureSession(msg.sessionId, send)
        const ac = new AbortController()
        void s.runBackgroundSubagent(msg.taskId, msg.description, ac.signal, send)
        break
      }
      case 'subagent:resume':
        await this.ensureSession(msg.sessionId, send).resumeSubagent(msg.taskId, msg.message, send)
        break
      case 'plan:respond':
        await this.ensureSession(msg.sessionId, send).handlePlanResponse(msg.action, send, msg.amendContent)
        break
      case 'agent:setConfigOption':
        await this.ensureSession(msg.sessionId, send).setAgentConfigOption(msg.configId, msg.value)
        break
      case 'agent:setProfile': {
        const s = this.ensureSession(msg.sessionId, send)
        const ok = s.setAgentProfile(msg.id)
        if (ok) {
          send({ type: 'agent:profiles', sessionId: msg.sessionId, profiles: this.profileListFor(s) })
        } else {
          send({ type: 'error', sessionId: msg.sessionId, code: 'INVALID_PROFILE', message: 'Unknown agent profile id' })
        }
        break
      }
      case 'permission:respond':
        this.sessions.get(msg.sessionId)?.respondPermission(msg.requestId, msg.cancelled ? { cancelled: true } : { optionId: msg.optionId! })
        break
      case 'session:list':
        send({ type: 'session:list:result', sessions: this.store?.listSessions() ?? [] })
        break
      case 'session:load': {
        const config = this.store
          ? (JSON.parse(this.store.getSession(msg.sessionId)?.config ?? 'null') ?? undefined)
          : undefined
        send({ type: 'session:loaded', sessionId: msg.sessionId, messages: this.store?.loadMessagesWithRuns(msg.sessionId) ?? [], config })
        break
      }
      case 'session:search':
        send({ type: 'session:search:result', query: msg.query, hits: this.store?.search(msg.query) ?? [] })
        break
      case 'session:delete': {
        // Resolve cwd BEFORE the row is gone, then delete SYNCHRONOUSLY (clients + tests rely on the
        // store delete + session:deleted being immediate — no await before them). The shadow-ref
        // cleanup is best-effort and must not block or defer deletion, so fire it and forget.
        const delCwd = this.resolveSessionCwd(msg.sessionId)
        this.store?.deleteSession(msg.sessionId)
        this.sessions.delete(msg.sessionId)
        removeScratchDir(msg.sessionId, this.scratchRoot)
        if (delCwd) void workspaceGit.deleteCheckpointRefs(delCwd, msg.sessionId).catch(() => {})
        send({ type: 'session:deleted', sessionId: msg.sessionId })
        break
      }
      case 'session:rename': {
        const title = sanitizeRename(msg.title)
        this.store?.setCustomTitle(msg.sessionId, title)
        send({ type: 'session:title', sessionId: msg.sessionId, title })
        break
      }
      case 'session:setCwd': {
        const s = this.ensureSession(msg.sessionId, send)
        s.setCwd(msg.cwd)
        this.store?.updateConfig(msg.sessionId, JSON.stringify(s.config))
        // Re-anchor the "since session start" snapshot to the newly-bound cwd so session-start
        // diff works for the common "new chat → bind project dir → agent edits" flow.
        void s.captureSnapshot().catch(() => {})
        send({ type: 'session:cwd', sessionId: msg.sessionId, cwd: msg.cwd })
        break
      }
      case 'session:setThinking': {
        const s = this.ensureSession(msg.sessionId, send)
        const applied = s.setThinking(msg.thinking)
        if (applied) this.store?.updateConfig(msg.sessionId, JSON.stringify(s.config))
        // Echo the session's REAL thinking state (true by default) so the client syncs to truth
        // even if the toggle was rejected mid-turn.
        send({ type: 'session:thinking', sessionId: msg.sessionId, thinking: s.config.thinking ?? true })
        break
      }
      case 'session:setSystemPrompt': {
        const s = this.ensureSession(msg.sessionId, send)
        const applied = s.setSystemPrompt(msg.systemPrompt)
        if (applied) this.store?.updateConfig(msg.sessionId, JSON.stringify(s.config))
        send({ type: 'session:systemPrompt', sessionId: msg.sessionId, systemPrompt: s.config.systemPrompt ?? null })
        break
      }
      case 'session:setPermissionMode': {
        const s = this.ensureSession(msg.sessionId, send)
        const applied = s.setPermissionMode(msg.permissionMode)
        if (applied) this.store?.updateConfig(msg.sessionId, JSON.stringify(s.config))
        // Echo the session's REAL mode (default 'edit') so the client syncs to truth even if the set
        // was rejected mid-turn.
        send({ type: 'session:permissionMode', sessionId: msg.sessionId, permissionMode: s.config.permissionMode ?? 'edit' })
        break
      }
      case 'session:setModel': {
        // Change the global active model AND clear the session's pinned model so
        // resolveModelChoice falls back to the newly-set global default.
        setActiveModel({ providerID: msg.llmProvider, modelID: msg.model, baseURL: msg.baseURL ?? '' })
        const s = this.ensureSession(msg.sessionId, send)
        const applied = s.setModel(msg.llmProvider)
        if (applied) this.store?.updateConfig(msg.sessionId, JSON.stringify(s.config))
        // Also apply to other sessions — they follow the global model if unpinned.
        for (const other of this.sessions.values()) {
          if (other !== s) other.applyActiveModel()
        }
        const hasApiKey = !!resolveApiKey(msg.llmProvider)
        send({ type: 'config:activeModel', providerID: msg.llmProvider, modelID: msg.model, hasApiKey })
        send({ type: 'session:model', sessionId: msg.sessionId, llmProvider: msg.llmProvider, model: msg.model })
        break
      }
      case 'config:setActiveModel': {
        setActiveModel({ providerID: msg.providerID, modelID: msg.modelID, baseURL: msg.baseURL })
        // Apply to every in-memory session at its next idle turn (no restart).
        for (const s of this.sessions.values()) s.applyActiveModel()
        // Re-emit key status for the NEW active provider — `ready` is sent only once per connection,
        // so without this the chat header's "no key" banner would lag until the next reconnect.
        const hasApiKey = !!resolveApiKey(msg.providerID)
        send({ type: 'config:activeModel', providerID: msg.providerID, modelID: msg.modelID, hasApiKey })
        break
      }
      case 'fs:ls': {
        const r = await this.ensureSession(msg.sessionId, send).lsDir(msg.path)
        send({ type: 'fs:ls:result', sessionId: msg.sessionId, path: msg.path, entries: r.entries ?? [], error: r.error })
        break
      }
      case 'fs:read': {
        const r = await this.ensureSession(msg.sessionId, send).readForPreview(msg.path)
        send(
          'error' in r
            ? { type: 'fs:read:result', sessionId: msg.sessionId, path: msg.path, error: r.error }
            : { type: 'fs:read:result', sessionId: msg.sessionId, path: msg.path, content: r.content, encoding: r.encoding, mimeType: r.mimeType, truncated: r.truncated },
        )
        break
      }
      case 'fs:lsCwd': {
        const r = await this.lsCwd(msg.cwd, msg.path)
        send({ type: 'fs:lsCwd:result', cwd: msg.cwd, path: msg.path, entries: r.entries ?? [], error: r.error })
        break
      }
      case 'fs:readCwd': {
        const r = await this.readCwd(msg.cwd, msg.path)
        send(
          'error' in r
            ? { type: 'fs:readCwd:result', cwd: msg.cwd, path: msg.path, error: r.error }
            : { type: 'fs:readCwd:result', cwd: msg.cwd, path: msg.path, content: r.content, encoding: r.encoding, mimeType: r.mimeType, truncated: r.truncated },
        )
        break
      }
      case 'fs:diff': {
        const r = await this.ensureSession(msg.sessionId, send).workspaceDiff(msg.base ?? 'session-start')
        send({ type: 'fs:diff:result', sessionId: msg.sessionId, ...r })
        break
      }
      case 'fs:diffSummary': {
        const r = await this.ensureSession(msg.sessionId, send).workspaceDiffSummary(msg.base ?? 'session-start')
        send({ type: 'fs:diffSummary:result', sessionId: msg.sessionId, ...r })
        break
      }
      case 'fs:diffFile': {
        const r = await this.ensureSession(msg.sessionId, send).workspaceDiffFile(msg.path, msg.base ?? 'session-start', msg.context)
        send({ type: 'fs:diffFile:result', sessionId: msg.sessionId, path: msg.path, base: msg.base ?? 'session-start', state: r.state, file: r.file, error: r.error })
        break
      }
      case 'fs:gitInit': {
        const r = await this.ensureSession(msg.sessionId, send).workspaceGitInit()
        send({ type: 'fs:gitInit:result', sessionId: msg.sessionId, ok: r.ok, ...(r.error ? { error: r.error } : {}) })
        break
      }
      case 'git:checkpoint:list': {
        const r = await this.ensureSession(msg.sessionId, send).listCheckpoints()
        send({ type: 'git:checkpoint:list:result', sessionId: msg.sessionId, checkpoints: r.checkpoints, isGitRepo: r.isGitRepo, currentBranch: r.currentBranch })
        break
      }
      case 'git:checkpoint:diff': {
        const r = await this.ensureSession(msg.sessionId, send).checkpointDiff(msg.checkpointId, msg.mode)
        send({ type: 'git:checkpoint:diff:result', sessionId: msg.sessionId, checkpointId: msg.checkpointId, mode: msg.mode, state: r.state, files: r.files, summary: r.summary, error: r.error })
        break
      }
      case 'git:commitLog': {
        const r = await this.ensureSession(msg.sessionId, send).commitLog()
        send({ type: 'git:commitLog:result', sessionId: msg.sessionId, commits: r.commits ?? [], state: r.state, error: r.error })
        break
      }
      case 'git:branch:list': {
        const r = await this.ensureSession(msg.sessionId, send).listBranches()
        send({ type: 'git:branch:list:result', sessionId: msg.sessionId, branches: r.branches, currentBranch: r.currentBranch })
        break
      }
      case 'git:branch:switch': {
        const r = await this.ensureSession(msg.sessionId, send).switchBranch(msg.branch)
        send({ type: 'git:branch:switch:result', sessionId: msg.sessionId, branch: msg.branch, ok: r.ok, currentBranch: r.currentBranch, ...(r.error ? { error: r.error } : {}) })
        break
      }
      case 'git:revert': {
        const r = await this.ensureSession(msg.sessionId, send).revertCheckpoint(msg.checkpointId, send)
        send({ type: 'git:revert:result', sessionId: msg.sessionId, checkpointId: msg.checkpointId, ok: r.ok, ...(r.safetyCheckpointId ? { safetyCheckpointId: r.safetyCheckpointId } : {}), ...(r.error ? { error: r.error } : {}) })
        break
      }
      case 'git:worktree:create': {
        const s = this.ensureSession(msg.sessionId, send)
        const cwd = s.config.cwd
        if (!cwd) { send({ type: 'git:worktree:create:result', sessionId: msg.sessionId, ok: false, error: 'no cwd' }); break }
        const worktreePath = path.join(getWorktreesDir(), msg.branch)
        const r = await workspaceGit.createWorktree(cwd, msg.branch, worktreePath)
        send({ type: 'git:worktree:create:result', sessionId: msg.sessionId, ok: r.ok, ...(r.path ? { path: r.path } : {}), ...(r.error ? { error: r.error } : {}) })
        break
      }
      case 'git:worktree:list': {
        const s = this.ensureSession(msg.sessionId, send)
        const cwd = s.config.cwd
        if (!cwd) { send({ type: 'git:worktree:list:result', sessionId: msg.sessionId, worktrees: [] }); break }
        const r = await workspaceGit.listWorktrees(cwd)
        send({ type: 'git:worktree:list:result', sessionId: msg.sessionId, worktrees: r.worktrees ?? [] })
        break
      }
      case 'git:worktree:remove': {
        const s = this.ensureSession(msg.sessionId, send)
        const cwd = s.config.cwd
        if (!cwd) { send({ type: 'git:worktree:remove:result', sessionId: msg.sessionId, ok: false, error: 'no cwd' }); break }
        const r = await workspaceGit.removeWorktree(cwd, msg.worktreePath)
        send({ type: 'git:worktree:remove:result', sessionId: msg.sessionId, ok: r.ok, ...(r.error ? { error: r.error } : {}) })
        break
      }
      case 'workflow:run':
        await this.ensureSession(msg.sessionId, send).runWorkflowTurn(msg.def, send)
        break
      case 'mcp:listResources': {
        const resources = mcpManager.allResources().filter((r) => r.serverId === msg.serverId)
        send({ type: 'mcp:listResources:result', serverId: msg.serverId, resources })
        break
      }
      case 'mcp:readResource': {
        const r = await mcpManager.readResource(msg.serverId, msg.uri)
        send(
          r.error
            ? { type: 'mcp:readResource:result', serverId: msg.serverId, uri: msg.uri, contents: [], error: r.error }
            : { type: 'mcp:readResource:result', serverId: msg.serverId, uri: msg.uri, contents: r.contents },
        )
        break
      }
      case 'mcp:listPrompts': {
        const prompts = promptRegistry.listAll().filter((p) => p.serverId === msg.serverId)
        send({ type: 'mcp:listPrompts:result', serverId: msg.serverId, prompts })
        break
      }
      case 'mcp:getPrompt': {
        const r = await promptRegistry.execute(msg.serverId, msg.name, msg.arguments)
        send(
          r.error
            ? { type: 'mcp:getPrompt:result', serverId: msg.serverId, name: msg.name, messages: [], error: r.error }
            : { type: 'mcp:getPrompt:result', serverId: msg.serverId, name: msg.name, messages: r.messages },
        )
        break
      }
      case 'mcp:reconnect': {
        // Force-disconnect all servers, then reconnect with the provided configs.
        // This gives immediate feedback: the frontend sends its latest config state
        // so the sidecar doesn't need to re-read TOML.
        await mcpManager.reconcile([])
        await mcpManager.reconcile(msg.servers)
        send({ type: 'mcp:status', servers: mcpManager.connectionStatuses(msg.servers) })
        break
      }
      case 'plugin:install:url':
        await this.handlePluginInstallUrl(msg.url, send)
        break
      case 'plugin:delete': {
        const pluginId = msg.pluginId
        if (!pluginId || typeof pluginId !== 'string') {
          send({ type: 'plugin:delete:result', pluginId: pluginId ?? '', ok: false, error: 'pluginId is required' })
          break
        }
        // Re-read plugin registry so any sessions still running see the removal.
        for (const session of this.sessions.values()) {
          try {
            session.reloadPlugins()
          } catch (err) {
            console.warn(`[session-manager] failed to reload plugins for session ${session.id}:`, err instanceof Error ? err.message : String(err))
          }
        }
        send({ type: 'plugin:delete:result', pluginId, ok: true })
        break
      }
      case 'replay:session': {
        if (!this.store) {
          send({ type: 'error', sessionId: msg.sessionId, code: 'NO_STORE', message: 'No persistence store available for replay' })
          break
        }
        try {
          const eventStore = new EventStore(this.store.getDb())
          const replay = new SessionReplay(eventStore)
          const result = await replay.replayTurn(msg.sessionId, msg.turnIndex)
          send({ type: 'replay:result', sessionId: msg.sessionId, result })
        } catch (err) {
          send({ type: 'error', sessionId: msg.sessionId, code: 'REPLAY_FAILED', message: safeErrorMessage(err) })
        }
        break
      }
    }
    logDebug('mgr', 'msg:done', { type: msg.type, sessionId: (msg as { sessionId?: string }).sessionId ?? undefined, elapsedMs: Date.now() - t0 })
  }

  private createSession(id: string, config: SessionConfig, send: SendFn): void {
    let cfg = config
    if (!cfg.cwd) cfg = { ...cfg, cwd: ensureScratchDir(id, this.scratchRoot) }
    const now = Date.now()
    this.store?.insertSession({ id, title: '新对话', config: JSON.stringify(cfg), createdAt: now, updatedAt: now })
    this.sessions.set(id, new Session(id, cfg, this.modelFactory(cfg), this.store, undefined, undefined, undefined, undefined, undefined, this.scratchRoot))
    void this.sessions.get(id)!.captureSnapshot().catch((err) => console.warn('[session-manager] captureSnapshot failed:', err instanceof Error ? err.message : String(err)))
    send({ type: 'session:created', sessionId: id })
    // A no-cwd (pure-chat) session got a server-derived scratch cwd — tell the client.
    if (!config.cwd) send({ type: 'session:cwd', sessionId: id, cwd: cfg.cwd! })
  }

  /** Get the in-memory session, or rebuild it from the DB (lazy resume). */
  private ensureSession(id: string, send: SendFn): Session {
    const existing = this.sessions.get(id)
    if (existing) return existing
    const row = this.store?.getSession(id)
    const config: SessionConfig = row ? JSON.parse(row.config) : { llmProvider: 'deepseek', model: '', tools: [] }
    const session = new Session(id, config, this.modelFactory(config), this.store, undefined, undefined, undefined, undefined, undefined, this.scratchRoot)
    if (this.store) session.hydrate(this.store.loadMessages(id))
    this.sessions.set(id, session)
    // Send immediate MCP status for this session's configured servers.
    // Connections may not be established yet (reconcile runs on first turn),
    // but connectionStatuses reports honest disconnected/error states.
    const mcpConfigs = session.configMgr.mcpConfigs
    if (mcpConfigs.length > 0) {
      send({ type: 'mcp:status', servers: mcpManager.connectionStatuses(mcpConfigs) })
    }
    return session
  }

  /** Resolve a session's bound cwd without forcing a rehydrate: prefer the in-memory session, else
   *  parse the persisted config blob. Returns undefined when there is no cwd / no row. */
  private resolveSessionCwd(id: string): string | undefined {
    const inMemory = this.sessions.get(id)?.config.cwd
    if (inMemory) return inMemory
    const raw = this.store?.getSession(id)?.config
    if (!raw) return undefined
    try { return (JSON.parse(raw) as SessionConfig).cwd } catch { return undefined }
  }

  private profileListFor(session: Session): AgentProfileInfo[] {
    return session.listProfiles().map((p) => ({ id: p.id, name: p.name, description: p.description, mode: p.mode }))
  }

  private async destroySession(id: string): Promise<void> {
    await this.sessions.get(id)?.destroy()
    this.sessions.delete(id)
  }

  /** Cancel every in-flight turn — called when the sole client disconnects (ws close).
   *  Safe no-op for idle sessions (Session.cancel() aborts only if a turn is running). */
  cancelAllRunning(): void {
    for (const s of this.sessions.values()) s.cancel()
  }

  /** Exposed for tests only: returns the in-memory session instance (or undefined if not created). */
  getSessionForTest(id: string): Session | undefined {
    return this.sessions.get(id)
  }

  /** List a directory keyed by a raw cwd (for un-committed drafts — no session needed). */
  private async lsCwd(cwd: string, p: string): Promise<{ entries?: FsEntry[]; error?: string }> {
    if (!path.isAbsolute(cwd)) return { error: 'cwd must be an absolute path' }
    try { return { entries: await workspaceFs.lsDir(cwd, p) } }
    catch (e) { return { error: e instanceof Error ? e.message : String(e) } }
  }

  /** Read a file for preview keyed by a raw cwd (draft). */
  private async readCwd(cwd: string, p: string): Promise<workspaceFs.PreviewResult> {
    if (!path.isAbsolute(cwd)) return { error: 'cwd must be an absolute path' }
    try { return await workspaceFs.readForPreview(cwd, p) }
    catch (e) { return { error: e instanceof Error ? e.message : String(e) } }
  }

  /**
   * Handle a plugin:install:url message — a global operation that does NOT
   * require an existing session. Validates the URL, creates a temporary session
   * with an isolated scratch cwd, invokes the plugin_install tool directly, and
   * streams progress + result back.
   */
  private async handlePluginInstallUrl(url: string, send: SendFn): Promise<void> {
    if (!url || typeof url !== 'string' || url.trim().length === 0) {
      send({ type: 'plugin:install:result', ok: false, error: 'URL is required' })
      return
    }

    const urlErr = validatePluginUrl(url)
    if (urlErr) {
      send({ type: 'plugin:install:result', ok: false, error: urlErr })
      return
    }

    const sessionId = `plugin-install-${randomUUID()}`
    const cwd = ensureScratchDir(sessionId, this.scratchRoot)

    const tempConfig: SessionConfig = {
      llmProvider: 'deepseek',
      model: '',
      tools: [],
      cwd,
      permissionMode: 'edit',
      surface: 'chat',
    }

    const tempSession = new Session(sessionId, tempConfig, undefined, undefined, undefined, undefined, undefined, undefined, undefined, this.scratchRoot)
    this.sessions.set(sessionId, tempSession)

    try {
      const tools = buildTools(cwd, undefined, undefined, undefined, { permissionMode: 'edit' })
      const pluginInstallTool = tools.find((t) => t.name === 'plugin_install')
      if (!pluginInstallTool) {
        send({ type: 'plugin:install:result', ok: false, error: 'plugin_install tool is not available' })
        return
      }

      send({ type: 'plugin:install:progress', status: 'cloning', message: 'Cloning plugin repository...' })
      send({ type: 'plugin:install:progress', status: 'scanning', message: 'Scanning plugin manifest...' })

      const raw = String(await pluginInstallTool.invoke({ url }))
      const result: PluginInstallResult = JSON.parse(raw) as PluginInstallResult

      if (result.ok) {
        send({
          type: 'plugin:install:progress',
          status: 'registering',
          message: `Registering plugin "${result.pluginId}"...`,
          pluginId: result.pluginId,
        })
        send({
          type: 'plugin:install:progress',
          status: 'done',
          message: `Plugin "${result.pluginId}" installed successfully`,
          pluginId: result.pluginId,
          components: result.components,
        })
        send({ type: 'plugin:install:result', ok: true, pluginId: result.pluginId })
      } else {
        send({ type: 'plugin:install:progress', status: 'error', message: result.error })
        send({ type: 'plugin:install:result', ok: false, error: result.error })
      }
    } catch (err) {
      const message = safeErrorMessage(err)
      send({ type: 'plugin:install:progress', status: 'error', message })
      send({ type: 'plugin:install:result', ok: false, error: message })
    } finally {
      this.sessions.delete(sessionId)
      removeScratchDir(sessionId, this.scratchRoot)
    }
  }
}
