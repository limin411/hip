// src/domain/sessionService.ts
import type {
  ServerMessage,
  SessionConfig,
  DiffBase,
  DiffFileStatus,
  PermissionMode,
  OrchestrationMode,
  ExecutionMode,
} from '@hip/protocol'
import {
  normalizeSessionConfig,
  resolveExecutionMode,
  executionModeConfigPatch,
} from '@hip/protocol'
import { nanoid } from 'nanoid'
import type { Transport } from './transport'
import { MessageWaiter } from './messageWaiter'
import { MemoryWire } from './actions/memoryWire'
import { FsActions } from './actions/fsActions'
import type {
  EmptyGreetingGenerateContext,
  MemoryFileConfig,
  MemoryItem,
  MemoryScope,
  MemoryStatus,
  TestProviderRequest,
} from './actions/memoryWire'
import {
  E2eHooks,
  installE2eHooks,
  isFeOnlyPlanApproval,
  unmarkFeOnlyPlanApproval,
} from './e2eHooks'
import { WsTransport } from './wsTransport'
import { useDomainStore, DEFAULT_CONFIG } from './sessionStore'
import { useFsStore } from '@/store/fsStore'
import { useDraftStore } from '@/store/draftStore'
import type { Draft } from '@/store/draftStore'
import { useUiStore, normalizeAppLanguage, type AppLanguage, type Surface } from '@/store/uiStore'
import { useNavHistoryStore } from '@/store/navHistoryStore'
import { useDiffStore } from '@/store/diffStore'
import { useTerminalStore } from '@/store/terminalStore'
import { ptyKill } from '@/ipc/pty'
import i18n from '@/i18n'
import { resolveModelConfig, activeModelKey } from '@/lib/modelKey'
import { clampEffortForKey } from '@/lib/modelEffort'
import { useProvidersStore } from '@/store/providersStore'
import { useHipConfigStore } from '@/store/hipConfigStore'
import { resolveValidAcpAgentId } from '@/lib/sessionAgent'
import { isTerminalSession, surfaceOf } from '@/lib/sessions'
import type { LocalAttachment } from '@/components/chat/attachmentTypes'
import { applyServerMessageEffects } from './serverMessageEffects'
import { sessionDebugBundleJson } from '@/lib/sessionDebugBundle'
import { useFocusStore } from '@/store/focusStore'
import { useProjectPathStore } from '@/store/projectPathStore'
import { isProjectPathBlocked } from '@/lib/projectPathGate'
import { toast } from 'sonner'
import { auditSessionDelete, debugSessionDelete } from '@/lib/sessionDelete'
import { StreamCoalescer, type CoalesceBucket, type StreamKind } from '@/lib/streamCoalesce'
import { useTerminalAgentStore } from '@/store/terminalAgentStore'
import { useManagedTerminalStore } from '@/store/managedTerminalStore'
import { buildRoundtableOutbound } from '@/lib/roundtable'
import { handleTerminalBridgeMessage } from './terminalAgentBridge'

/**
 * Map the current i18next language to a SessionConfig-supported value.
 * Exported for unit tests — same path used when enriching session configs.
 */
export function currentLanguage(): AppLanguage {
  return normalizeAppLanguage(i18n.resolvedLanguage ?? i18n.language) ?? 'en'
}

/**
 * Optional wire fields on token:stream (added in PR-4 protocol).
 * PR-3 base types omit them; read defensively so stack onto PR-4 preserves identity.
 * Drop this helper once ServerMessage token:stream includes stepSeq/role in the union.
 */
function tokenStreamExtras(msg: ServerMessage & { type: 'token:stream' }): {
  stepSeq?: number
  role?: string
} {
  const wire = msg as { stepSeq?: number; role?: string }
  return {
    ...(typeof wire.stepSeq === 'number' ? { stepSeq: wire.stepSeq } : {}),
    ...(typeof wire.role === 'string' ? { role: wire.role } : {}),
  }
}


export class SessionService {
  private readonly transport: Transport
  private readonly unsubscribe: () => void
  private readonly unsubStatus: () => void
  private readonly streamCoalescer: StreamCoalescer
  /** One-shot ServerMessage waits (wait/waitWhere/waitFirst) shared with action modules. */
  private readonly waiter = new MessageWaiter()
  /** E2E simulation hooks (dev-only); facade forwards its simulate and seed methods here. */
  private readonly e2e = new E2eHooks(this)
  /** Cross-session memory + provider probing wire actions (P2). */
  private readonly memoryWire: MemoryWire
  /** Workspace diff / git / file-browsing wire actions (P3). */
  private readonly fsActions: FsActions
  /** E2E: last user content passed to sendMessage (annotation inject assertions). */
  private lastOutboundUserContent: string | null = null

  constructor(transport: Transport) {
    this.memoryWire = new MemoryWire(transport, this.waiter)
    this.fsActions = new FsActions(transport)
    this.transport = transport
    this.streamCoalescer = new StreamCoalescer((bucket) => this.applyCoalescedToken(bucket))
    this.unsubscribe = this.transport.onMessage((msg: ServerMessage) => this.receive(msg))
    this.unsubStatus = this.transport.onStatus((s) => useDomainStore.getState().setConnection(s))
  }

  dispose(): void {
    this.streamCoalescer.flushAll()
    this.unsubscribe()
    this.unsubStatus()
    this.waiter.dispose()
  }

  /**
   * E2E seed helper: drain coalesced token buckets so fixtures are immediately
   * visible to probes/UI (used by E2eHooks.seedSubagentPause).
   */
  flushCoalescedForE2e(sessionId: string, turnId: string): void {
    this.streamCoalescer.flushTurn(sessionId, turnId)
  }

