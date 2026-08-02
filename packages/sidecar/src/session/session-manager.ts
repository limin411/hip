import type { AgentProfileInfo, ClientMessage, SessionConfig, FsEntry } from '@hip/protocol'
import { normalizeSessionConfig } from '@hip/protocol'
import type { BaseLanguageModel } from '@langchain/core/language_models/base'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Session } from './session.js'
import { resolveIdleTimeoutMs } from './idle-timeout.js'
import { readHipConfig } from '../config/hip-config.js'
import type { SessionStore } from '../persistence/store.js'
import { ensureScratchDir, removeScratchDir, defaultScratchRoot } from './scratch.js'
import { removeSessionArtifacts } from './session-artifacts.js'
import * as workspaceFs from './workspace-fs.js'
import * as workspaceGit from './workspace-git.js'
import { setActiveModel } from '../config/providers.js'
import { resolveApiKey } from '../config/auth-file.js'
import { mcpManager } from './mcp/manager.js'
import { CodedError, errorCodeOf, safeErrorMessage } from './error.js'
import { logDebug, logInfo } from '../debug-logger.js'
import { validatePluginUrl, type PluginInstallResult } from './plugin-install.js'
import { buildTools } from './tools.js'
import { SessionReplay } from './replay.js'
import { EventStore } from '../persistence/event-store.js'
import { AttachmentError } from './attachments.js'
import { handleWorkspaceMessage, isWorkspaceMessage } from './handlers/workspace.js'
import { handleMcpMessage, isMcpMessage } from './handlers/mcp.js'
import { handleExtensionMessage, isExtensionMessage } from './handlers/extension.js'
import { handleMemoryMessage, isMemoryMessage, type MemoryHandlerContext } from '../memory/handlers.js'
import { MemoryService } from '../memory/service.js'
import { MemoryStore } from '../memory/store.js'
import { tryEnableMemoriesFts, tryEnableSqliteVec } from '../persistence/schema.js'
import { handleSessionMessage, isSessionMessage } from './handlers/session.js'
import { handlePluginMessage, isPluginMessage, type PluginHandlerContext } from './handlers/plugin.js'
import type { SendFn, SessionLifecycleContext } from './handlers/types.js'
import {
  resolveTrashRetentionDays,
  TRASH_RETENTION_INTERVAL_MS,
} from './trash-retention.js'

type ModelFactory = (config: SessionConfig) => BaseLanguageModel | undefined

/** Normalize a user-typed rename: one line, bounded length, blank → default. */
function sanitizeRename(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, 200) || '新对话'
}

/** Resolve idle timeout for a new/resumed Session (env → hip.toml → surface default). */
function idleTimeoutForConfig(cfg: SessionConfig): number {
  let configMs: number | undefined
  try {
    configMs = readHipConfig().agentLoop?.idleTimeoutMs
  } catch {
    configMs = undefined
  }
  return resolveIdleTimeoutMs({
    env: process.env.HIP_IDLE_TIMEOUT_MS,
    configMs,
    surface: cfg.surface,
  })
}

export class SessionManager {
  private readonly sessions = new Map<string, Session>()
  /** UI-pushed terminal context (ring tail / D11 switch notes), keyed by sessionId. */
  private readonly terminalContexts = new Map<string, { note?: string; ringTail?: string }>()
  private memoryService?: MemoryService
  private trashRetentionTimer?: ReturnType<typeof setInterval>
  private trashRetentionStarted = false

  // modelFactory defaults to undefined → Session builds the real env-keyed model.
  constructor(
    private readonly store?: SessionStore,
    private readonly modelFactory: ModelFactory = () => undefined,
    private readonly scratchRoot: string = defaultScratchRoot(),
  ) {
    // Boot purge + hourly housekeeping when a durable store is present.
    // unref so tests / short-lived managers don't keep the event loop alive.
    this.startTrashRetentionHousekeeping()
  }

