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
import type { Transport } from './transport'
import { MessageWaiter } from './messageWaiter'
import { MemoryWire } from './actions/memoryWire'
import { FsActions } from './actions/fsActions'
import { SessionActions } from './actions/sessionActions'
import type {
  EmptyGreetingGenerateContext,
  MemoryFileConfig,
  MemoryItem,
  MemoryScope,
  MemoryStatus,
  TestProviderRequest,
} from './actions/memoryWire'
import { E2eHooks, installE2eHooks } from './e2eHooks'
import { WsTransport } from './wsTransport'
import { useDomainStore, DEFAULT_CONFIG } from './sessionStore'
import { useUiStore, type Surface } from '@/store/uiStore'
import type { LocalAttachment } from '@/components/chat/attachmentTypes'
import { applyServerMessageEffects } from './serverMessageEffects'
import { sessionDebugBundleJson } from '@/lib/sessionDebugBundle'
import { StreamCoalescer, type CoalesceBucket, type StreamKind } from '@/lib/streamCoalesce'
import { handleTerminalBridgeMessage } from './terminalAgentBridge'

// Kept as re-exports so existing importers (incl. tests) stay unchanged.
export { currentLanguage, configFromDraft } from './actions/sessionActions'

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
  /** Session lifecycle / config / message wire actions (P4). */
  private readonly sessionActions: SessionActions

  constructor(transport: Transport) {
    this.memoryWire = new MemoryWire(transport, this.waiter)
    this.fsActions = new FsActions(transport)
    this.sessionActions = new SessionActions(transport, (msg) => this.receive(msg))
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

  createSession(config: SessionConfig = DEFAULT_CONFIG, opts?: { activate?: boolean }) {
    return this.sessionActions.createSession(config, opts)
  }

  selectSession(id: string, messageId?: string) {
    return this.sessionActions.selectSession(id, messageId)
  }

  focusTerminalAgentSession(terminalId: string, sessionId: string) {
    return this.sessionActions.focusTerminalAgentSession(terminalId, sessionId)
  }

  setSurface(view: Surface) {
    return this.sessionActions.setSurface(view)
  }

  previewSurface(view: Surface) {
    return this.sessionActions.previewSurface(view)
  }

  deleteSession(
    id: string,
    opts?: { deleteDerivedMemories?: boolean; reason?: string; meta?: Record<string, unknown> },
  ) {
    return this.sessionActions.deleteSession(id, opts)
  }

  trashSession(
    id: string,
    opts?: { deleteDerivedMemories?: boolean; reason?: string; meta?: Record<string, unknown> },
  ) {
    return this.sessionActions.trashSession(id, opts)
  }

  hardDeleteSession(
    id: string,
    opts?: { deleteDerivedMemories?: boolean; reason?: string; meta?: Record<string, unknown> },
  ) {
    return this.sessionActions.hardDeleteSession(id, opts)
  }

  restoreSession(id: string) {
    return this.sessionActions.restoreSession(id)
  }

  requestTrashList() {
    return this.sessionActions.requestTrashList()
  }

  emptySessionTrash() {
    return this.sessionActions.emptySessionTrash()
  }

  purgeSessionTrash(retentionDays?: number) {
    return this.sessionActions.purgeSessionTrash(retentionDays)
  }

  renameSession(id: string, title: string) {
    return this.sessionActions.renameSession(id, title)
  }

  setProjectDir(id: string, cwd: string) {
    return this.sessionActions.setProjectDir(id, cwd)
  }

  clearProjectDir(id: string) {
    return this.sessionActions.clearProjectDir(id)
  }

  setThinking(id: string, thinking: boolean) {
    return this.sessionActions.setThinking(id, thinking)
  }

  setEffort(id: string, effort: string | null) {
    return this.sessionActions.setEffort(id, effort)
  }

  setPermissionMode(id: string, mode: PermissionMode) {
    return this.sessionActions.setPermissionMode(id, mode)
  }

  setForcePlan(id: string, forcePlan: boolean) {
    return this.sessionActions.setForcePlan(id, forcePlan)
  }

  setExecutionMode(id: string, executionMode: ExecutionMode) {
    return this.sessionActions.setExecutionMode(id, executionMode)
  }

  setSystemPrompt(id: string, systemPrompt: string | null) {
    return this.sessionActions.setSystemPrompt(id, systemPrompt)
  }

  setOrchMode(id: string, orchMode: OrchestrationMode) {
    return this.sessionActions.setOrchMode(id, orchMode)
  }

  setActiveModel(providerID: string, modelID: string, baseURL: string) {
    return this.sessionActions.setActiveModel(providerID, modelID, baseURL)
  }

  setSessionModel(modelKey: string) {
    return this.sessionActions.setSessionModel(modelKey)
  }

  setAgentConfigOption(sessionId: string, configId: string, value: string) {
    return this.sessionActions.setAgentConfigOption(sessionId, configId, value)
  }

  setAgent(sessionId: string, agentId: string) {
    return this.sessionActions.setAgent(sessionId, agentId)
  }

  respondPermission(sessionId: string, requestId: string, choice: { optionId: string } | { cancelled: true }) {
    return this.sessionActions.respondPermission(sessionId, requestId, choice)
  }

  compactSession(sessionId: string, focus?: string) {
    return this.sessionActions.compactSession(sessionId, focus)
  }

  newConversation(surface?: Surface) {
    return this.sessionActions.newConversation(surface)
  }

  search(query: string) {
    return this.sessionActions.search(query)
  }

  sendMessage(content: string, attachments: LocalAttachment[] = []) {
    return this.sessionActions.sendMessage(content, attachments)
  }

  sendMessageToSession(
    sessionId: string,
    content: string,
    attachments: LocalAttachment[] = [],
  ) {
    return this.sessionActions.sendMessageToSession(sessionId, content, attachments)
  }

  loadSessionMessages(sessionId: string) {
    return this.sessionActions.loadSessionMessages(sessionId)
  }

  sendTerminalContext(sessionId: string) {
    return this.sessionActions.sendTerminalContext(sessionId)
  }

  getLastOutboundUserContent() {
    return this.sessionActions.getLastOutboundUserContent()
  }

  resume(content: string, attachments: LocalAttachment[] = []) {
    return this.sessionActions.resume(content, attachments)
  }

  respondPlan(action: 'approve' | 'reject' | 'amend', amendContent?: string) {
    return this.sessionActions.respondPlan(action, amendContent)
  }

  cancel() {
    return this.sessionActions.cancel()
  }

  cancelSessionTurn(sessionId: string) {
    return this.sessionActions.cancelSessionTurn(sessionId)
  }

  regenerate() {
    return this.sessionActions.regenerate()
  }

  reloadSession(sessionId: string) {
    return this.sessionActions.reloadSession(sessionId)
  }

  private resyncActiveIfRunning() {
    return this.sessionActions.resyncActiveIfRunning()
  }

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
}

/** App singleton: connects to the live sidecar over WsTransport. */
export const sessionService = new SessionService(new WsTransport())

installE2eHooks(sessionService)
