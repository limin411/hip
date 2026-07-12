// src/domain/sessionService.ts
import type {
  ServerMessage,
  SessionConfig,
  DiffBase,
  CheckpointMode,
  PermissionMode,
  OrchestrationMode,
  Checkpoint,
  MemoryFileConfig,
  MemoryItem,
  MemoryScope,
  MemoryStatus,
  KeyProbeCode,
} from '@hip/protocol'
import { normalizeSessionConfig } from '@hip/protocol'
import { nanoid } from 'nanoid'
import type { Transport } from './transport'
import { WsTransport } from './wsTransport'
import { useDomainStore, DEFAULT_CONFIG } from './sessionStore'
import { useFsStore } from '@/store/fsStore'
import { useDraftStore } from '@/store/draftStore'
import type { Draft } from '@/store/draftStore'
import { useUiStore, type Surface } from '@/store/uiStore'
import { useDiffStore } from '@/store/diffStore'
import { useTerminalStore } from '@/store/terminalStore'
import { ptyKill } from '@/ipc/pty'
import i18n from '@/i18n'
import { resolveModelConfig } from '@/lib/modelKey'
import { useProvidersStore } from '@/store/providersStore'
import { surfaceOf } from '@/lib/sessions'
import type { LocalAttachment } from '@/components/chat/attachmentTypes'
import { applyServerMessageEffects } from './serverMessageEffects'
import { sessionDebugBundleJson } from '@/lib/sessionDebugBundle'
import { useCommandPaletteStore } from '@/store/commandPaletteStore'
import { useWorkflowStore } from '@/store/workflowStore'

/** Map the current i18next language to one of the three SessionConfig-supported values. */
function currentLanguage(): 'en' | 'zh-CN' | 'zh-TW' {
  const l = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  return l === 'zh-CN' || l === 'zh-TW' ? l : 'en'
}