  /** Flush coalesced token text into the store as a single token:stream apply. */
  private applyCoalescedToken(bucket: CoalesceBucket): void {
    // Map all token kinds through the existing reducer (content vs run.output).
    // Pass stepSeq/role when present so PR-4 store can upsert timeline text steps.
    const payload = {
      type: 'token:stream' as const,
      sessionId: bucket.sessionId,
      turnId: bucket.turnId,
      agentId: bucket.agentId,
      delta: bucket.text,
      ...(bucket.stepSeq >= 0 ? { stepSeq: bucket.stepSeq } : {}),
      ...(bucket.role !== undefined ? { role: bucket.role } : {}),
    }
    useDomainStore.getState().apply(payload as ServerMessage)
  }

  /** Mirror sessionStore token routing: supervisor → body, else → run.output. */
  private isSupervisorToken(sessionId: string, turnId: string, agentId: string): boolean {
    const sess = useDomainStore.getState().sessions.find((s) => s.id === sessionId)
    const turn = sess?.messages.find((m) => m.id === turnId)
    const run =
      turn?.role === 'assistant' ? turn.agentRuns?.find((r) => r.agentId === agentId) : undefined
    return run ? run.role === 'supervisor' : agentId === 'supervisor'
  }

  private tokenStreamKind(
    sessionId: string,
    turnId: string,
    agentId: string,
    stepSeq: number | undefined,
  ): { kind: StreamKind; stepSeq: number } {
    if (stepSeq != null) {
      return { kind: 'text', stepSeq }
    }
    if (this.isSupervisorToken(sessionId, turnId, agentId)) {
      return { kind: 'text-legacy', stepSeq: -1 }
    }
    return { kind: 'run-output', stepSeq: -1 }
  }

  /**
   * Barrier events must drain or discard pending token buckets before the event mutates state.
   * - tool/complete/interrupt/permission/error: flush (apply) so content is not lost
   * - session:loaded/deleted/trashed: discard without apply so persist/delete wins
   */
  private flushBeforeBarrier(msg: ServerMessage): void {
    switch (msg.type) {
      case 'tool:started':
      case 'tool:finished':
      case 'agent:interrupt':
      case 'permission:request':
      case 'agent:finished':
        // Flush so subagent speech is applied before status flips to done
        // (roundtable council streams into agentRuns via token:stream).
        this.streamCoalescer.flushTurn(msg.sessionId, msg.turnId)
        return
      case 'message:complete':
        this.streamCoalescer.flushTurn(msg.sessionId, msg.message.id)
        return
      case 'error':
        if (msg.sessionId) this.streamCoalescer.flushSession(msg.sessionId)
        else this.streamCoalescer.flushAll()
        return
      case 'session:loaded':
      case 'session:deleted':
      case 'session:trashed':
        // Authoritative replace/remove — never re-append client-buffered deltas after.
        this.streamCoalescer.clearSession(msg.sessionId)
        return
      default:
        return
    }
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
    // Terminal shared-PTY bridge requests are consumed by the UI-side bridge
    // (they must never reach the regular session store/effects pipeline).
    if (handleTerminalBridgeMessage(msg, (m) => this.transport.send(m))) {
      return
    }
    // PR-3: coalesce token:stream only. reasoning:delta applies immediately (no merge).
    if (msg.type === 'token:stream') {
      const extras = tokenStreamExtras(msg)
      const { kind, stepSeq: seq } = this.tokenStreamKind(
        msg.sessionId,
        msg.turnId,
        msg.agentId,
        extras.stepSeq,
      )
      this.streamCoalescer.push({
        sessionId: msg.sessionId,
        turnId: msg.turnId,
        agentId: msg.agentId,
        kind,
        stepSeq: seq,
        ...(extras.role !== undefined ? { role: extras.role } : {}),
        delta: msg.delta,
      })
      this.waiter.fulfill(msg)
      return
    }

    // Drain pending tokens before turn-mutating barriers so order stays correct.
    this.flushBeforeBarrier(msg)

    useDomainStore.getState().apply(msg)
    applyServerMessageEffects(msg, {
      send: (m) => this.transport.send(m),
      requestDiff: (sessionId) => this.requestDiff(sessionId),
      requestCheckpoints: (sessionId) => this.requestCheckpoints(sessionId),
      resyncActiveIfRunning: () => this.resyncActiveIfRunning(),
    })
    // After the session catalog lands (or re-lands on reconnect), re-attach open title-bar
    // tabs from localStorage. Cold launch stays on New Conversation; live reconnect keeps selection.
    if (msg.type === 'session:list:result') {
      try {
        const bySurface = msg.sessions.reduce(
          (acc, s) => {
            acc[s.surface] = (acc[s.surface] ?? 0) + 1
            return acc
          },
          {} as Record<string, number>,
        )
        // eslint-disable-next-line no-console
        console.info('[hip][session-list] result', {
          count: msg.sessions.length,
          bySurface,
          ids: msg.sessions.slice(0, 40).map((s) => s.id),
          activeSessionId: useDomainStore.getState().activeSessionId,
        })
      } catch {
        /* logging must never crash receive */
      }
      this.restoreOpenTabsFromPersistence()
      // Automation orphan recovery: only after session catalog is authoritative
      // (design: sessionListReady post session:list:result). Dynamic import avoids
      // sessionService ↔ automationStore init cycles.
      void import('@/store/automationStore')
        .then(({ useAutomationStore }) => {
          const st = useAutomationStore.getState()
          st.markSessionListReady()
          void st.recoverOrphanRuns()
        })
        .catch(() => {
          /* automation store optional at boot */
        })
    }
    this.waiter.fulfill(msg)
  }

  /**
   * Wait for hip-ui rehydration (surface pointers) then prune stale ids.
   * session:list:result can race persist rehydrate on cold start.
   */
  private restoreOpenTabsFromPersistence(): void {
    const run = () => this.pruneSurfacePointersFromList()
    const api = useUiStore.persist
    if (api.hasHydrated()) {
      run()
      return
    }
    api.onFinishHydration(run)
  }

