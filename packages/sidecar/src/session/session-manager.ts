import type { AgentProfileInfo, ClientMessage, SessionConfig, FsEntry } from '@hip/protocol'
import { normalizeSessionConfig } from '@hip/protocol'
import type { BaseLanguageModel } from '@langchain/core/language_models/base'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Session } from './session.js'
import type { SessionStore } from '../persistence/store.js'
import { ensureScratchDir, removeScratchDir, defaultScratchRoot } from './scratch.js'
import * as workspaceFs from './workspace-fs.js'
import * as workspaceGit from './workspace-git.js'
import { setActiveModel } from '../config/providers.js'
import { resolveApiKey } from '../config/auth-file.js'
import { mcpManager } from './mcp/manager.js'
import { safeErrorMessage } from './error.js'
import { logDebug } from '../debug-logger.js'
import { validatePluginUrl, type PluginInstallResult } from './plugin-install.js'
import { buildTools } from './tools.js'
import { SessionReplay } from './replay.js'
import { EventStore } from '../persistence/event-store.js'
import { AttachmentError } from './attachments.js'
import { handleWorkspaceMessage, isWorkspaceMessage } from './handlers/workspace.js'
import { handleMcpMessage, isMcpMessage } from './handlers/mcp.js'
import { handleSessionMessage, isSessionMessage } from './handlers/session.js'
import { handlePluginMessage, isPluginMessage, type PluginHandlerContext } from './handlers/plugin.js'
import type { SendFn, SessionLifecycleContext } from './handlers/types.js'

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

    // Sync type-gates first — never await an async handler for non-matching types
    // (session:create must complete before fire-and-forget set* messages).
    if (isWorkspaceMessage(msg)) {
      await handleWorkspaceMessage(this.handlerCtx(), msg, send)
    } else if (isMcpMessage(msg)) {
      await handleMcpMessage(msg, send)
    } else if (isSessionMessage(msg)) {
      const r = handleSessionMessage(this.lifecycleCtx(), msg, send)
      if (r) await r
    } else if (isPluginMessage(msg)) {
      const r = handlePluginMessage(this.pluginCtx(), msg, send)
      if (r) await r
    }

    logDebug('mgr', 'msg:done', { type: msg.type, sessionId: (msg as { sessionId?: string }).sessionId ?? undefined, elapsedMs: Date.now() - t0 })
  }

  private handlerCtx() {
    return {
      ensureSession: (id: string, send: SendFn) => this.ensureSession(id, send),
      lsCwd: (cwd: string, p: string) => this.lsCwd(cwd, p),
      readCwd: (cwd: string, p: string) => this.readCwd(cwd, p),
      profileListFor: (session: Session) => this.profileListFor(session),
      store: this.store,
    }
  }

  private lifecycleCtx(): SessionLifecycleContext {
    return {
      ...this.handlerCtx(),
      createSession: (id, config, send) => this.createSession(id, config, send),
      destroySession: (id) => this.destroySession(id),
      getSession: (id) => this.sessions.get(id),
      deleteSessionSync: (id, send) => this.deleteSessionSync(id, send),
      listSessions: () => this.store?.listSessions() ?? [],
      loadSession: (id) => {
        const config = this.store
          ? (JSON.parse(this.store.getSession(id)?.config ?? 'null') ?? undefined)
          : undefined
        // UI authority: messages + runs/tools — not event rebuild (see persistence-data-model.md).
        return { messages: this.store?.loadMessagesWithRuns(id) ?? [], config }
      },
      searchSessions: (query) => this.store?.search(query) ?? [],
      setCustomTitle: (id, title) => {
        const sanitized = sanitizeRename(title)
        this.store?.setCustomTitle(id, sanitized)
        return sanitized
      },
      setGlobalActiveModel: (providerID, modelID, baseURL) => {
        setActiveModel({ providerID, modelID, baseURL })
      },
      applyActiveModelToAll: () => {
        for (const s of this.sessions.values()) s.applyActiveModel()
      },
      hasApiKey: (providerID) => !!resolveApiKey(providerID),
      forEachSession: (fn) => {
        for (const s of this.sessions.values()) fn(s)
      },
    }
  }

  private pluginCtx(): PluginHandlerContext {
    return {
      ...this.lifecycleCtx(),
      installPluginFromUrl: (url, send) => this.handlePluginInstallUrl(url, send),
      replayTurn: async (sessionId, turnIndex, send) => {
        if (!this.store) {
          send({ type: 'error', sessionId, code: 'NO_STORE', message: 'No persistence store available for replay' })
          return
        }
        try {
          const eventStore = new EventStore(this.store.getDb())
          const replay = new SessionReplay(eventStore)
          const result = await replay.replayTurn(sessionId, turnIndex)
          send({ type: 'replay:result', sessionId, result })
        } catch (err) {
          send({ type: 'error', sessionId, code: 'REPLAY_FAILED', message: safeErrorMessage(err) })
        }
      },
    }
  }

  private createSession(id: string, config: SessionConfig, send: SendFn): void {
    let cfg: SessionConfig = normalizeSessionConfig(config)
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
    const raw: SessionConfig = row ? JSON.parse(row.config) : { llmProvider: 'deepseek', model: '', tools: [] }
    const config = normalizeSessionConfig(raw)
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

  private deleteSessionSync(id: string, send: SendFn): void {
    // Resolve cwd BEFORE the row is gone, then delete SYNCHRONOUSLY (clients + tests rely on the
    // store delete + session:deleted being immediate — no await before them). The shadow-ref
    // cleanup is best-effort and must not block or defer deletion, so fire it and forget.
    const delCwd = this.resolveSessionCwd(id)
    this.store?.deleteSession(id)
    this.sessions.delete(id)
    removeScratchDir(id, this.scratchRoot)
    if (delCwd) void workspaceGit.deleteCheckpointRefs(delCwd, id).catch(() => {})
    send({ type: 'session:deleted', sessionId: id })
  }

  private profileListFor(session: Session): AgentProfileInfo[] {
    return session.listProfiles().map((p) => ({ id: p.id, name: p.name, description: p.description, mode: p.mode }))
  }

  private async destroySession(id: string): Promise<void> {
    await this.sessions.get(id)?.destroy()
    this.sessions.delete(id)
  }

  /**
   * Cancel every in-flight turn — called when the sole UI client disconnects (ws close).
   *
   * **Single-client assumption:** the desktop shell opens one WebSocket per sidecar.
   * On close we cancel all turns. Multi-client would need per-connection turn ownership
   * before this can become selective; until then this is intentional and documented.
   *
   * Safe no-op for idle sessions (Session.cancel() aborts only if a turn is running).
   */
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