type ServerMessageWaiter = {
  type: ServerMessage['type']
  /** When set, only messages matching both type and predicate fulfill this waiter. */
  predicate?: (msg: ServerMessage) => boolean
  resolve: (msg: ServerMessage) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export type TestProviderRequest = {
  purpose: 'chat' | 'embedding' | 'rerank'
  providerID: string
  baseURL?: string
  modelID?: string
  apiKey?: string
}

export type TestProviderResult = {
  ok: boolean
  code: KeyProbeCode
  message: string
  latencyMs?: number
  checkedAt: number
  cached?: boolean
}

export class SessionService {
  private readonly transport: Transport
  private readonly unsubscribe: () => void
  private readonly unsubStatus: () => void
  private waiters: ServerMessageWaiter[] = []
  /** E2E: when set, checkpoint list requests/results for this session re-apply the seed. */
  private e2eCheckpointSeed: {
    sessionId: string
    checkpoints: Checkpoint[]
    branch: string
  } | null = null

  constructor(transport: Transport) {
    this.transport = transport
    this.unsubscribe = this.transport.onMessage((msg: ServerMessage) => this.receive(msg))
    this.unsubStatus = this.transport.onStatus((s) => useDomainStore.getState().setConnection(s))
  }

  dispose(): void {
    this.unsubscribe()
    this.unsubStatus()
    for (const w of this.waiters) {
      clearTimeout(w.timer)
      w.reject(new Error('SessionService disposed'))
    }
    this.waiters = []
  }

  /** One-shot wait for the next inbound ServerMessage of a given type. */
  private waitForServerMessage<T extends ServerMessage['type']>(
    type: T,
    timeoutMs = 5000,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    return this.waitForServerMessageWhere(type, undefined, timeoutMs)
  }

  /**
   * One-shot wait for the next inbound ServerMessage of `type` that also matches
   * `predicate` (if provided). Non-matching messages of the same type leave this
   * waiter intact so concurrent requestId RPCs do not cross-resolve.
   */
  private waitForServerMessageWhere<T extends ServerMessage['type']>(
    type: T,
    predicate: ((msg: Extract<ServerMessage, { type: T }>) => boolean) | undefined,
    timeoutMs = 5000,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    return new Promise((resolve, reject) => {
      const entry: ServerMessageWaiter = {
        type,
        predicate: predicate
          ? (msg) => msg.type === type && predicate(msg as Extract<ServerMessage, { type: T }>)
          : undefined,
        resolve: (msg) => resolve(msg as Extract<ServerMessage, { type: T }>),
        reject,
        timer: setTimeout(() => {
          this.waiters = this.waiters.filter((w) => w !== entry)
          reject(new Error(`Timeout waiting for ${type}`))
        }, timeoutMs),
      }
      this.waiters.push(entry)
    })
  }

  /**
   * Wait for the first message whose type is in `types`. Cancels sibling waiters
   * so a validation error does not leave a hung waiter.
   */
  private waitForFirstServerMessage<T extends ServerMessage['type']>(
    types: T[],
    timeoutMs = 5000,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    return new Promise((resolve, reject) => {
      const entries: ServerMessageWaiter[] = []
      const cleanup = () => {
        for (const e of entries) {
          clearTimeout(e.timer)
          this.waiters = this.waiters.filter((w) => w !== e)
        }
      }
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error(`Timeout waiting for ${types.join('|')}`))
      }, timeoutMs)
      for (const type of types) {
        const entry: ServerMessageWaiter = {
          type,
          resolve: (msg) => {
            cleanup()
            clearTimeout(timer)
            resolve(msg as Extract<ServerMessage, { type: T }>)
          },
          reject: (err) => {
            cleanup()
            clearTimeout(timer)
            reject(err)
          },
          // Individual timers unused; outer timer owns the deadline.
          timer: setTimeout(() => {}, timeoutMs),
        }
        clearTimeout(entry.timer)
        entries.push(entry)
        this.waiters.push(entry)
      }
    })
  }

  private fulfillWaiters(msg: ServerMessage): void {
    const idx = this.waiters.findIndex(
      (w) => w.type === msg.type && (!w.predicate || w.predicate(msg)),
    )
    if (idx < 0) return
    const [w] = this.waiters.splice(idx, 1)
    clearTimeout(w.timer)
    w.resolve(msg)
  }

  async connect(): Promise<void> {
    try {
      await this.transport.connect()
    } catch (e) {
      console.error('[SessionService] connect failed', e)
      useDomainStore.getState().setConnection('error')
    }
  }

  reconnect(): void {
    void this.connect()
  }

  /** Stop the transport's connect/reconnect loop (e.g. on AppLayout unmount). */
  disconnect(): void {
    this.transport.disconnect()
  }

  private receive(msg: ServerMessage): void {
    useDomainStore.getState().apply(msg)
    applyServerMessageEffects(msg, {
      send: (m) => this.transport.send(m),
      requestDiff: (sessionId) => this.requestDiff(sessionId),
      requestCheckpoints: (sessionId) => this.requestCheckpoints(sessionId),
      requestCommitLog: (sessionId) => this.requestCommitLog(sessionId),
      resyncActiveIfRunning: () => this.resyncActiveIfRunning(),
    })
    // After the session catalog lands (or re-lands on reconnect), re-attach open tabs
    // from localStorage and re-select the last active conversation when needed.
    if (msg.type === 'session:list:result') {
      this.restoreOpenTabsFromPersistence()
    }
    // E2E seed wins over empty/real sidecar list:result for the seeded session.
    if (
      msg.type === 'git:checkpoint:list:result' &&
      this.e2eCheckpointSeed &&
      msg.sessionId === this.e2eCheckpointSeed.sessionId
    ) {
      const seed = this.e2eCheckpointSeed
      useDiffStore.getState().setCheckpoints(seed.sessionId, seed.checkpoints, true, seed.branch)
    }
    this.fulfillWaiters(msg)
  }

  /**
   * Wait for hip-ui rehydration (openSessionIds / surface pointers) then prune + restore.
   * session:list:result can race persist rehydrate on cold start.
   */
  private restoreOpenTabsFromPersistence(): void {
    const run = () => this.applyRestoredOpenTabs()
    const api = useUiStore.persist
    if (api.hasHydrated()) {
      run()
      return
    }
    api.onFinishHydration(run)
  }

  /**
   * Prune persisted open tabs to sessions that still exist, then select the remembered
   * active conversation for the current surface (cold launch / reconnect with no active).
   */
  private applyRestoredOpenTabs(): void {
    const sessions = useDomainStore.getState().sessions
    const existing = new Set(sessions.map((s) => s.id))
    const ui = useUiStore.getState()

    const pruned = ui.openSessionIds.filter((id) => existing.has(id))
    if (
      pruned.length !== ui.openSessionIds.length ||
      pruned.some((id, i) => id !== ui.openSessionIds[i])
    ) {
      ui.reorderOpenSessions(pruned)
    }

    if (ui.chatSessionId != null && !existing.has(ui.chatSessionId)) {
      ui.setChatSessionId(null)
    }
    if (ui.codeSessionId != null && !existing.has(ui.codeSessionId)) {
      ui.setCodeSessionId(null)
    }

    const active = useDomainStore.getState().activeSessionId
    // Reconnect while a tab is already live: keep selection; only ensure it's in the open list.
    if (active != null && existing.has(active)) {
      if (!useUiStore.getState().openSessionIds.includes(active)) {
        useUiStore.getState().addOpenSession(active)
      }
      return
    }

    const st = useUiStore.getState()
    // Settings / history: tabs stay restored in state for when the user leaves the special view.
    if (st.activeView === 'settings' || st.activeView === 'history') return

    const surface: Surface = st.activeView === 'code' ? 'code' : 'chat'
    const matchesSurface = (id: string) =>
      sessions.some((s) => s.id === id && surfaceOf(s.config) === surface)

    let want = surface === 'chat' ? st.chatSessionId : st.codeSessionId
    if (want == null || !existing.has(want) || !pruned.includes(want) || !matchesSurface(want)) {
      want =
        pruned.find((id) => matchesSurface(id)) ??
        (pruned.length > 0 ? pruned[0] : null)
    }

    if (want != null) {
      this.selectSession(want)
      // selectSession prepends the id; put the bar back to the persisted order.
      useUiStore.getState().reorderOpenSessions(pruned)
    } else {
      useDomainStore.getState().deselect()
    }
  }

  /**
   * Inject a ServerMessage through the same pipeline as the WS transport.
   * Intended for E2E / DEV harness only (see `installE2eHooks`).
   */
  injectServerMessage(msg: ServerMessage): void {
    this.receive(msg)
  }

  /**
   * E2E: snapshot workflow store for a session (product has no dedicated DAG shell).
   */
  getWorkflowSession(sessionId: string): {
    activeWorkflow: { id: string; name: string } | null
    runId: string | null
    runStatus: string | null
    nodeStatuses: Record<string, string>
  } {
    const slice = useWorkflowStore.getState().getSession(sessionId)
    const def = slice.activeWorkflow
    const nodes = slice.runState?.nodes ?? {}
    const nodeStatuses: Record<string, string> = {}
    for (const [nid, n] of Object.entries(nodes)) {
      nodeStatuses[nid] = n.status
    }
    return {
      activeWorkflow: def ? { id: def.id, name: def.name } : null,
      runId: slice.runId,
      runStatus: slice.runState?.status ?? null,
      nodeStatuses,
    }
  }

  /**
   * Seed an in-flight write_file toolCall and emit tool:finished so the
   * Sprint B diff-refresh path runs (debounced requestDiff). E2E uses this
   * after writing the file on disk without a real LLM turn.
   */
  simulateAgentWriteFinished(sessionId: string): { turnId: string; callId: string } {
    const turnId = `e2e-turn-${nanoid(8)}`
    const callId = `e2e-write-${nanoid(8)}`
    const now = Date.now()
    useDomainStore.setState((st) => ({
      ...st,
      sessions: st.sessions.map((s) =>
        s.id !== sessionId
          ? s
          : {
              ...s,
              messages: [
                ...s.messages,
                {
                  id: turnId,
                  role: 'assistant' as const,
                  content: '',
                  timestamp: now,
                  toolCalls: [
                    {
                      callId,
                      agentId: 'coder',
                      name: 'write_file',
                      input: '{}',
                      status: 'running' as const,
                      seq: 1,
                    },
                  ],
                },
              ],
            },
      ),
    }))
    this.receive({
      type: 'tool:finished',
      sessionId,
      turnId,
      agentId: 'coder',
      callId,
      status: 'finished',
      output: 'ok',
    })
    return { turnId, callId }
  }

  /** E2E: create a chat session without sending a user message (no LLM turn). */
  createChatSessionForE2e(): string {
    return this.createSession({ ...DEFAULT_CONFIG, surface: 'chat' })
  }

  /** E2E: create a code session bound to cwd without an LLM turn. */
  createCodeSessionForE2e(cwd: string): string {
    return this.createSession({
      ...DEFAULT_CONFIG,
      surface: 'code',
      cwd,
      permissionMode: 'edit',
    })
  }

  /**
   * E2E H2: put session into running with partial assistant text + in-flight tool
   * so Stop shows and CANCELLED keeps a non-empty stopped projection.
   */
  simulateTurnRunning(sessionId: string): { turnId: string; callId: string } {
    const turnId = `e2e-turn-${nanoid(8)}`
    const callId = `e2e-call-${nanoid(8)}`
    this.receive({
      type: 'agent:started',
      sessionId,
      turnId,
      agentId: 'supervisor',
      role: 'supervisor',
    })
    this.receive({
      type: 'token:stream',
      sessionId,
      turnId,
      agentId: 'supervisor',
      delta: 'partial e2e reply',
    })
    // Running tool makes finalizeCancelledMessage treat the turn as in-flight (sets stopped).
    this.receive({
      type: 'tool:started',
      sessionId,
      turnId,
      agentId: 'supervisor',
      role: 'supervisor',
      callId,
      name: 'read_file',
      input: '{}',
      seq: 1,
    })
    return { turnId, callId }
  }

  /** E2E H2: apply CANCELLED projection (same path as sidecar cancel). */
  simulateTurnCancelled(sessionId: string): void {
    this.receive({ type: 'error', sessionId, code: 'CANCELLED', message: 'cancelled' })
  }

  /** E2E H4: surface inline error so copy-debug is available. */
  simulateSessionError(
    sessionId: string,
    code = 'AGENT_ERROR',
    message = 'e2e simulated error',
  ): void {
    this.receive({ type: 'error', sessionId, code, message })
  }

  /**
   * E2E H6: seed supervisor + coder sub-agent so Agents panel shows structure
   * and cards without a real LLM turn.
   */
  seedAgentCollaboration(sessionId: string): { turnId: string; callId: string } {
    const turnId = `e2e-turn-${nanoid(8)}`
    const callId = `e2e-call-${nanoid(8)}`
    this.receive({
      type: 'agent:started',
      sessionId,
      turnId,
      agentId: 'supervisor',
      role: 'supervisor',
    })
    this.receive({
      type: 'agent:started',
      sessionId,
      turnId,
      agentId: 'coder-1',
      role: 'coder',
      parentAgentId: 'supervisor',
      taskInput: 'e2e implement feature',
    })
    this.receive({
      type: 'tool:started',
      sessionId,
      turnId,
      agentId: 'coder-1',
      role: 'coder',
      callId,
      name: 'read_file',
      input: '{"path":"README.md"}',
      seq: 1,
    })
    return { turnId, callId }
  }

  /** E2E H4: same redacted JSON builder as ChatPane copy-debug (avoids clipboard flake). */
  getSessionDebugBundleJson(): string | null {
    const { activeSessionId, sessions } = useDomainStore.getState()
    if (!activeSessionId) return null
    const session = sessions.find((s) => s.id === activeSessionId)
    if (!session) return null
    return sessionDebugBundleJson({
      sessionId: activeSessionId,
      title: session.title,
      config: session.config,
      messages: session.messages,
      recentErrors: session.error
        ? [{ code: session.error.code, message: session.error.message, at: Date.now() }]
        : undefined,
    })
  }

  /** E2E H5: surface HITL permission modal. */
  simulatePermissionRequest(sessionId: string): { turnId: string; requestId: string } {
    const turnId = `e2e-turn-${nanoid(8)}`
    const requestId = `e2e-perm-${nanoid(8)}`
    this.receive({
      type: 'permission:request',
      sessionId,
      turnId,
      requestId,
      tool: { title: 'e2e-run-script', kind: 'execute', content: 'echo e2e' },
      options: [
        { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'reject_once', name: 'Reject', kind: 'reject_once' },
      ],
    })
    return { turnId, requestId }
  }

  /**
   * E2E P4: seed checkpoint list + isGitRepo so Timeline tab is gated open
   * without a real git repo on disk.
   *
   * Pins seed on this service so TimelineView's requestCheckpoints + late
   * `git:checkpoint:list:result` cannot wipe rows with an empty sidecar list.
   */
  seedCheckpoints(sessionId: string): { count: number } {
    const now = Date.now()
    const checkpoints = [
      {
        id: `${sessionId}:t1`,
        sessionId,
        turnId: 't1',
        kind: 'turn' as const,
        label: 'e2e turn',
        treeSha: 'tree1',
        commitSha: 'commit1',
        branch: 'main',
        createdAt: now,
      },
      {
        id: `${sessionId}:start`,
        sessionId,
        turnId: null,
        kind: 'start' as const,
        label: null,
        treeSha: 'tree0',
        commitSha: 'commit0',
        branch: 'main',
        createdAt: now - 1000,
      },
    ]
    this.e2eCheckpointSeed = { sessionId, checkpoints, branch: 'main' }
    useDiffStore.getState().setCheckpoints(sessionId, checkpoints, true, 'main')
    return { count: checkpoints.length }
  }

  /** E2E S5: open global command palette (⌘K) without OS key routing. */
  openCommandPaletteForE2e(): void {
    useCommandPaletteStore.getState().setOpen(true)
  }

  closeCommandPaletteForE2e(): void {
    useCommandPaletteStore.getState().close()
  }

  /** E2E T2: install failure payload (UI must have submitted form to show error). */
  simulatePluginInstallError(error = 'e2e package structure invalid'): void {
    this.receive({ type: 'plugin:install:result', ok: false, error })
  }

  createSession(config: SessionConfig = DEFAULT_CONFIG): string {
    const id = nanoid()
    const enriched: SessionConfig = normalizeSessionConfig({ ...config, language: currentLanguage() })
    useDomainStore.getState().createSession(id, enriched)
    this.rememberActiveForSurface(id)
    useUiStore.getState().addOpenSession(id)
    this.transport.send({ type: 'session:create', id, config: enriched })
    return id
  }

  selectSession(id: string, messageId?: string): void {
    useDomainStore.getState().selectSession(id)
    useUiStore.getState().addOpenSession(id)
    useUiStore.getState().setSelectedArtifactPath(null)
    const s = useDomainStore.getState().sessions.find((x) => x.id === id)
    if (s) {
      useUiStore.getState().setActiveView(surfaceOf(s.config))
      this.rememberActiveForSurface(id)
    }
    // Lazily fetch history the first time a summary-only session is opened.
    if (s && !s.loaded) this.transport.send({ type: 'session:load', sessionId: id })
    // Refresh the Diff-tab change badge on open (cheap numstat) so pending changes are
    // advertised without the user first opening the Diff tab. No-cwd/non-repo → no summary → no badge.
    const base = useDiffStore.getState().bySession[id]?.base ?? 'session-start'
    this.transport.send({ type: 'fs:diffSummary', sessionId: id, base })
    // Pull the checkpoint list (cheap; also tells the panel whether the cwd is a git repo → tab gating).
    this.transport.send({ type: 'git:checkpoint:list', sessionId: id })
    // Carry a clicked search hit's message into the scroll target; a plain select clears any stale one.
    useUiStore.getState().setScrollTarget(messageId ?? null)
  }

  /** Remember the currently-open conversation for the active surface (so returning restores it,
   *  and so Code's persisted last-conversation pointer stays fresh across launches). */
  private rememberActiveForSurface(id: string | null): void {
    const view = useUiStore.getState().activeView
    if (view === 'chat') useUiStore.getState().setChatSessionId(id)
    else if (view === 'code') useUiStore.getState().setCodeSessionId(id)
  }

  /** Switch the active top-level surface. Snapshots the leaving surface's open conversation, then
   *  restores the entering surface's (validated against the loaded list + its surface). Both Chat and
   *  Code restore their last conversation from the persisted surface pointer when present. */
  setSurface(view: Surface): void {
    const cur = useUiStore.getState().activeView
    const activeId = useDomainStore.getState().activeSessionId
    if (cur === 'chat') useUiStore.getState().setChatSessionId(activeId)
    else if (cur === 'code') useUiStore.getState().setCodeSessionId(activeId)
    useUiStore.getState().setActiveView(view)
    if (view === 'chat' && useDraftStore.getState().draft?.mode === 'project') {
      useDraftStore.getState().clearProject()
    }
    const want = view === 'chat' ? useUiStore.getState().chatSessionId : useUiStore.getState().codeSessionId
    const sessions = useDomainStore.getState().sessions
    if (want != null && sessions.some((s) => s.id === want && surfaceOf(s.config) === view)) {
      this.selectSession(want)
    } else {
      useDomainStore.getState().deselect()
    }
  }

  /** Update the active surface without restoring a remembered session. Used on the New Conversation
   *  page, where the user is choosing the surface for a *new* draft rather than returning to history. */
  previewSurface(view: Surface): void {
    useUiStore.getState().setActiveView(view)
    if (view === 'chat' && useDraftStore.getState().draft?.mode === 'project') {
      useDraftStore.getState().clearProject()
    }
  }

  closeSession(id: string): void {
    const wasActive = useDomainStore.getState().activeSessionId === id
    const ids = useUiStore.getState().openSessionIds
    const index = ids.indexOf(id)
    useUiStore.getState().removeOpenSession(id)
    this.deleteSession(id)
    const remaining = useUiStore.getState().openSessionIds
    if (wasActive && remaining.length > 0) {
      const nextIndex = Math.min(index, remaining.length - 1)
      this.selectSession(remaining[nextIndex])
    } else if (remaining.length === 0) {
      useDomainStore.getState().deselect()
      useUiStore.getState().setChatSessionId(null)
      useUiStore.getState().setCodeSessionId(null)
    }
  }

  deleteSession(id: string, opts?: { deleteDerivedMemories?: boolean }): void {
    useUiStore.getState().removeOpenSession(id)
    useDomainStore.getState().deleteSession(id)
    // Terminal: single kill hook (closeSession → deleteSession; do not also kill in close).
    void ptyKill(id).catch(() => {})
    useTerminalStore.getState().clearSession(id)
    if (useUiStore.getState().chatSessionId === id) useUiStore.getState().setChatSessionId(null)
    if (useUiStore.getState().codeSessionId === id) useUiStore.getState().setCodeSessionId(null)
    // The domain delete-fallback may auto-select sessions[0] from the GLOBAL list, which can belong
    // to the other surface. Reconcile: if the now-active session doesn't match the current surface,
    // pick the newest same-surface session, else show new-conversation.
    const view = useUiStore.getState().activeView
    if (view === 'chat' || view === 'code') {
      const st = useDomainStore.getState()
      const cur = st.sessions.find((s) => s.id === st.activeSessionId)
      if (!cur || surfaceOf(cur.config) !== view) {
        const next = st.sessions.find((s) => surfaceOf(s.config) === view)
        if (next) this.selectSession(next.id)
        else { useDomainStore.getState().deselect(); this.rememberActiveForSurface(null) }
      }
    }
    this.transport.send({
      type: 'session:delete',
      sessionId: id,
      ...(opts?.deleteDerivedMemories ? { deleteDerivedMemories: true } : {}),
    })
  }

  // ── Cross-session memory ──────────────────────────────────────────────────

  /**
   * Probe whether a provider (or memory endpoint) API key works.
   * Product A: provider-key usability, not per-model entitlement.
   */
  async testProvider(req: TestProviderRequest, timeoutMs = 20_000): Promise<TestProviderResult> {
    const requestId = nanoid()
    const wait = this.waitForServerMessageWhere(
      'config:testProvider:result',
      (m) => m.requestId === requestId,
      timeoutMs,
    )
    this.transport.send({
      type: 'config:testProvider',
      requestId,
      purpose: req.purpose,
      providerID: req.providerID,
      ...(req.baseURL !== undefined ? { baseURL: req.baseURL } : {}),
      ...(req.modelID !== undefined ? { modelID: req.modelID } : {}),
      ...(req.apiKey !== undefined ? { apiKey: req.apiKey } : {}),
    })
    const msg = await wait
    return {
      ok: msg.ok,
      code: msg.code,
      message: msg.message,
      latencyMs: msg.latencyMs,
      checkedAt: msg.checkedAt,
      cached: msg.cached,
    }
  }

  async getMemoryConfig(): Promise<MemoryFileConfig> {
    const wait = this.waitForServerMessage('memory:config')
    this.transport.send({ type: 'memory:getConfig' })
    const msg = await wait
    return msg.config
  }

  async setMemoryConfig(config: Partial<MemoryFileConfig>): Promise<MemoryFileConfig> {
    // setConfig validation failures arrive as type:error (code MEMORY_CONFIG).
    const wait = this.waitForFirstServerMessage(['memory:config', 'error'])
    this.transport.send({ type: 'memory:setConfig', config })
    const msg = await wait
    if (msg.type === 'error') {
      throw new Error(msg.message)
    }
    return msg.config
  }

  async getMemoryIndexStatus(): Promise<{
    embedded: number
    total: number
    modelKey?: string
    vecEnabled?: boolean
  }> {
    const wait = this.waitForServerMessage('memory:indexStatus:result')
    this.transport.send({ type: 'memory:indexStatus' })
    const msg = await wait
    if (msg.error) throw new Error(msg.error)
    return {
      embedded: msg.embedded,
      total: msg.total,
      modelKey: msg.modelKey,
      vecEnabled: msg.vecEnabled,
    }
  }

  async reindexMemories(): Promise<{
    embedded: number
    total: number
    failed: number
    modelKey?: string
  }> {
    const wait = this.waitForServerMessage('memory:reindex:result')
    this.transport.send({ type: 'memory:reindex' })
    const msg = await wait
    if (msg.error) throw new Error(msg.error)
    return {
      embedded: msg.embedded,
      total: msg.total,
      failed: msg.failed ?? 0,
      modelKey: msg.modelKey,
    }
  }

  async listMemories(filter?: {
    scope?: MemoryScope
    projectKeyHash?: string
    sessionId?: string
    query?: string
    limit?: number
    status?: MemoryStatus
  }): Promise<MemoryItem[]> {
    const wait = this.waitForServerMessage('memory:list:result')
    this.transport.send({ type: 'memory:list', ...filter })
    const msg = await wait
    if (msg.error) throw new Error(msg.error)
    return msg.items
  }

  async upsertMemory(
    item: Partial<MemoryItem> & Pick<MemoryItem, 'title' | 'content' | 'kind' | 'scope'>,
  ): Promise<MemoryItem> {
    const wait = this.waitForServerMessage('memory:upsert:result')
    this.transport.send({ type: 'memory:upsert', item })
    const msg = await wait
    if (msg.error || !msg.item) throw new Error(msg.error ?? 'upsert failed')
    return msg.item
  }

  async deleteMemory(id: string, hard?: boolean): Promise<boolean> {
    const wait = this.waitForServerMessage('memory:delete:result')
    this.transport.send({ type: 'memory:delete', id, ...(hard !== undefined ? { hard } : {}) })
    const msg = await wait
    if (msg.error) throw new Error(msg.error)
    return msg.ok
  }

  async deleteMemoriesBySourceSession(sessionId: string, soft?: boolean): Promise<number> {
    const wait = this.waitForServerMessage('memory:deleteBySourceSession:result')
    this.transport.send({
      type: 'memory:deleteBySourceSession',
      sessionId,
      ...(soft !== undefined ? { soft } : {}),
    })
    const msg = await wait
    if (msg.error) throw new Error(msg.error)
    return msg.deleted
  }

  async restoreMemory(id: string): Promise<MemoryItem> {
    const wait = this.waitForServerMessage('memory:restore:result')
    this.transport.send({ type: 'memory:restore', id })
    const msg = await wait
    if (msg.error || !msg.item) throw new Error(msg.error ?? 'restore failed')
    return msg.item
  }

  async emptyMemoryTrash(): Promise<number> {
    const wait = this.waitForServerMessage('memory:emptyTrash:result')
    this.transport.send({ type: 'memory:emptyTrash' })
    const msg = await wait
    if (msg.error) throw new Error(msg.error)
    return msg.deleted
  }

  async exportMemories(format: 'jsonl' | 'markdown' = 'jsonl'): Promise<string> {
    const wait = this.waitForServerMessage('memory:export:result')
    this.transport.send({ type: 'memory:export', format })
    const msg = await wait
    if (msg.error) throw new Error(msg.error)
    return msg.data
  }

  async importMemories(data: string): Promise<number> {
    const wait = this.waitForServerMessage('memory:import:result')
    this.transport.send({ type: 'memory:import', format: 'jsonl', data })
    const msg = await wait
    if (msg.error || !msg.ok) throw new Error(msg.error ?? 'import failed')
    return msg.imported
  }

  consolidateMemories(projectKeyHash?: string): void {
    this.transport.send({
      type: 'memory:consolidate',
      ...(projectKeyHash ? { projectKeyHash } : {}),
    })
  }

  setMemoryFlags(
    sessionId: string,
    flags: { useMemories?: boolean; generateMemories?: boolean; incognito?: boolean },
  ): void {
    // Optimistic local merge; server echoes session:memoryFlags.
    useDomainStore.getState().apply({
      type: 'session:memoryFlags',
      sessionId,
      ...flags,
    })
    this.transport.send({ type: 'session:setMemoryFlags', sessionId, ...flags })
  }

  renameSession(id: string, title: string): void {
    useDomainStore.getState().renameSession(id, title)
    this.transport.send({ type: 'session:rename', sessionId: id, title })
  }

  setProjectDir(id: string, cwd: string): void {
    useDomainStore.getState().apply({ type: 'session:cwd', sessionId: id, cwd }) // optimistic
    useFsStore.getState().clearSession(id)
    useDiffStore.getState().clearSession(id)
    // Terminal: kill old shell + clear ring; TerminalView re-opens on cwd change if tab visible.
    void ptyKill(id).catch(() => {})
    useTerminalStore.getState().clearSession(id)
    this.transport.send({ type: 'session:setCwd', sessionId: id, cwd })
  }

  setThinking(id: string, thinking: boolean): void {
    useDomainStore.getState().apply({ type: 'session:thinking', sessionId: id, thinking }) // optimistic
    this.transport.send({ type: 'session:setThinking', sessionId: id, thinking })
  }

  setPermissionMode(id: string, mode: PermissionMode): void {
    useDomainStore.getState().apply({ type: 'session:permissionMode', sessionId: id, permissionMode: mode }) // optimistic
    this.transport.send({ type: 'session:setPermissionMode', sessionId: id, permissionMode: mode })
  }

  setSystemPrompt(id: string, systemPrompt: string | null): void {
    useDomainStore.getState().apply({ type: 'session:systemPrompt', sessionId: id, systemPrompt }) // optimistic
    this.transport.send({ type: 'session:setSystemPrompt', sessionId: id, systemPrompt })
  }

  /**
   * @deprecated Agent-driven orchestration ignores orchMode for turn routing.
   * Kept for protocol compatibility with old clients; no-op for product UI.
   */
  setOrchMode(id: string, orchMode: OrchestrationMode): void {
    useDomainStore.getState().apply({ type: 'session:orchMode', sessionId: id, orchMode })
    this.transport.send({ type: 'session:setOrchMode', sessionId: id, orchMode })
  }

  /** Switch the global current model live (no sidecar restart). */
  setActiveModel(providerID: string, modelID: string, baseURL: string): void {
    this.transport.send({ type: 'config:setActiveModel', providerID, modelID, baseURL })
  }

  /** Switch the active session's model mid-conversation. Resolves the modelKey to llmProvider /
   *  model / baseURL, sends session:setModel to the sidecar (which also updates the global active
   *  model), and optimistically updates the session's config. */
  setSessionModel(modelKey: string): void {
    const { activeSessionId } = useDomainStore.getState()
    if (!activeSessionId) return
    const { catalog, config } = useProvidersStore.getState()
    const { llmProvider, model, baseURL } = resolveModelConfig(catalog, config, modelKey)
    // Optimistic — the sidecar echoes session:model to confirm.
    useDomainStore.getState().apply({ type: 'session:model', sessionId: activeSessionId, llmProvider, model })
    this.transport.send({ type: 'session:setModel', sessionId: activeSessionId, llmProvider, model, baseURL })
  }

  /** Switch a live ACP-agent config selector (model/mode); the agent re-advertises via agent:configOptions. */
  setAgentConfigOption(sessionId: string, configId: string, value: string): void {
    this.transport.send({ type: 'agent:setConfigOption', sessionId, configId, value })
  }

  /** Answer a pending HITL tool-permission request: forward the user's choice (a chosen optionId, or
   *  a cancellation) so the blocked tool proceeds or is denied. The caller clears the local queue. */
  respondPermission(sessionId: string, requestId: string, choice: { optionId: string } | { cancelled: true }): void {
    this.transport.send({ type: 'permission:respond', sessionId, requestId, ...('optionId' in choice ? { optionId: choice.optionId } : { cancelled: true }) })
  }

  /** Compact model context (summarize the middle). Optional focus steers the summary.
   *  Backend responds with compact:result (applied / noop / error). */
  compactSession(sessionId: string, focus?: string): void {
    this.transport.send({
      type: 'message:compact',
      sessionId,
      ...(focus?.trim() ? { focus: focus.trim() } : {}),
    })
  }

  /**
   * Pull the workspace diff.
   * In-flight dedupe: a second request while loading is dropped (`'deduped'`).
   */
  requestDiff(sessionId: string, base?: DiffBase): 'sent' | 'deduped' {
    const cur = useDiffStore.getState().bySession[sessionId]
    if (cur?.status === 'loading') return 'deduped'
    const b = base ?? cur?.base ?? 'session-start'
    useDiffStore.getState().setLoading(sessionId)
    this.transport.send({ type: 'fs:diff', sessionId, base: b })
    return 'sent'
  }

  /** Request a single file's full diff (for on-demand show-full). */
  requestDiffFile(sessionId: string, p: string, context: number | 'full' = 'full'): void {
    const base = useDiffStore.getState().bySession[sessionId]?.base ?? 'session-start'
    this.transport.send({ type: 'fs:diffFile', sessionId, path: p, base, context })
  }

  /** One-click `git init` for a non-repo cwd; a successful result chains a fresh diff. */
  gitInitWorkspace(sessionId: string): void {
    useDiffStore.getState().setInitPending(sessionId, true)
    this.transport.send({ type: 'fs:gitInit', sessionId })
  }

  /** Pull the checkpoint list (+ isGitRepo / current branch) for the timeline tab + tab gating. */
  requestCheckpoints(sessionId: string): void {
    if (this.e2eCheckpointSeed?.sessionId === sessionId) {
      const seed = this.e2eCheckpointSeed
      useDiffStore.getState().setCheckpoints(seed.sessionId, seed.checkpoints, true, seed.branch)
      return
    }
    this.transport.send({ type: 'git:checkpoint:list', sessionId })
  }

  /** Pull a checkpoint's diff in a given mode. Caches by `${id}|${mode}`; re-request always allowed. */
  requestCheckpointDiff(sessionId: string, checkpointId: string, mode: CheckpointMode): void {
    useDiffStore.getState().setCheckpointDiffLoading(sessionId, `${checkpointId}|${mode}`)
    this.transport.send({ type: 'git:checkpoint:diff', sessionId, checkpointId, mode })
  }

  /** Pull the session-start..HEAD commit log for the 更改 tab. */
  requestCommitLog(sessionId: string): void {
    useDiffStore.getState().setCommitLogLoading(sessionId)
    this.transport.send({ type: 'git:commitLog', sessionId })
  }

  /** Pull the branch list (+ current) for the BranchSwitcher. */
  requestBranches(sessionId: string): void {
    this.transport.send({ type: 'git:branch:list', sessionId })
  }

  /** Switch the checkout to a branch. The :result re-pulls branches + checkpoints + diff. */
  switchBranch(sessionId: string, branch: string): void {
    this.transport.send({ type: 'git:branch:switch', sessionId, branch })
  }

  /**
   * Revert the worktree to a checkpoint (worktree-only; a safety checkpoint is written first).
   * When `seedCheckpoints` is pinned for this session (E2E), auto-succeed without real git so
   * Timeline revert confirm can close deterministically (H8).
   */
  revertCheckpoint(sessionId: string, checkpointId: string): void {
    if (this.e2eCheckpointSeed?.sessionId === sessionId) {
      queueMicrotask(() => {
        this.receive({
          type: 'git:revert:result',
          sessionId,
          checkpointId,
          ok: true,
          safetyCheckpointId: `${checkpointId}:e2e-safety`,
        })
      })
      return
    }
    this.transport.send({ type: 'git:revert', sessionId, checkpointId })
  }

  lsDir(sessionId: string, path: string): void {
    this.transport.send({ type: 'fs:ls', sessionId, path })
  }

  readFile(sessionId: string, path: string): void {
    useFsStore.getState().setPreview(sessionId, { status: 'loading', path })
    this.transport.send({ type: 'fs:read', sessionId, path })
  }

  /** Start a fresh new-conversation draft (no committed session yet). */
  newConversation(surface?: Surface): void {
    useDraftStore.getState().ensureDraft(surface)
    useDraftStore.getState().setText('')
    useDomainStore.getState().deselect()
    this.rememberActiveForSurface(null)
    if (surface) {
      useUiStore.getState().setActiveView(surface)
    }
  }

  // Draft FS: fsStore is keyed by an arbitrary scope string — a committed session's
  // nanoid id, or (for an un-committed draft) its absolute cwd. The two never collide.
  /** List a directory for an un-committed draft (cwd-keyed, no session). */
  lsDraft(cwd: string, path: string): void {
    this.transport.send({ type: 'fs:lsCwd', cwd, path })
  }

  /** Read a file for an un-committed draft (cwd-keyed). Preview is keyed by cwd. */
  readDraftFile(cwd: string, path: string): void {
    useFsStore.getState().setPreview(cwd, { status: 'loading', path })
    this.transport.send({ type: 'fs:readCwd', cwd, path })
  }

  search(query: string): void {
    useDomainStore.getState().setSearching(query.trim().length > 0)
    this.transport.send({ type: 'session:search', query })
  }

  sendMessage(content: string, attachments: LocalAttachment[] = []): void {
    const text = content.trim()
    if (!text && attachments.length === 0) return
    const st = useDomainStore.getState()
    const active = st.sessions.find((s) => s.id === st.activeSessionId)
    if (active?.interrupt) { this.resume(text, attachments); return }
    let { activeSessionId } = st
    if (!activeSessionId) {
      // Commit the draft: create a real (persisted) session, then send.
      const draft = useDraftStore.getState().draft
      const config: SessionConfig = configFromDraft(draft)
      activeSessionId = this.createSession(config)
      if (draft?.cwd) useFsStore.getState().clearSession(draft.cwd)
      useDraftStore.getState().reset()
    }
    const id = nanoid()
    useDomainStore.getState().appendUserMessage(activeSessionId, id, text, attachments)
    this.transport.send({
      type: 'message:send',
      sessionId: activeSessionId,
      id,
      content: text,
      role: 'user',
      attachments: attachments.map((a) => ({ id: a.id, name: a.name, mimeType: a.mimeType, path: a.path })),
    })
  }

  /** Answer a paused turn's question: append the reply to the transcript (clears the interrupt) and
   *  send it as message:resume so the sidecar continues the loop. */
  resume(content: string, attachments: LocalAttachment[] = []): void {
    const text = content.trim()
    if (!text && attachments.length === 0) return
    const { activeSessionId } = useDomainStore.getState()
    if (!activeSessionId) return
    const id = nanoid()
    useDomainStore.getState().appendUserMessage(activeSessionId, id, text, attachments)
    this.transport.send({
      type: 'message:resume',
      sessionId: activeSessionId,
      content: text,
      ...(attachments.length ? { attachments: attachments.map((a) => ({ id: a.id, name: a.name, mimeType: a.mimeType, path: a.path })) } : {}),
    })
  }

  /** Respond to a plan approval interrupt (approve / reject / amend). */
  respondPlan(action: 'approve' | 'reject' | 'amend', amendContent?: string): void {
    const { activeSessionId } = useDomainStore.getState()
    if (!activeSessionId) return
    this.transport.send({ type: 'plan:respond', sessionId: activeSessionId, action, amendContent })
  }

  cancel(): void {
    const { activeSessionId } = useDomainStore.getState()
    if (activeSessionId) this.transport.send({ type: 'message:cancel', sessionId: activeSessionId })
  }

  regenerate(): void {
    const { activeSessionId, sessions } = useDomainStore.getState()
    if (!activeSessionId) return
    const sess = sessions.find((x) => x.id === activeSessionId)
    if (!sess) return
    if (sess.status === 'running' && !sess.interrupt) return
    // The sidecar decides whether to dispatch image turns to an internal multimodal agent.
    // The frontend no longer switches the session model.
    useDomainStore.getState().regenerateLastTurn(activeSessionId)
    this.transport.send({ type: 'message:regenerate', sessionId: activeSessionId })
  }

  /** On (re)connect, if the active session had an in-flight turn, force a history resync so a
   *  turn that finished/was interrupted during the outage is reconciled (see the session:loaded
   *  reducer). The resync REPLACES optimistic in-memory messages with the persisted truth: the
   *  user message is persisted before the turn runs (so it is never lost), and an unfinished
   *  assistant reply reconciles to "interrupted + retry" rather than a stuck spinner. */
  private resyncActiveIfRunning(): void {
    const { activeSessionId, sessions } = useDomainStore.getState()
    if (!activeSessionId) return
    const s = sessions.find((x) => x.id === activeSessionId)
    if (s?.status === 'running') this.transport.send({ type: 'session:load', sessionId: activeSessionId })
  }
}