  /**
   * Prune chatSessionId / codeSessionId to sessions that still exist.
   * Cold launch does not auto-select a conversation; reconnect with a live
   * activeSessionId keeps that selection. Surface pointers stay for mid-session switching.
   */
  private pruneSurfacePointersFromList(): void {
    const sessions = useDomainStore.getState().sessions
    const existing = new Set(sessions.map((s) => s.id))
    const ui = useUiStore.getState()

    if (ui.chatSessionId != null && !existing.has(ui.chatSessionId)) {
      ui.setChatSessionId(null)
    }
    if (ui.codeSessionId != null && !existing.has(ui.codeSessionId)) {
      ui.setCodeSessionId(null)
    }

    const active = useDomainStore.getState().activeSessionId
    if (active != null && existing.has(active)) {
      return
    }

    // Cold launch / reconnect with no active session: New Conversation.
    // Force-clear knowledge (and other non-chat shells) + any residual overlay.
    const st = useUiStore.getState()
    const special =
      st.activeView === 'knowledge' ||
      st.activeView === 'terminals' ||
      st.activeView === 'tasks' ||
      st.activeView === 'automation'
    if (special || st.overlay != null) {
      useUiStore.setState({
        activeView: 'chat',
        sidebarSection: 'chats',
        overlay: null,
      })
    }
    useDomainStore.getState().deselect()
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

  getWorkflowSession(sessionId: string) {
    return this.e2e.getWorkflowSession(sessionId)
  }

  simulateAgentWriteFinished(
    sessionId: string,
    opts?: { path?: string },
  ) {
    return this.e2e.simulateAgentWriteFinished(sessionId, opts)
  }

  simulateEditWithDiff(
    sessionId: string,
    opts?: { path?: string },
  ) {
    return this.e2e.simulateEditWithDiff(sessionId, opts)
  }

  simulateToolStarted(
    sessionId: string,
    opts?: { name?: string; path?: string },
  ) {
    return this.e2e.simulateToolStarted(sessionId, opts)
  }

  createChatSessionForE2e() {
    return this.e2e.createChatSessionForE2e()
  }

  createCodeSessionForE2e(cwd: string) {
    return this.e2e.createCodeSessionForE2e(cwd)
  }

  simulateTurnRunning(sessionId: string) {
    return this.e2e.simulateTurnRunning(sessionId)
  }

  simulateTurnCancelled(sessionId: string) {
    return this.e2e.simulateTurnCancelled(sessionId)
  }

  simulateSessionError(
    sessionId: string,
    code = 'AGENT_ERROR',
    message = 'e2e simulated error',
  ) {
    return this.e2e.simulateSessionError(sessionId, code, message)
  }

  seedAgentCollaboration(sessionId: string) {
    return this.e2e.seedAgentCollaboration(sessionId)
  }

  simulatePermissionRequest(sessionId: string) {
    return this.e2e.simulatePermissionRequest(sessionId)
  }

  seedSubagentPause(sessionId: string) {
    return this.e2e.seedSubagentPause(sessionId)
  }

  seedAgentInterrupt(sessionId: string, question = 'How should I proceed with the e2e task?') {
    return this.e2e.seedAgentInterrupt(sessionId, question)
  }

  seedPlanApproval(
    sessionId: string,
    opts?: { markdown?: string; planPath?: string },
  ) {
    return this.e2e.seedPlanApproval(sessionId, opts)
  }

  seedPlanProgress(
    sessionId: string,
    opts?: { complete?: boolean },
  ) {
    return this.e2e.seedPlanProgress(sessionId, opts)
  }

  seedBackgroundTaskKilled(sessionId: string) {
    return this.e2e.seedBackgroundTaskKilled(sessionId)
  }

  seedRuntimeTask(sessionId: string, opts: { kind?: 'shell' | 'agent' | 'monitor' | 'schedule'; status?: 'running' | 'scheduled' | 'completed'; description?: string } = {}) {
    return this.e2e.seedRuntimeTask(sessionId, opts)
  }

  simulateInvalidWorkflowError(
    sessionId: string,
    reason = 'workflow nodes of type tool|human are not supported',
  ) {
    return this.e2e.simulateInvalidWorkflowError(sessionId, reason)
  }

  getLastAssistantText(sessionId: string) {
    return this.e2e.getLastAssistantText(sessionId)
  }

  getPendingInterrupt(sessionId: string) {
    return this.e2e.getPendingInterrupt(sessionId)
  }

  openCommandPaletteForE2e() {
    return this.e2e.openCommandPaletteForE2e()
  }

  closeCommandPaletteForE2e() {
    return this.e2e.closeCommandPaletteForE2e()
  }

  openSettingsPageForE2e(page = 'general') {
    return this.e2e.openSettingsPageForE2e(page)
  }

  openHistoryPageForE2e() {
    return this.e2e.openHistoryPageForE2e()
  }

  openTrashPageForE2e() {
    return this.e2e.openTrashPageForE2e()
  }

  closeOverlayForE2e() {
    return this.e2e.closeOverlayForE2e()
  }

  simulatePluginInstallError(error = 'e2e package structure invalid') {
    return this.e2e.simulatePluginInstallError(error)
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
      ui: {
        status: session.status,
        planApprovalPending: Boolean(session.planApprovalPending),
        interrupt: session.interrupt ?? null,
        activeTurnPlan: session.activeTurnPlan ?? null,
        forcePlan: Boolean(session.config.forcePlan),
      },
    })
  }

  /**
   * Create a session and notify the sidecar.
   * `activate` defaults true (sets activeSessionId + surface pointer) for back-compat.
   * Pass `{ activate: false }` for background automation so the open chat is not stolen.
   */
  createSession(config: SessionConfig = DEFAULT_CONFIG, opts?: { activate?: boolean }): string {
    const id = nanoid()
    const enriched: SessionConfig = normalizeSessionConfig({ ...config, language: currentLanguage() })
    const activate = opts?.activate !== false
    useDomainStore.getState().createSession(id, enriched, { activate })
    if (activate) {
      this.rememberActiveForSurface(id)
    }
    this.transport.send({ type: 'session:create', id, config: enriched })
    return id
  }

  selectSession(id: string, messageId?: string): void {
    // Terminal agent conversations are owned by the terminal session tree (§7.3 rule 1):
    // never steal the chat/code active pointer and never switch the work surface away
    // from terminals. The right-rail Agent tab + sidebar child rows are the entry points.
    const terminalCandidate = useDomainStore.getState().sessions.find((x) => x.id === id)
    if (terminalCandidate && isTerminalSession(terminalCandidate.config)) {
      const tmId = terminalCandidate.config.managedTerminalId
      if (tmId) {
        this.focusTerminalAgentSession(tmId, id)
        if (!terminalCandidate.loaded) {
          this.transport.send({ type: 'session:load', sessionId: id })
        }
      }
      return
    }
    useDomainStore.getState().selectSession(id)
    useUiStore.getState().setSelectedArtifactPath(null)
    const s = useDomainStore.getState().sessions.find((x) => x.id === id)
    if (s) {
      const surface = surfaceOf(s.config)
      useUiStore.getState().setActiveView(surface === 'code' ? 'code' : 'chat')
      useUiStore.getState().setSidebarSection(surface === 'code' ? 'projects' : 'chats')
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
    // Shell back/forward stack (ChatGPT-style). Skip while applying history.
    // Dynamic import of record helper avoids sessionService ↔ layout init cycles.
    if (!useNavHistoryStore.getState().applying) {
      void import('@/components/layout/navHistory').then(({ recordNavEntry }) => {
        recordNavEntry()
      })
    }
  }

  /**
   * Dual-track focus for a terminal agent session (spec §3.5.4 / §7.3):
   * focus the parent `tm_*`, keep `activeView === 'terminals'`, open the right rail
   * on the agent tab, set the per-terminal active session, and note the context switch (D11).
   */
  focusTerminalAgentSession(terminalId: string, sessionId: string): void {
    const ui = useUiStore.getState()
    const prevActive = useTerminalAgentStore.getState().getActiveSession(terminalId)
    useManagedTerminalStore.getState().focus(terminalId)
    ui.setActiveView('terminals')
    ui.setSidebarSection('terminals')
    ui.setTerminalPanelOpen(true)
    ui.setTerminalPanelTab(terminalId, 'agent')
    useTerminalAgentStore.getState().setActiveSession(terminalId, sessionId)
    if (prevActive && prevActive !== sessionId) {
      // D11: terminal state may have changed since the previous conversation.
      this.transport.send({
        type: 'session:terminalContext',
        sessionId,
        note: 'Terminal state may have changed since the last message; recent output may belong to another conversation on this terminal. Check current terminal output before acting.',
      })
    }
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
    useUiStore.getState().setSidebarSection(view === 'code' ? 'projects' : 'chats')
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

  /**
   * Soft-delete a session into the product recycle bin (History / sidebar / clear-all / cascade).
   * Live runtime + PTY tear down; SQLite messages and scratch stay until hard purge.
   * Always send `reason` so sidecar audit logs can attribute mass wipes.
   */
  deleteSession(
    id: string,
    opts?: { deleteDerivedMemories?: boolean; reason?: string; meta?: Record<string, unknown> },
  ): void {
    this.trashSession(id, opts)
  }

  /** Soft-delete → recycle bin (`session:softDelete`). */
  trashSession(
    id: string,
    opts?: { deleteDerivedMemories?: boolean; reason?: string; meta?: Record<string, unknown> },
  ): void {
    const reason = opts?.reason ?? 'unknown'
    const snap = useDomainStore.getState().sessions.find((s) => s.id === id)
    auditSessionDelete('request', {
      sessionId: id,
      reason,
      soft: true,
      title: snap?.title,
      surface: snap ? surfaceOf(snap.config) : undefined,
      cwd: snap?.config.cwd,
      activeSessionId: useDomainStore.getState().activeSessionId,
      activeView: useUiStore.getState().activeView,
      sessionsBefore: useDomainStore.getState().sessions.length,
      stack: new Error().stack?.split('\n').slice(1, 8).join(' | '),
      ...opts?.meta,
    })
    debugSessionDelete('local trash + softDelete transport', { sessionId: id, reason })

    useDomainStore.getState().deleteSession(id)
    void import('@/store/trashBadgeStore').then(({ useTrashBadgeStore }) => {
      useTrashBadgeStore.getState().adjustSessions(1)
    })
    // Tear down live terminal; scratch dir stays on disk for restore.
    void ptyKill(id).catch(() => {})
    useTerminalStore.getState().clearSession(id)
    if (useUiStore.getState().chatSessionId === id) useUiStore.getState().setChatSessionId(null)
    if (useUiStore.getState().codeSessionId === id) useUiStore.getState().setCodeSessionId(null)
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
      type: 'session:softDelete',
      sessionId: id,
      reason,
      ...(opts?.deleteDerivedMemories ? { deleteDerivedMemories: true } : {}),
    })
  }

  /**
   * Permanent hard-delete (`session:delete`). Used by Recycle Bin "Delete forever" / Empty.
   */
  hardDeleteSession(
    id: string,
    opts?: { deleteDerivedMemories?: boolean; reason?: string; meta?: Record<string, unknown> },
  ): void {
    const reason = opts?.reason ?? 'trash-permanent'
    auditSessionDelete('request', {
      sessionId: id,
      reason,
      hard: true,
      activeSessionId: useDomainStore.getState().activeSessionId,
      activeView: useUiStore.getState().activeView,
      sessionsBefore: useDomainStore.getState().sessions.length,
      stack: new Error().stack?.split('\n').slice(1, 8).join(' | '),
      ...opts?.meta,
    })
    useDomainStore.getState().deleteSession(id)
    void import('@/store/trashBadgeStore').then(({ useTrashBadgeStore }) => {
      useTrashBadgeStore.getState().adjustSessions(-1)
    })
    void ptyKill(id).catch(() => {})
    useTerminalStore.getState().clearSession(id)
    this.transport.send({
      type: 'session:delete',
      sessionId: id,
      reason,
      ...(opts?.deleteDerivedMemories ? { deleteDerivedMemories: true } : {}),
    })
  }

  /** Restore a soft-deleted session from the recycle bin. */
  restoreSession(id: string): void {
    this.transport.send({ type: 'session:restore', sessionId: id })
  }

  /** Request trash list (also opportunistic purge on sidecar). */
  requestTrashList(): void {
    this.transport.send({ type: 'session:trash:list' })
  }

  /** Empty all soft-deleted sessions (hard). */
  emptySessionTrash(): void {
    this.transport.send({ type: 'session:trash:empty' })
  }

  /** Run session trash retention once with optional override. */
  purgeSessionTrash(retentionDays?: number): void {
    this.transport.send({
      type: 'session:trash:purge',
      ...(retentionDays != null ? { retentionDays } : {}),
    })
  }

  // ── Cross-session memory ──────────────────────────────────────────────────

  /**
   * Probe whether a provider (or memory endpoint) API key works.
   * Product A: provider-key usability, not per-model entitlement.
   */


  async testProvider(req: TestProviderRequest, timeoutMs = 20_000) {
    return this.memoryWire.testProvider(req, timeoutMs)
  }

  async getMemoryConfig() {
    return this.memoryWire.getMemoryConfig()
  }

  async setMemoryConfig(config: Partial<MemoryFileConfig>) {
    return this.memoryWire.setMemoryConfig(config)
  }

  async getMemoryIndexStatus() {
    return this.memoryWire.getMemoryIndexStatus()
  }

  async reindexMemories() {
    return this.memoryWire.reindexMemories()
  }

  async listMemories(filter?: {
    scope?: MemoryScope
    projectKeyHash?: string
    sessionId?: string
    query?: string
    limit?: number
    status?: MemoryStatus
  }) {
    return this.memoryWire.listMemories(filter)
  }

  async upsertMemory(
    item: Partial<MemoryItem> & Pick<MemoryItem, 'title' | 'content' | 'kind' | 'scope'>,
  ) {
    return this.memoryWire.upsertMemory(item)
  }

  async deleteMemory(id: string, hard?: boolean) {
    return this.memoryWire.deleteMemory(id, hard)
  }

  async deleteMemoriesBySourceSession(sessionId: string, soft?: boolean) {
    return this.memoryWire.deleteMemoriesBySourceSession(sessionId, soft)
  }

  async restoreMemory(id: string) {
    return this.memoryWire.restoreMemory(id)
  }

  async emptyMemoryTrash() {
    return this.memoryWire.emptyMemoryTrash()
  }

  async exportMemories(format: 'jsonl' | 'markdown' = 'jsonl') {
    return this.memoryWire.exportMemories(format)
  }

  async importMemories(data: string) {
    return this.memoryWire.importMemories(data)
  }

  async consolidateMemories(projectKeyHash?: string) {
    return this.memoryWire.consolidateMemories(projectKeyHash)
  }

  async getMemoryStatus(opts?: {
    projectKeyHash?: string
    contextWindowTokens?: number
  }) {
    return this.memoryWire.getMemoryStatus(opts)
  }

  async rewriteMemoryMirrors(projectKeyHash?: string) {
    return this.memoryWire.rewriteMemoryMirrors(projectKeyHash)
  }

  async importMemoryMirror(opts?: {
    projectKeyHash?: string
    conflict?: 'keep' | 'overwrite'
  }) {
    return this.memoryWire.importMemoryMirror(opts)
  }

  listRuntimeTasks(sessionId: string) {
    return this.memoryWire.listRuntimeTasks(sessionId)
  }

  stopRuntimeTask(sessionId: string, taskId: string, reason?: string) {
    return this.memoryWire.stopRuntimeTask(sessionId, taskId, reason)
  }

  setMemoryFlags(
    sessionId: string,
    flags: { useMemories?: boolean; generateMemories?: boolean; incognito?: boolean },
  ) {
    return this.memoryWire.setMemoryFlags(sessionId, flags)
  }

  async generateEmptyGreeting(opts: {
    requestId?: string
    providerID?: string
    modelID?: string
    context: EmptyGreetingGenerateContext
    timeoutMs?: number
  }) {
    return this.memoryWire.generateEmptyGreeting(opts)
  }
  /** Send a raw client message (TaskRuntime control plane). */
  sendClient(msg: import('@hip/protocol').ClientMessage): void {
    this.transport.send(msg)
  }

  renameSession(id: string, title: string): void {
    useDomainStore.getState().renameSession(id, title)
    this.transport.send({ type: 'session:rename', sessionId: id, title })
  }

  setProjectDir(id: string, cwd: string): void {
    const prevCwd = useDomainStore.getState().sessions.find((s) => s.id === id)?.config.cwd
    useDomainStore.getState().apply({ type: 'session:cwd', sessionId: id, cwd }) // optimistic
    useFsStore.getState().clearSession(id)
    useDiffStore.getState().clearSession(id)
    // Terminal: kill old shell + clear ring; TerminalView re-opens on cwd change if tab visible.
    void ptyKill(id).catch(() => {})
    useTerminalStore.getState().clearSession(id)
    // Path existence cache: old path may still be missing; new path is known-ok when non-empty.
    useProjectPathStore.getState().invalidate(prevCwd)
    if (cwd.trim()) useProjectPathStore.getState().markOk(cwd)
    else useProjectPathStore.getState().invalidate(cwd)
    this.transport.send({ type: 'session:setCwd', sessionId: id, cwd })
  }

  /** Unbind the project folder (clear cwd) while keeping the session and history. */
  clearProjectDir(id: string): void {
    this.setProjectDir(id, '')
  }

  setThinking(id: string, thinking: boolean): void {
    useDomainStore.getState().apply({ type: 'session:thinking', sessionId: id, thinking }) // optimistic
    this.transport.send({ type: 'session:setThinking', sessionId: id, thinking })
  }

  /** Set reasoning effort for the session (null clears to provider default). */
  setEffort(id: string, effort: string | null): void {
    useDomainStore.getState().apply({ type: 'session:effort', sessionId: id, effort }) // optimistic
    this.transport.send({ type: 'session:setEffort', sessionId: id, effort })
  }

  setPermissionMode(id: string, mode: PermissionMode): void {
    const sess = useDomainStore.getState().sessions.find((s) => s.id === id)
    const clearAuto =
      mode !== 'full' &&
      (sess?.config.executionMode === 'autopilot' ||
        resolveExecutionMode(sess?.config ?? {}) === 'autopilot')
    useDomainStore.getState().apply({ type: 'session:permissionMode', sessionId: id, permissionMode: mode }) // optimistic
    if (clearAuto) {
      useDomainStore.getState().apply({
        type: 'session:executionMode',
        sessionId: id,
        executionMode: 'interactive',
      })
      // Spec §4.0b: toast when leaving full drops Autopilot
      toast.message(i18n.t('chat.executionMode.autopilotClearedTitle'), {
        description: i18n.t('chat.executionMode.autopilotClearedBody'),
      })
    }
    this.transport.send({ type: 'session:setPermissionMode', sessionId: id, permissionMode: mode })
  }

  /** Force plan/execute/verify for subsequent turns (product /plan chip and slash). */
  setForcePlan(id: string, forcePlan: boolean): void {
    useDomainStore.getState().apply({ type: 'session:forcePlan', sessionId: id, forcePlan }) // optimistic
    this.transport.send({ type: 'session:setForcePlan', sessionId: id, forcePlan })
  }

  /**
   * Collaboration mode (interactive | plan | autopilot). Dual-writes forcePlan.
   * Autopilot requires permissionMode full — returns false without sending if invalid.
   */
  setExecutionMode(id: string, executionMode: ExecutionMode): boolean {
    const sess = useDomainStore.getState().sessions.find((s) => s.id === id)
    if (executionMode === 'autopilot' && (sess?.config.permissionMode ?? 'edit') !== 'full') {
      return false
    }
    useDomainStore.getState().apply({ type: 'session:executionMode', sessionId: id, executionMode }) // optimistic
    this.transport.send({ type: 'session:setExecutionMode', sessionId: id, executionMode })
    return true
  }

  setSystemPrompt(id: string, systemPrompt: string | null): void {
    useDomainStore.getState().apply({ type: 'session:systemPrompt', sessionId: id, systemPrompt }) // optimistic
    this.transport.send({ type: 'session:setSystemPrompt', sessionId: id, systemPrompt })
  }

  /**
   * @deprecated Agent-driven orchestration ignores orchMode for turn routing.
   * Kept for protocol compatibility with old clients; product UI does not call this.
   * Sidecar still stores the field and echoes `session:orchMode` (optionally with
   * `ignoredForTurnRouting: true`). Does not imply `pendingWorkflowDef` / workflow turns.
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
    const { activeSessionId, sessions } = useDomainStore.getState()
    if (!activeSessionId) return
    const { catalog, config } = useProvidersStore.getState()
    const { llmProvider, model, baseURL } = resolveModelConfig(catalog, config, modelKey)
    // Optimistic — the sidecar echoes session:model to confirm.
    useDomainStore.getState().apply({ type: 'session:model', sessionId: activeSessionId, llmProvider, model })
    this.transport.send({ type: 'session:setModel', sessionId: activeSessionId, llmProvider, model, baseURL })

    // Effort is model-specific (OpenAI has none/xhigh; Anthropic has max; many models have none).
    // Clamp or clear so a leftover `max` is never sent to a model that does not advertise it.
    const prev = sessions.find((s) => s.id === activeSessionId)?.config.effort
    const next = clampEffortForKey(catalog, modelKey, prev)
    if (next !== prev && (next !== undefined || prev !== undefined)) {
      this.setEffort(activeSessionId, next ?? null)
    }
  }

  /** Switch a live ACP-agent config selector (model/mode); the agent re-advertises via agent:configOptions. */
  setAgentConfigOption(sessionId: string, configId: string, value: string): void {
    this.transport.send({ type: 'agent:setConfigOption', sessionId, configId, value })
  }

  /**
   * Mid-session primary agent switch. Sidecar rejects with BUSY while a turn is running.
   * Success is applied via session:agentChanged field-echo (no optimistic config write).
   * Pass `'builtin'` or `''` to clear external primary.
   */
  setAgent(sessionId: string, agentId: string): void {
    this.transport.send({ type: 'session:setAgent', sessionId, agentId })
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


  requestDiff(sessionId: string, base?: DiffBase, ignoreWhitespace?: boolean) {
    return this.fsActions.requestDiff(sessionId, base, ignoreWhitespace)
  }

  requestDiffFile(sessionId: string, p: string, context: number | 'full' = 'full') {
    return this.fsActions.requestDiffFile(sessionId, p, context)
  }

  gitInitWorkspace(sessionId: string) {
    return this.fsActions.gitInitWorkspace(sessionId)
  }

  requestCheckpoints(sessionId: string) {
    return this.fsActions.requestCheckpoints(sessionId)
  }

  requestCommitLog(sessionId: string) {
    return this.fsActions.requestCommitLog(sessionId)
  }

  requestCommitDiff(sessionId: string, sha: string) {
    return this.fsActions.requestCommitDiff(sessionId, sha)
  }

  discardFile(sessionId: string, path: string, status: DiffFileStatus, oldPath?: string) {
    return this.fsActions.discardFile(sessionId, path, status, oldPath)
  }

  requestBranches(sessionId: string) {
    return this.fsActions.requestBranches(sessionId)
  }

  switchBranch(sessionId: string, branch: string) {
    return this.fsActions.switchBranch(sessionId, branch)
  }

  lsDir(sessionId: string, path: string) {
    return this.fsActions.lsDir(sessionId, path)
  }

  readFile(sessionId: string, path: string) {
    return this.fsActions.readFile(sessionId, path)
  }

  lsDraft(cwd: string, path: string) {
    return this.fsActions.lsDraft(cwd, path)
  }

  readDraftFile(cwd: string, path: string) {
    return this.fsActions.readDraftFile(cwd, path)
  }
  /** Start a fresh new-conversation draft (no committed session yet). */
  newConversation(surface?: Surface): void {
    useDraftStore.getState().ensureDraft(surface)
    useDraftStore.getState().setText('')
    useDomainStore.getState().deselect()
    this.rememberActiveForSurface(null)
    if (surface) {
      useUiStore.getState().setActiveView(surface)
      useUiStore.getState().setSidebarSection(surface === 'code' ? 'projects' : 'chats')
    }
    if (!useNavHistoryStore.getState().applying) {
      void import('@/components/layout/navHistory').then(({ recordNavEntry }) => {
        recordNavEntry()
      })
    }
  }


  search(query: string): void {
    useDomainStore.getState().setSearching(query.trim().length > 0)
    this.transport.send({ type: 'session:search', query })
  }

  sendMessage(content: string, attachments: LocalAttachment[] = []): void {
    let text = content.trim()
    if (!text && attachments.length === 0) return
    const st = useDomainStore.getState()
    const active = st.sessions.find((s) => s.id === st.activeSessionId)
    // KD-8 / KD-PA-1: planApprovalPending → amend only (never soft-approve via resume).
    // [plan] softApproveOnComposer is deprecated: still parsed for back-compat, FE ignores.
    // Product CTA is sticky panel plan:respond; composer is blocked in InputBar.
    if (active?.planApprovalPending) {
      // Amend is text-only over plan:respond (attachments not on wire).
      this.respondPlan('amend', text || undefined)
      return
    }
    // Non-plan interrupt continues via message:resume.
    if (active?.interrupt) { this.resume(text, attachments); return }
    let { activeSessionId } = st
    if (!activeSessionId) {
      // Commit the draft: create a real (persisted) session, then send.
      const draft = useDraftStore.getState().draft
      // Code drafts must bind a project folder before the first message.
      if (draft?.mode === 'project' && !draft.cwd?.trim()) {
        toast.error(i18n.t('chat.missingProject.sendBlocked'))
        return
      }
      // Chat empty-state one-shot: wrap first message when roundtable is armed.
      // Agent still owns route-to-normal for simple topics (see roundtable frame).
      if (draft?.roundtable && draft.mode !== 'project' && text) {
        text = buildRoundtableOutbound(text, currentLanguage())
      }
      const config: SessionConfig = configFromDraft(draft)
      activeSessionId = this.createSession(config)
      if (draft?.cwd) useFsStore.getState().clearSession(draft.cwd)
      useDraftStore.getState().reset()
    } else if (active) {
      // Existing code sessions cannot send without a live project folder.
      const pathStatus = useProjectPathStore.getState().statusOf(active.config.cwd)
      if (isProjectPathBlocked(active.config, pathStatus)) {
        toast.error(i18n.t('chat.missingProject.sendBlocked'))
        return
      }
    }
    this.lastOutboundUserContent = text
    const id = nanoid()
    // New user turn: re-enable write-follow / panel auto-open for this turn.
    useFocusStore.getState().resetFollowForTurn()
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

  /**
   * Send a user message to an explicit session without reading or changing activeSessionId.
   * Used by automation background fires (createSession activate:false + this).
   *
   * Intentionally thin vs `sendMessage`:
   * - No plan-approval amend / interrupt resume (composer path only)
   * - No draft commit / project-path gates — caller must ensure a sendable config
   *   (e.g. buildSessionConfigFromAutomation; code templates require a project cwd)
   * - No-ops (no wire) when sessionId is unknown in the domain store
   */
  sendMessageToSession(
    sessionId: string,
    content: string,
    attachments: LocalAttachment[] = [],
  ): void {
    const text = content.trim()
    if (!text && attachments.length === 0) return
    if (!useDomainStore.getState().sessions.some((s) => s.id === sessionId)) return
    const id = nanoid()
    useDomainStore.getState().appendUserMessage(sessionId, id, text, attachments)
    this.transport.send({
      type: 'message:send',
      sessionId,
      id,
      content: text,
      role: 'user',
      attachments: attachments.map((a) => ({ id: a.id, name: a.name, mimeType: a.mimeType, path: a.path })),
    })
  }

  /** Fetch history for a session without focusing it (terminal agent panel). */
  loadSessionMessages(sessionId: string): void {
    const s = useDomainStore.getState().sessions.find((x) => x.id === sessionId)
    if (s && !s.loaded) {
      this.transport.send({ type: 'session:load', sessionId })
    }
  }

  /** Push the current ring tail (P1 TerminalContextInjector) for a terminal session. */
  sendTerminalContext(sessionId: string): void {
    const sess = useDomainStore.getState().sessions.find((s) => s.id === sessionId)
    if (!sess || !isTerminalSession(sess.config) || !sess.config.managedTerminalId) return
    const tmId = sess.config.managedTerminalId
    const ring = useTerminalStore.getState().getSession(tmId)
    if (!ring) return
    const tailStart = Math.max(0, ring.trimOffset + ring.ring.length - 4096)
    const { output } = useTerminalStore.getState().getRingSince(tmId, tailStart)
    this.transport.send({ type: 'session:terminalContext', sessionId, ringTail: output })
  }

  getLastOutboundUserContent(): string | null {
    return this.lastOutboundUserContent
  }

  /** Answer a paused turn's question: append the reply to the transcript (clears the interrupt) and
   *  send it as message:resume so the sidecar continues the loop. */
  resume(content: string, attachments: LocalAttachment[] = []): void {
    const text = content.trim()
    if (!text && attachments.length === 0) return
    const { activeSessionId } = useDomainStore.getState()
    if (!activeSessionId) return
    const id = nanoid()
    useFocusStore.getState().resetFollowForTurn()
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
    const { activeSessionId, sessions } = useDomainStore.getState()
    if (!activeSessionId) return
    const sess = sessions.find((s) => s.id === activeSessionId)
    // Idempotent: ignore double-clicks after optimistic dismiss (eval multi-pump / UI re-entry).
    if (!sess?.planApprovalPending) return
    // Drop PlanApprovalCard immediately so eval/UI do not keep a disabled shell for the whole execute turn.
    useDomainStore.getState().respondPlanOptimistic(activeSessionId, action)
    // FE-only seed (seedPlanApproval): no sidecar pause — complete locally so KD-16
    // does not restore the card via not_awaiting from a real plan:respond.
    if (isFeOnlyPlanApproval(activeSessionId)) {
      unmarkFeOnlyPlanApproval(activeSessionId)
      this.receive({
        type: 'plan:respond:result',
        sessionId: activeSessionId,
        ok: true,
        action,
      })
      return
    }
    this.transport.send({ type: 'plan:respond', sessionId: activeSessionId, action, amendContent })
  }

  cancel(): void {
    const { activeSessionId } = useDomainStore.getState()
    if (activeSessionId) this.transport.send({ type: 'message:cancel', sessionId: activeSessionId })
  }

  /** Cancel a turn for an explicit session (terminal agent panel Stop turn). */
  cancelSessionTurn(sessionId: string): void {
    this.transport.send({ type: 'message:cancel', sessionId })
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

  /** Reload session messages from sidecar (also triggers plan-approval resync D4c.1). */
  reloadSession(sessionId: string): void {
    this.transport.send({ type: 'session:load', sessionId })
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
    if (s?.status === 'running') this.reloadSession(activeSessionId)
  }
}

/** Build the committed SessionConfig from the current draft. Surface is derived from the draft
 *  mode — a project draft (folder picked) is a Code conversation; a chat draft is a sandboxed
 *  Chat conversation. The Chat new-conversation view keeps chat drafts in chat mode, so the chat
 *  branch never carries a cwd (Chat is picker-less); the only chat permission override is
 *  controlPermission, which lifts the sandbox to full machine access ('full'). */
export function configFromDraft(draft: Draft | null): SessionConfig {
  const surface: 'chat' | 'code' = draft?.mode === 'project' ? 'code' : 'chat'
  const agents = useHipConfigStore.getState().config.agents ?? []
  // Only emit agentId when the id still names an enabled ACP-capable agent (stale drafts omit).
  const externalAgentId = resolveValidAcpAgentId(draft?.agentId, agents)
  const base: SessionConfig =
    surface === 'code' && draft?.cwd
      ? { ...DEFAULT_CONFIG, surface, cwd: draft.cwd }
      : { ...DEFAULT_CONFIG, surface }
  const withMode: SessionConfig =
    surface === 'code' && draft?.permissionMode
      ? { ...base, permissionMode: draft.permissionMode }
      : surface === 'chat' && draft?.controlPermission
        ? { ...base, permissionMode: 'full' }
        : base
  // executionMode / forcePlan are hip-graph only — skip when ACP primary.
  let withPlan: SessionConfig = withMode
  if (surface === 'code' && !externalAgentId) {
    const mode = resolveExecutionMode({
      executionMode: draft?.executionMode,
      forcePlan: draft?.forcePlan,
      permissionMode: draft?.permissionMode ?? withMode.permissionMode,
    })
    if (mode !== 'interactive') {
      withPlan = { ...withMode, ...executionModeConfigPatch(mode) }
    }
  }
  const { catalog, config } = useProvidersStore.getState()
  // Clamp effort to the model that will actually run (draft modelKey or global active).
  // Hip model/effort are unused on ACP primary; omit so SessionConfig stays clean.
  if (externalAgentId) {
    return { ...withPlan, agentId: externalAgentId }
  }
  const modelKey = draft?.modelKey ?? activeModelKey(config)
  const effort = clampEffortForKey(catalog, modelKey, draft?.effort)
  const withEffort: SessionConfig = effort ? { ...withPlan, effort } : withPlan
  if (!draft?.modelKey) return withEffort
  const { llmProvider, model, baseURL } = resolveModelConfig(catalog, config, draft.modelKey)
  return { ...withEffort, llmProvider, model, ...(baseURL ? { baseURL } : {}) }
}

/** App singleton: connects to the live sidecar over WsTransport. */
export const sessionService = new SessionService(new WsTransport())


installE2eHooks(sessionService)