  handle(
    msg: ClientMessage,
    send: SendFn,
    connectionId?: string | null,
    connectionRole?: 'gui' | 'cli' | 'unknown' | null,
  ): void {
    // Fire-and-forget, but never let a rejection (e.g. a rehydrate failure) become
    // an unhandled promise rejection — surface it to the client instead.
    void this.handleAsync(msg, send, connectionId, connectionRole)
  }

  async handleAsync(
    msg: ClientMessage,
    send: SendFn,
    connectionId?: string | null,
    connectionRole?: 'gui' | 'cli' | 'unknown' | null,
  ): Promise<void> {
    const t0 = Date.now()
    try {
      logDebug('mgr', 'msg:handle', {
        type: msg.type,
        sessionId: (msg as { sessionId?: string }).sessionId ?? undefined,
        connectionId: connectionId ?? undefined,
      })

      // Tag session with current connection for ownership / background origin.
      const sessionId =
        'sessionId' in msg && typeof (msg as { sessionId?: string }).sessionId === 'string'
          ? (msg as { sessionId: string }).sessionId
          : msg.type === 'session:create'
            ? msg.id
            : undefined
      if (sessionId && connectionId) {
        const s = this.sessions.get(sessionId)
        if (s) s.currentConnectionId = connectionId
      }

      // Sync type-gates first — never await an async handler for non-matching types
      // (session:create must complete before fire-and-forget set* messages).
      // Order: workspace, mcp, memory, session, plugin — memory before session so
      // session:setMemoryFlags is handled here (not in SESSION_MESSAGE_TYPES).
      if (isWorkspaceMessage(msg)) {
        await handleWorkspaceMessage(this.handlerCtx(), msg, send)
      } else if (isMcpMessage(msg)) {
        await handleMcpMessage(msg, send)
      } else if (isExtensionMessage(msg)) {
        handleExtensionMessage(msg, send)
      } else if (isMemoryMessage(msg)) {
        handleMemoryMessage(this.memoryCtx(), msg, send)
      } else if (isSessionMessage(msg)) {
        const r = handleSessionMessage(
          this.lifecycleCtx(connectionId ?? null, connectionRole ?? null),
          msg,
          send,
        )
        if (r) await r
      } else if (isPluginMessage(msg)) {
        const r = handlePluginMessage(this.pluginCtx(), msg, send)
        if (r) await r
      }

      logDebug('mgr', 'msg:done', {
        type: msg.type,
        sessionId: (msg as { sessionId?: string }).sessionId ?? undefined,
        elapsedMs: Date.now() - t0,
      })
    } catch (err) {
      const sessionId = 'sessionId' in msg ? (msg as { sessionId?: string }).sessionId : undefined
      const code =
        err instanceof AttachmentError
          ? err.code
          : errorCodeOf(err) ?? 'INTERNAL'
      // Expected product guards (e.g. SESSION_TRASHED) are not internal faults.
      if (code === 'INTERNAL' || code === 'BUSY') {
        console.error('[session-manager] handler error', err)
      } else {
        logDebug('mgr', 'handler coded error', { code, sessionId, message: safeErrorMessage(err) })
      }
      send({ type: 'error', sessionId, code, message: safeErrorMessage(err) })
    }
  }

  /** Lazy singleton MemoryService bound to the manager's SQLite store. */
  private getMemoryService(): MemoryService {
    if (!this.memoryService) {
      if (!this.store) {
        throw new Error('No persistence store available for memory')
      }
      const db = this.store.getDb()
      const memoriesFts = tryEnableMemoriesFts(db)
      const memoriesVec = tryEnableSqliteVec(db)
      this.memoryService = new MemoryService(new MemoryStore(db, memoriesFts, memoriesVec))
      // Best-effort decay once when memory first becomes available.
      this.memoryService.runStartupDecayOnce()
    }
    return this.memoryService
  }