/** Build the committed SessionConfig from the current draft. Surface is derived from the draft
 *  mode — a project draft (folder picked) is a Code conversation; a chat draft is a sandboxed
 *  Chat conversation. The Chat new-conversation view keeps chat drafts in chat mode, so the chat
 *  branch never carries a cwd/permissionMode (Chat is picker-less). */
export function configFromDraft(draft: Draft | null): SessionConfig {
  const surface: 'chat' | 'code' = draft?.mode === 'project' ? 'code' : 'chat'
  const base: SessionConfig =
    surface === 'code' && draft?.cwd
      ? { ...DEFAULT_CONFIG, surface, cwd: draft.cwd }
      : { ...DEFAULT_CONFIG, surface }
  const withMode: SessionConfig =
    surface === 'code' && draft?.permissionMode ? { ...base, permissionMode: draft.permissionMode } : base
  if (!draft?.modelKey) return withMode
  const { catalog, config } = useProvidersStore.getState()
  const { llmProvider, model, baseURL } = resolveModelConfig(catalog, config, draft.modelKey)
  return { ...withMode, llmProvider, model, ...(baseURL ? { baseURL } : {}) }
}

/** App singleton: connects to the live sidecar over WsTransport. */
export const sessionService = new SessionService(new WsTransport())

/** E2E bridge: only installed outside production builds (vite DEV / e2e). */
export type HipE2EHooks = {
  injectServerMessage: (msg: ServerMessage) => void
  simulateAgentWriteFinished: (sessionId: string) => { turnId: string; callId: string }
  getActiveSessionId: () => string | null
  createChatSessionForE2e: () => string
  createCodeSessionForE2e: (cwd: string) => string
  simulateTurnRunning: (sessionId: string) => { turnId: string; callId: string }
  simulateTurnCancelled: (sessionId: string) => void
  simulateSessionError: (sessionId: string, code?: string, message?: string) => void
  seedAgentCollaboration: (sessionId: string) => { turnId: string; callId: string }
  getSessionDebugBundleJson: () => string | null
  simulatePermissionRequest: (sessionId: string) => { turnId: string; requestId: string }
  seedCheckpoints: (sessionId: string) => { count: number }
  openCommandPaletteForE2e: () => void
  closeCommandPaletteForE2e: () => void
  simulatePluginInstallError: (error?: string) => void
  /** Cross-session memory (WS via SessionService). */
  getMemoryConfig: () => Promise<MemoryFileConfig>
  setMemoryConfig: (partial: Partial<MemoryFileConfig>) => Promise<MemoryFileConfig>
  seedMemoryItem: (
    item: Partial<MemoryItem> & Pick<MemoryItem, 'title' | 'content' | 'kind' | 'scope'>,
  ) => Promise<MemoryItem>
  listMemories: (filter?: {
    scope?: MemoryScope
    projectKeyHash?: string
    sessionId?: string
    query?: string
    limit?: number
    status?: MemoryStatus
  }) => Promise<MemoryItem[]>
  deleteMemory: (id: string, hard?: boolean) => Promise<boolean>
  restoreMemory: (id: string) => Promise<MemoryItem>
  emptyMemoryTrash: () => Promise<number>
  triggerMemoryConsolidate: (projectKeyHash?: string) => void
  getActiveSessionMemoryFlags: () => {
    useMemories?: boolean
    generateMemories?: boolean
    incognito?: boolean
  } | null
  /** E2E: read workflow store projection (product path has no dedicated DAG shell). */
  getWorkflowSession: (sessionId: string) => {
    activeWorkflow: { id: string; name: string } | null
    runId: string | null
    runStatus: string | null
    nodeStatuses: Record<string, string>
  }
}