  private memoryCtx(): MemoryHandlerContext {
    return {
      getMemoryService: () => this.getMemoryService(),
      ensureSession: (id, send) => this.ensureSession(id, send),
      getSession: (id) => this.sessions.get(id),
      store: this.store,
    }
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

  private lifecycleCtx(
    connectionId: string | null = null,
    connectionRole: 'gui' | 'cli' | 'unknown' | null = null,
  ): SessionLifecycleContext {
    return {
      ...this.handlerCtx(),
      connectionId,
      connectionRole,
      createSession: (id, config, send) => {
        this.createSession(id, config, send)
        const s = this.sessions.get(id)
        if (s && connectionId) s.currentConnectionId = connectionId
      },
      setTerminalContext: (sessionId, payload) => {
        this.terminalContexts.set(sessionId, payload)
      },
      getTerminalContext: (sessionId) => this.terminalContexts.get(sessionId),
      destroySession: (id) => this.destroySession(id),
      getSession: (id) => this.sessions.get(id),
      deleteSessionSync: (id, send, opts) => this.hardDeleteSessionSync(id, send, opts),
      softDeleteSessionSync: (id, send, opts) => this.softDeleteSessionSync(id, send, opts),
      restoreSessionSync: (id, send) => this.restoreSessionSync(id, send),
      listTrashedSessions: () => this.store?.listTrashedSessions() ?? [],
      emptyTrashSync: (send) => this.emptyTrashSync(send),
      purgeTrashSync: (send, retentionDays) => this.purgeTrashSync(send, retentionDays),
      isSessionTrashed: (id) => this.isSessionTrashed(id),
      listSessions: () => this.store?.listSessions() ?? [],
      loadSession: (id) => {
        if (this.isSessionTrashed(id)) {
          throw new CodedError('SESSION_TRASHED', 'Session is in the recycle bin; restore it first')
        }
        const config = this.store
          ? (JSON.parse(this.store.getSession(id)?.config ?? 'null') ?? undefined)
          : undefined
        // UI authority: messages + runs/tools — not event rebuild (see persistence-data-model.md).
        return { messages: this.store?.loadMessagesWithRuns(id) ?? [], config }
      },
      searchSessions: (query) => this.store?.search(query) ?? [],
      setCustomTitle: (id, title) => {
        if (this.isSessionTrashed(id)) {
          throw new CodedError('SESSION_TRASHED', 'Session is in the recycle bin; restore it first')
        }
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
      ...this.lifecycleCtx(null),
      installPluginFromUrl: (url, send, opts) => this.handlePluginInstallUrl(url, send, opts),
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
    const idleMs = idleTimeoutForConfig(cfg)
    const session = new Session(id, cfg, this.modelFactory(cfg), this.store, undefined, idleMs, undefined, undefined, undefined, this.scratchRoot)
    this.wireTaskRuntime(session, send)
    this.sessions.set(id, session)
    void session.captureSnapshot().catch((err) => console.warn('[session-manager] captureSnapshot failed:', err instanceof Error ? err.message : String(err)))
    send({ type: 'session:created', sessionId: id })
    // A no-cwd (pure-chat) session got a server-derived scratch cwd — tell the client.
    if (!config.cwd) send({ type: 'session:cwd', sessionId: id, cwd: cfg.cwd! })
    session.backgroundManager.pushSnapshot()
  }

  private wireTaskRuntime(session: Session, send: SendFn): void {
    session.bindSend(send)
    session.setTaskRuntimeBroadcast((msg) => {
      // Fan-out via the connection that last bound send; multi-client may rebind per request.
      try {
        send(msg)
      } catch {
        /* connection gone */
      }
    })
    // Mirror existing cron rows into Runtime
    for (const t of session.cronManager.list()) {
      session.backgroundManager.upsertSchedule({
        id: t.id,
        prompt: t.prompt,
        nextFireAt: t.nextFireAt,
      })
    }
    session.startScheduleTimer()
  }

  /** Get the in-memory session, or rebuild it from the DB (lazy resume). */
  private ensureSession(id: string, send: SendFn): Session {
    if (this.isSessionTrashed(id)) {
      throw new CodedError('SESSION_TRASHED', 'Session is in the recycle bin; restore it first')
    }
    const existing = this.sessions.get(id)
    if (existing) {
      existing.bindSend(send)
      return existing
    }
    const row = this.store?.getSession(id)
    const raw: SessionConfig = row ? JSON.parse(row.config) : { llmProvider: 'deepseek', model: '', tools: [] }
    const config = normalizeSessionConfig(raw)
    const session = new Session(id, config, this.modelFactory(config), this.store, undefined, idleTimeoutForConfig(config), undefined, undefined, undefined, this.scratchRoot)
    if (this.store) session.hydrate(this.store.loadMessages(id))
    // Restore plan-approval pause from durable config marker (D4c.1).
    session.restorePlanApprovalPauseFromConfig()
    this.wireTaskRuntime(session, send)
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

  private isSessionTrashed(id: string): boolean {
    return this.store?.isSessionTrashed(id) ?? false
  }

  /**
   * Soft-delete into the product recycle bin.
   * Tears down live runtime; does **not** remove scratch, checkpoints, or SQLite cascade.
   */
  private softDeleteSessionSync(
    id: string,
    send: SendFn,
    opts?: { deleteDerivedMemories?: boolean; reason?: string },
  ): void {
    this.terminalContexts.delete(id)
    const reason = opts?.reason ?? 'unknown'
    const delCwd = this.resolveSessionCwd(id)
    let title: string | undefined
    let surface: string | undefined
    try {
      const row = this.store?.getSession(id)
      title = row?.title
      if (row?.config) {
        const cfg = JSON.parse(row.config) as { surface?: string }
        surface = cfg.surface
      }
    } catch {
      /* audit best-effort */
    }
    const deletedAt = Date.now()
    logInfo('session-trash', 'audit.soft', {
      sessionId: id,
      reason,
      title,
      surface,
      cwd: delCwd,
      deleteDerivedMemories: !!opts?.deleteDerivedMemories,
      inMemory: this.sessions.has(id),
    })

    if (this.store) {
      this.store.softDeleteSession(id, {
        deleteDerivedMemories: opts?.deleteDerivedMemories,
        deletedAt,
      })
    }
    const live = this.sessions.get(id)
    this.sessions.delete(id)
    // Soft path: keep scratch dir + checkpoint refs for restore.
    const rowAfter = this.store?.getSession(id)
    const at = rowAfter?.deleted_at ?? deletedAt
    send({ type: 'session:trashed', sessionId: id, deletedAt: at })
    if (live) {
      void live.destroy().catch((e) => {
        logDebug('session-trash', 'destroy after softDelete failed', {
          sessionId: id,
          error: e instanceof Error ? e.message : String(e),
        })
      })
    }
  }

  private restoreSessionSync(id: string, send: SendFn): void {
    if (!this.store) {
      send({ type: 'error', sessionId: id, code: 'NO_STORE', message: 'No persistence store available' })
      return
    }
    const ok = this.store.restoreSession(id)
    if (!ok) {
      send({
        type: 'error',
        sessionId: id,
        code: 'SESSION_NOT_TRASHED',
        message: 'Session is not in the recycle bin',
      })
      return
    }
    const summary = this.store.listSessions().find((s) => s.id === id)
    if (!summary) {
      send({ type: 'error', sessionId: id, code: 'SESSION_NOT_FOUND', message: 'Session missing after restore' })
      return
    }
    logInfo('session-trash', 'audit.restore', { sessionId: id, title: summary.title, surface: summary.surface })
    send({ type: 'session:restored', sessionId: id, summary })
  }

  private emptyTrashSync(send: SendFn): void {
    const trash = this.store?.listTrashedSessions() ?? []
    for (const t of trash) {
      this.hardDeleteSessionSync(t.id, send, {
        deleteDerivedMemories: t.deleteDerivedMemories,
        reason: 'trash-empty',
      })
    }
    logInfo('session-trash', 'empty', { count: trash.length })
  }

  private purgeTrashSync(send: SendFn, retentionDays?: number): void {
    const days = resolveTrashRetentionDays(retentionDays)
    if (!this.store) {
      send({ type: 'session:trash:purge:result', purgedIds: [], retentionDays: days })
      return
    }
    // Hard-purge expired rows via store; also drop any lingering live map entries / scratch for purged ids.
    const candidates = this.store.listTrashedSessions().filter((t) => {
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
      return t.deletedAt < cutoff
    })
    const purgedIds: string[] = []
    for (const t of candidates) {
      this.hardDeleteSessionSync(t.id, send, {
        deleteDerivedMemories: t.deleteDerivedMemories,
        reason: 'trash-retention',
      })
      purgedIds.push(t.id)
    }
    send({ type: 'session:trash:purge:result', purgedIds, retentionDays: days })
  }

  /** Boot + 1h interval purge (no client notify). Safe to call multiple times. */
  startTrashRetentionHousekeeping(): void {
    if (this.trashRetentionStarted || !this.store) return
    this.trashRetentionStarted = true
    this.runTrashRetentionQuiet()
    this.trashRetentionTimer = setInterval(() => this.runTrashRetentionQuiet(), TRASH_RETENTION_INTERVAL_MS)
    this.trashRetentionTimer.unref?.()
  }

  /** Clear interval (tests / shutdown). */
  stopTrashRetentionHousekeeping(): void {
    if (this.trashRetentionTimer) {
      clearInterval(this.trashRetentionTimer)
      this.trashRetentionTimer = undefined
    }
    this.trashRetentionStarted = false
  }

  private runTrashRetentionQuiet(): void {
    if (!this.store) return
    const days = resolveTrashRetentionDays()
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
    const expired = this.store.listTrashedSessions().filter((t) => t.deletedAt < cutoff)
    const noop: SendFn = () => {}
    for (const t of expired) {
      this.hardDeleteSessionSync(t.id, noop, {
        deleteDerivedMemories: t.deleteDerivedMemories,
        reason: 'trash-retention',
      })
    }
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

  /**
   * Hard permanent delete (protocol `session:delete`).
   * Cascades SQLite, removes scratch + checkpoint refs, emits `session:deleted`.
   */
  private hardDeleteSessionSync(
    id: string,
    send: SendFn,
    opts?: { deleteDerivedMemories?: boolean; reason?: string },
  ): void {
    this.terminalContexts.delete(id)
    // Resolve cwd BEFORE the row is gone, then delete SYNCHRONOUSLY (clients + tests rely on the
    // store delete + session:deleted being immediate — no await before them). The shadow-ref
    // cleanup is best-effort and must not block or defer deletion, so fire it and forget.
    const delCwd = this.resolveSessionCwd(id)
    const reason = opts?.reason ?? 'unknown'
    let title: string | undefined
    let surface: string | undefined
    let deleteDerived = opts?.deleteDerivedMemories
    try {
      const row = this.store?.getSession(id)
      title = row?.title
      if (row?.config) {
        const cfg = JSON.parse(row.config) as { surface?: string }
        surface = cfg.surface
      }
      if (deleteDerived === undefined && row && 'delete_derived_memories' in row) {
        deleteDerived = !!row.delete_derived_memories
      }
    } catch {
      /* audit best-effort */
    }
    // Always-on INFO so mass wipes are greppable even without HIP_DEBUG=1.
    // Tag [session-delete] — match with: grep 'session-delete' ~/.hip/logs/sidecar*.log
    logInfo('session-delete', 'audit', {
      sessionId: id,
      reason,
      title,
      surface,
      cwd: delCwd,
      deleteDerivedMemories: !!deleteDerived,
      inMemory: this.sessions.has(id),
      stack: new Error().stack?.split('\n').slice(1, 6).join(' | '),
    })
    logDebug('session-delete', 'hardDeleteSessionSync begin', {
      sessionId: id,
      reason,
      cwd: delCwd,
    })
    // Capture live Session before map/store drop so we can dispose ACP sessions
    // (closeSession). Delete + session:deleted stay synchronous for clients/tests.
    const live = this.sessions.get(id)
    this.store?.deleteSession(id, { deleteDerivedMemories: deleteDerived })
    this.sessions.delete(id)
    removeScratchDir(id, this.scratchRoot)
    removeSessionArtifacts(id)
    if (delCwd) void workspaceGit.deleteCheckpointRefs(delCwd, id).catch(() => {})
    send({ type: 'session:deleted', sessionId: id })
    logDebug('session-delete', 'hardDeleteSessionSync done', { sessionId: id, reason })
    // Fire-and-forget: cancel turn + await agentProv.dispose → closeSession.
    // Must not block session:deleted; errors are best-effort.
    if (live) {
      void live.destroy().catch((e) => {
        logDebug('session-delete', 'destroy after delete failed', {
          sessionId: id,
          error: e instanceof Error ? e.message : String(e),
        })
      })
    }
  }

  private profileListFor(session: Session): AgentProfileInfo[] {
    return session.listProfiles().map((p) => ({ id: p.id, name: p.name, description: p.description, mode: p.mode }))
  }

  private async destroySession(id: string): Promise<void> {
    this.terminalContexts.delete(id)
    await this.sessions.get(id)?.destroy()
    this.sessions.delete(id)
  }

  /**
   * Cancel every in-flight turn — legacy single-client close policy
   * (HIP_WS_MULTI_CLIENT=0 kill-switch). Also stops all background tasks.
   */
  cancelAllRunning(): void {
    for (const s of this.sessions.values()) {
      s.cancel()
      // Kill-switch path: stop all running background work for teardown parity.
      for (const taskId of s.backgroundManager.listIds()) {
        const meta = s.backgroundManager.meta.get(taskId)
        if (meta?.status === 'running') s.backgroundManager.stop(taskId, 'client_disconnect_legacy')
      }
    }
  }

  /**
   * Multi-client: drop queued inputs + stop connection-origin background +
   * cancel foreground only when this connection owns the turn.
   */
  cancelOwnedBy(connectionId: string): void {
    for (const s of this.sessions.values()) {
      s.dropQueuedInputsFrom(connectionId)
      s.stopBackgroundFrom(connectionId, 'owner_disconnect')
      if (s.ownerConnectionId === connectionId) {
        s.cancel()
        s.ownerConnectionId = null
      }
      if (s.currentConnectionId === connectionId) {
        s.currentConnectionId = null
      }
    }
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
  private async handlePluginInstallUrl(
    url: string,
    send: SendFn,
    opts?: {
      sha?: string
      ref?: string
      subpath?: string
      marketSourceId?: string
      marketPluginName?: string
      runModelReview?: boolean
      startDisabled?: boolean
    },
  ): Promise<void> {
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
      if (opts?.runModelReview) {
        send({
          type: 'plugin:install:progress',
          status: 'reviewing_models',
          message: 'Reviewing plugin model configuration...',
        })
      }

      const raw = String(
        await pluginInstallTool.invoke({
          url,
          sha: opts?.sha,
          ref: opts?.ref,
          subpath: opts?.subpath,
          marketSourceId: opts?.marketSourceId,
          marketPluginName: opts?.marketPluginName,
          runModelReview: opts?.runModelReview === true,
          startDisabled: opts?.startDisabled === true,
        }),
      )
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
        send({
          type: 'plugin:install:result',
          ok: true,
          pluginId: result.pluginId,
          modelReview: result.modelReview,
        })
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