declare global {
  interface Window {
    __hipE2E?: HipE2EHooks
  }
}

function installE2eHooks(svc: SessionService): void {
  if (typeof window === 'undefined') return
  // Production app builds must not expose inject surface.
  if (import.meta.env.PROD) return
  window.__hipE2E = {
    injectServerMessage: (msg) => svc.injectServerMessage(msg),
    simulateAgentWriteFinished: (sessionId) => svc.simulateAgentWriteFinished(sessionId),
    getActiveSessionId: () => useDomainStore.getState().activeSessionId,
    createChatSessionForE2e: () => svc.createChatSessionForE2e(),
    createCodeSessionForE2e: (cwd) => svc.createCodeSessionForE2e(cwd),
    simulateTurnRunning: (sessionId) => svc.simulateTurnRunning(sessionId),
    simulateTurnCancelled: (sessionId) => svc.simulateTurnCancelled(sessionId),
    simulateSessionError: (sessionId, code, message) => svc.simulateSessionError(sessionId, code, message),
    seedAgentCollaboration: (sessionId) => svc.seedAgentCollaboration(sessionId),
    getSessionDebugBundleJson: () => svc.getSessionDebugBundleJson(),
    simulatePermissionRequest: (sessionId) => svc.simulatePermissionRequest(sessionId),
    seedCheckpoints: (sessionId) => svc.seedCheckpoints(sessionId),
    openCommandPaletteForE2e: () => svc.openCommandPaletteForE2e(),
    closeCommandPaletteForE2e: () => svc.closeCommandPaletteForE2e(),
    simulatePluginInstallError: (error) => svc.simulatePluginInstallError(error),
    getMemoryConfig: () => svc.getMemoryConfig(),
    setMemoryConfig: (partial) => svc.setMemoryConfig(partial),
    seedMemoryItem: (item) => svc.upsertMemory(item),
    listMemories: (filter) => svc.listMemories(filter),
    deleteMemory: (id, hard) => svc.deleteMemory(id, hard),
    restoreMemory: (id) => svc.restoreMemory(id),
    emptyMemoryTrash: () => svc.emptyMemoryTrash(),
    triggerMemoryConsolidate: (projectKeyHash) => svc.consolidateMemories(projectKeyHash),
    getActiveSessionMemoryFlags: () => {
      const id = useDomainStore.getState().activeSessionId
      if (!id) return null
      const sess = useDomainStore.getState().sessions.find((s) => s.id === id)
      if (!sess) return null
      return {
        useMemories: sess.config?.useMemories,
        generateMemories: sess.config?.generateMemories,
        incognito: sess.config?.incognito,
      }
    },
    getWorkflowSession: (sessionId) => svc.getWorkflowSession(sessionId),
  }
}

installE2eHooks(sessionService)
