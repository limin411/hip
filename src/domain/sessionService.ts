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
  WorktreeSource,
  WorktreeRemoveErrorCode,
  EmptyGreetingGenerateContext,
} from '@hip/protocol'
import { normalizeSessionConfig } from '@hip/protocol'
import { nanoid } from 'nanoid'
import type { Transport } from './transport'
import { WsTransport } from './wsTransport'
import { useDomainStore, DEFAULT_CONFIG } from './sessionStore'
import { useFsStore } from '@/store/fsStore'
import { useDraftStore } from '@/store/draftStore'
import type { Draft } from '@/store/draftStore'
import { useUiStore, normalizeAppLanguage, type AppLanguage, type Surface } from '@/store/uiStore'
import { useDiffStore } from '@/store/diffStore'
import { useTerminalStore } from '@/store/terminalStore'
import { ptyKill } from '@/ipc/pty'
import i18n from '@/i18n'
import { resolveModelConfig, activeModelKey } from '@/lib/modelKey'
import { clampEffortForKey } from '@/lib/modelEffort'
import { useProvidersStore } from '@/store/providersStore'
import { useHipConfigStore } from '@/store/hipConfigStore'
import { resolveValidAcpAgentId } from '@/lib/sessionAgent'
import { surfaceOf } from '@/lib/sessions'
import type { LocalAttachment } from '@/components/chat/attachmentTypes'
import { applyServerMessageEffects } from './serverMessageEffects'
import { sessionDebugBundleJson } from '@/lib/sessionDebugBundle'
import { useCommandPaletteStore } from '@/store/commandPaletteStore'
import { useWorkflowStore } from '@/store/workflowStore'
import { useFocusStore } from '@/store/focusStore'
import { useGoalStore } from '@/store/goalStore'
import { useParallelStore } from '@/store/parallelStore'
import { useProjectPathStore } from '@/store/projectPathStore'
import { isProjectPathBlocked } from '@/lib/projectPathGate'
import { planParallelFanout } from '@/lib/parallelFanout'
import { toast } from 'sonner'
import {
  formatDiffAnnotationsForComposer,
  useDiffAnnotationStore,
} from '@/store/diffAnnotationStore'
import { auditSessionDelete, debugSessionDelete } from '@/lib/sessionDelete'
import { StreamCoalescer, type CoalesceBucket, type StreamKind } from '@/lib/streamCoalesce'

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
  private readonly streamCoalescer: StreamCoalescer
  private waiters: ServerMessageWaiter[] = []
  /** E2E: when set, checkpoint list requests/results for this session re-apply the seed. */
  private e2eCheckpointSeed: {
    sessionId: string
    checkpoints: Checkpoint[]
    branch: string
  } | null = null
  /** E2E: last user content passed to sendMessage (annotation inject assertions). */
  private lastOutboundUserContent: string | null = null
  /**
   * FE-only plan approval seeds (seedPlanApproval) never pause the sidecar.
   * Track them so respondPlan completes locally with plan:respond:result ok:true
   * instead of plan:respond → not_awaiting → KD-16 rollback (card reappears).
   */
  private feOnlyPlanApprovalSessions = new Set<string>()

  constructor(transport: Transport) {
    this.transport = transport
    this.streamCoalescer = new StreamCoalescer((bucket) => this.applyCoalescedToken(bucket))
    this.unsubscribe = this.transport.onMessage((msg: ServerMessage) => this.receive(msg))
    this.unsubStatus = this.transport.onStatus((s) => useDomainStore.getState().setConnection(s))
  }

  dispose(): void {
    this.streamCoalescer.flushAll()
    this.unsubscribe()
    this.unsubStatus()
    for (const w of this.waiters) {
      clearTimeout(w.timer)
      w.reject(new Error('SessionService disposed'))
    }
    this.waiters = []
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
      this.fulfillWaiters(msg)
      return
    }

    // Drain pending tokens before turn-mutating barriers so order stays correct.
    this.flushBeforeBarrier(msg)

    useDomainStore.getState().apply(msg)
    applyServerMessageEffects(msg, {
      send: (m) => this.transport.send(m),
      requestDiff: (sessionId) => this.requestDiff(sessionId),
      requestCheckpoints: (sessionId) => this.requestCheckpoints(sessionId),
      requestCommitLog: (sessionId) => this.requestCommitLog(sessionId),
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
    // Force-clear knowledge/settings/history if a legacy persist left them as activeView.
    const st = useUiStore.getState()
    if (
      st.activeView === 'knowledge' ||
      st.activeView === 'settings' ||
      st.activeView === 'history'
    ) {
      useUiStore.setState({ activeView: 'chat', sidebarSection: 'chats' })
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
  simulateAgentWriteFinished(
    sessionId: string,
    opts?: { path?: string },
  ): { turnId: string; callId: string } {
    const turnId = `e2e-turn-${nanoid(8)}`
    const callId = `e2e-write-${nanoid(8)}`
    const filePath = opts?.path ?? '/README.md'
    const now = Date.now()
    useDomainStore.setState((st) => ({
      ...st,
      sessions: st.sessions.map((s) =>
        s.id !== sessionId
          ? s
          : {
              ...s,
              status: 'running' as const,
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
                      input: JSON.stringify({ path: filePath, content: 'e2e' }),
                      status: 'running' as const,
                      seq: 1,
                    },
                  ],
                  timeline: [
                    {
                      kind: 'tool' as const,
                      stepSeq: 1,
                      agentId: 'coder',
                      role: 'coder' as const,
                      callId,
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
      output: `wrote ${filePath}`,
    })
    // Ensure Changes refresh is not lost if debounce is cancelled mid-test.
    this.requestDiff(sessionId)
    return { turnId, callId }
  }

  /**
   * E2E: seed a finished edit_file tool with unified-diff-shaped output so
   * ToolCallRow renders tool-inline-diff (P2).
   */
  simulateEditWithDiff(
    sessionId: string,
    opts?: { path?: string },
  ): { turnId: string; callId: string } {
    const turnId = `e2e-turn-${nanoid(8)}`
    const callId = `e2e-edit-${nanoid(8)}`
    const filePath = opts?.path ?? '/README.md'
    const now = Date.now()
    const diffOut = `@@ -1 +1 @@\n-a\n+b\nedited ${filePath}`
    useDomainStore.setState((st) => ({
      ...st,
      sessions: st.sessions.map((s) =>
        s.id !== sessionId
          ? s
          : {
              ...s,
              status: 'running' as const,
              messages: [
                ...s.messages,
                {
                  id: turnId,
                  role: 'assistant' as const,
                  content: '',
                  timestamp: now,
                  agentRuns: [
                    {
                      agentId: 'supervisor',
                      role: 'supervisor' as const,
                      output: '',
                      startedAt: now,
                      finishedAt: null,
                      seq: 0,
                      messageId: turnId,
                    },
                  ],
                  toolCalls: [
                    {
                      callId,
                      agentId: 'supervisor',
                      name: 'edit_file',
                      input: JSON.stringify({ path: filePath, oldString: 'a', newString: 'b' }),
                      status: 'finished' as const,
                      output: diffOut,
                      seq: 1,
                    },
                  ],
                  timeline: [
                    {
                      kind: 'tool' as const,
                      stepSeq: 1,
                      agentId: 'supervisor',
                      role: 'supervisor' as const,
                      callId,
                    },
                  ],
                },
              ],
            },
      ),
    }))
    return { turnId, callId }
  }

  /** E2E: seed a running tool card on the active turn for process-UI assertions. */
  simulateToolStarted(
    sessionId: string,
    opts?: { name?: string; path?: string },
  ): { turnId: string; callId: string } {
    const turnId = `e2e-turn-${nanoid(8)}`
    const callId = `e2e-tool-${nanoid(8)}`
    const name = opts?.name ?? 'read_file'
    const filePath = opts?.path ?? '/README.md'
    const now = Date.now()
    useDomainStore.setState((st) => ({
      ...st,
      sessions: st.sessions.map((s) =>
        s.id !== sessionId
          ? s
          : {
              ...s,
              status: 'running' as const,
              messages: [
                ...s.messages,
                {
                  id: turnId,
                  role: 'assistant' as const,
                  content: '',
                  timestamp: now,
                  agentRuns: [
                    {
                      agentId: 'supervisor',
                      role: 'supervisor' as const,
                      output: '',
                      startedAt: now,
                      finishedAt: null,
                      seq: 0,
                      messageId: turnId,
                    },
                  ],
                  toolCalls: [
                    {
                      callId,
                      agentId: 'supervisor',
                      name,
                      input: JSON.stringify({ path: filePath }),
                      status: 'running' as const,
                      seq: 1,
                    },
                  ],
                  timeline: [
                    {
                      kind: 'tool' as const,
                      stepSeq: 1,
                      agentId: 'supervisor',
                      role: 'supervisor' as const,
                      callId,
                    },
                  ],
                },
              ],
            },
      ),
    }))
    return { turnId, callId }
  }

  /** E2E: create a chat session without sending a user message (no LLM turn). */
  createChatSessionForE2e(): string {
    const id = this.createSession({ ...DEFAULT_CONFIG, surface: 'chat' })
    // selectSession sets activeView to chat so ChatPane is the visible shell.
    this.selectSession(id)
    return id
  }

  /** E2E: create a code session bound to cwd without an LLM turn. */
  createCodeSessionForE2e(cwd: string): string {
    const id = this.createSession({
      ...DEFAULT_CONFIG,
      surface: 'code',
      cwd,
      permissionMode: 'edit',
    })
    this.selectSession(id)
    // Ensure code panel is open so Files/Agents/Changes tabs exist for e2e.
    useDomainStore.getState().setSessionCodePanelOpen(id, true)
    return id
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
      ui: {
        status: session.status,
        planApprovalPending: Boolean(session.planApprovalPending),
        interrupt: session.interrupt ?? null,
        activeTurnPlan: session.activeTurnPlan ?? null,
        forcePlan: Boolean(session.config.forcePlan),
      },
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
   * E2E multi-track B: project subagent pause handoff (first-line marker, not Error:).
   * Mirrors sidecar `formatPausedToolResult` wire format without a real LLM/task tool.
   */
  seedSubagentPause(sessionId: string): {
    turnId: string
    callId: string
    marker: typeof SessionService.SUBAGENT_PAUSE_MARKER
  } {
    const turnId = `e2e-turn-${nanoid(8)}`
    const callId = `e2e-task-${nanoid(8)}`
    const childCallId = `e2e-child-${nanoid(8)}`
    const marker = SessionService.SUBAGENT_PAUSE_MARKER
    const question = 'Which API should we target?'
    const output = `${marker} ${question}\npartial subagent progress`
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
    // Parent task tool (row suppressed in TurnTimeline; result carries pause marker).
    this.receive({
      type: 'tool:started',
      sessionId,
      turnId,
      agentId: 'supervisor',
      role: 'supervisor',
      callId,
      name: 'task',
      input: JSON.stringify({ description: 'e2e implement feature', prompt: 'do the work' }),
      seq: 1,
    })
    // Child timeline step so delegation-row can bind taskInput (same pattern as seedAgentCollaboration).
    this.receive({
      type: 'tool:started',
      sessionId,
      turnId,
      agentId: 'coder-1',
      role: 'coder',
      callId: childCallId,
      name: 'read_file',
      input: '{"path":"README.md"}',
      seq: 2,
    })
    // Wire: task finishes with pause marker in output (not Error: prefix; not tool failure streak).
    this.receive({
      type: 'tool:finished',
      sessionId,
      turnId,
      agentId: 'supervisor',
      callId,
      status: 'finished',
      output,
    })
    this.receive({
      type: 'token:stream',
      sessionId,
      turnId,
      agentId: 'supervisor',
      delta: `${marker} ${question}`,
    })
    // Seed helpers are synchronous fixtures — drain coalesced tokens so probes/UI see content immediately.
    this.streamCoalescer.flushTurn(sessionId, turnId)
    return { turnId, callId, marker }
  }

  /** E2E: supervisor agent:interrupt HITL question banner. */
  seedAgentInterrupt(sessionId: string, question = 'How should I proceed with the e2e task?'): {
    turnId: string
    question: string
  } {
    const turnId = `e2e-turn-${nanoid(8)}`
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
      delta: 'Need clarification before continuing.',
    })
    this.receive({
      type: 'agent:interrupt',
      sessionId,
      turnId,
      agentId: 'supervisor',
      question,
    })
    return { turnId, question }
  }

  /** E2E: plan:published + plan_approval interrupt → PlanApprovalCard / PlanProgressPanel. */
  seedPlanApproval(
    sessionId: string,
    opts?: { markdown?: string; planPath?: string },
  ): {
    turnId: string
    planItems: { content: string; status: string }[]
    markdown: string
  } {
    const turnId = `e2e-turn-${nanoid(8)}`
    const planItems = [
      { content: 'e2e plan step one', status: 'pending' as const },
      { content: 'e2e plan step two', status: 'pending' as const },
    ]
    const markdown =
      opts?.markdown ??
      '## E2E plan\n\nSeeded plan body for sticky markdown preview.\n\n- step one\n- step two\n'
    const planPath = opts?.planPath ?? `/tmp/hip-e2e/plans/${sessionId}.md`
    this.receive({
      type: 'agent:started',
      sessionId,
      turnId,
      agentId: 'supervisor',
      role: 'supervisor',
    })
    this.receive({
      type: 'plan:published',
      sessionId,
      turnId,
      plan: planItems,
      markdown,
      planPath,
      markdownTruncated: false,
    })
    this.receive({
      type: 'agent:interrupt',
      sessionId,
      turnId,
      agentId: 'supervisor',
      question: 'plan_approval',
      context: JSON.stringify({ kind: 'plan_approval' }),
    })
    // Sidecar is not paused — respondPlan must not wait on plan:respond wire.
    this.feOnlyPlanApprovalSessions.add(sessionId)
    return { turnId, planItems, markdown }
  }

  /**
   * E2E: agent:started + plan:updated (no approval) → sticky PlanProgressPanel with progress.
   * Optional message:complete to assert done-state retention of activeTurnPlan.
   */
  seedPlanProgress(
    sessionId: string,
    opts?: { complete?: boolean },
  ): {
    turnId: string
    planItems: { content: string; status: string }[]
  } {
    const turnId = `e2e-turn-${nanoid(8)}`
    const planItems = [
      { content: 'e2e progress step one', status: 'completed' as const },
      { content: 'e2e progress step two', status: 'in_progress' as const },
      { content: 'e2e progress step three', status: 'pending' as const },
    ]
    this.receive({
      type: 'agent:started',
      sessionId,
      turnId,
      agentId: 'supervisor',
      role: 'supervisor',
    })
    this.receive({
      type: 'plan:updated',
      sessionId,
      turnId,
      plan: planItems,
    })
    if (opts?.complete) {
      this.receive({
        type: 'message:complete',
        sessionId,
        message: {
          id: turnId,
          role: 'assistant',
          content: 'e2e plan progress complete',
          timestamp: Date.now(),
          agentId: 'supervisor',
        },
      })
    }
    return { turnId, planItems }
  }

  /** E2E: background task killed notification (synthetic notice message). */
  seedBackgroundTaskKilled(sessionId: string): {
    turnId: string
    agentId: string
    taskId: string
  } {
    const taskId = `e2e-bg-${nanoid(8)}`
    this.receive({
      type: 'agent:notification',
      sessionId,
      taskId,
      description: 'e2e background job',
      status: 'killed',
      error: 'killed by user: cancel',
    })
    const sess = useDomainStore.getState().sessions.find((s) => s.id === sessionId)
    const notice = [...(sess?.messages ?? [])].reverse().find((m) => m.role === 'notice' && m.id.startsWith(`notif-${taskId}-`))
    return { turnId: notice?.id ?? `notif-${taskId}`, agentId: taskId, taskId }
  }

  /** E2E: sidecar rejected workflow def (INVALID_WORKFLOW) error projection. */
  simulateInvalidWorkflowError(
    sessionId: string,
    reason = 'workflow nodes of type tool|human are not supported',
  ): void {
    this.receive({
      type: 'error',
      sessionId,
      code: 'INVALID_WORKFLOW',
      message: reason,
    })
  }

  /** E2E probe: last assistant message text (pause marker / notification). */
  getLastAssistantText(sessionId: string): string | null {
    const sess = useDomainStore.getState().sessions.find((s) => s.id === sessionId)
    if (!sess) return null
    for (let i = sess.messages.length - 1; i >= 0; i--) {
      const m = sess.messages[i]
      if (m.role === 'assistant') return m.content ?? ''
    }
    return null
  }

  /** E2E probe: pending interrupt question. */
  getPendingInterrupt(sessionId: string): { turnId: string; question: string } | null {
    const sess = useDomainStore.getState().sessions.find((s) => s.id === sessionId)
    const i = sess?.interrupt
    if (!i) return null
    return { turnId: i.turnId, question: i.question }
  }

  /** Matches packages/sidecar `SUBAGENT_PAUSE_MARKER` (Track B). */
  static readonly SUBAGENT_PAUSE_MARKER = '[hip:subagent_paused]' as const

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

  /**
   * E2E: jump to Settings on a given nav page via uiStore (same path as SettingsPanel tabs).
   * Prefer this over account-menu + Radix nav when residual suite state is flaky.
   */
  openSettingsPageForE2e(page = 'general'): void {
    useUiStore.getState().setSettingsPage(page as import('@/store/uiStore').SettingsPageId)
    useUiStore.getState().setActiveView('settings')
  }

  /** E2E: open Session History via uiStore (sidebar no longer has account menu entry). */
  openHistoryPageForE2e(): void {
    useUiStore.getState().setActiveView('history')
  }

  /** E2E: open product Recycle Bin via uiStore. */
  openTrashPageForE2e(): void {
    useUiStore.getState().setActiveView('trash')
    this.requestTrashList()
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
    this.transport.send({ type: 'session:create', id, config: enriched })
    return id
  }

  /**
   * Shared host create wait (G9/D20): send `git:worktree:create` (incl. `reveal`/`source`/`label`)
   * and await matching result. On success, hydrate the worktree catalog list.
   * Single create: reveal true (default), source protocol. Parallel slots: reveal false, host_fanout (D23/D26).
   */
  async waitCreateWorktree(
    hostSessionId: string,
    params: {
      branch: string
      createBranch?: boolean
      baseRef?: string
      pathKey?: string
      /** Default true for single create. Parallel slots: false. */
      reveal?: boolean
      /** Product source tag (PR7). Prefer explicit for product paths. */
      source?: WorktreeSource
      label?: string
    },
  ): Promise<{ ok: boolean; path?: string; id?: string; error?: string }> {
    const resultP = this.waitForServerMessageWhere(
      'git:worktree:create:result',
      (m) => m.sessionId === hostSessionId,
      45_000,
    )
    this.transport.send({
      type: 'git:worktree:create',
      sessionId: hostSessionId,
      branch: params.branch,
      ...(params.createBranch !== undefined ? { createBranch: params.createBranch } : {}),
      ...(params.baseRef !== undefined ? { baseRef: params.baseRef } : {}),
      ...(params.pathKey !== undefined ? { pathKey: params.pathKey } : {}),
      ...(params.reveal !== undefined ? { reveal: params.reveal } : {}),
      ...(params.source !== undefined ? { source: params.source } : {}),
      ...(params.label !== undefined ? { label: params.label } : {}),
    })
    const created = await resultP
    if (created.ok) {
      // List hydrate after success (G9/4).
      this.requestWorktreeList(hostSessionId)
    }
    return {
      ok: created.ok,
      ...(created.path ? { path: created.path } : {}),
      ...(created.id ? { id: created.id } : {}),
      ...(created.error ? { error: created.error } : {}),
    }
  }

  /**
   * Product single isolation create (D20/G9). Defaults reveal true — success toast is
   * owned by serverMessageEffects (D23); this method never toasts success.
   * Source defaults to `protocol` (PR7 / D26).
   */
  async createManagedWorktree(opts: {
    hostSessionId: string
    branch: string
    createBranch?: boolean
    baseRef?: string
    pathKey?: string
    label?: string
    /** Default `protocol` for single isolation (PR7). */
    source?: WorktreeSource
    /** Default true: open a code session on the new worktree path. */
    openSession?: boolean
    /** Default true; effects toast when true. UI must not toast success when true. */
    reveal?: boolean
  }): Promise<{ ok: boolean; path?: string; id?: string; sessionId?: string; error?: string }> {
    const reveal = opts.reveal ?? true
    const created = await this.waitCreateWorktree(opts.hostSessionId, {
      branch: opts.branch,
      createBranch: opts.createBranch ?? true,
      baseRef: opts.baseRef,
      pathKey: opts.pathKey,
      label: opts.label,
      source: opts.source ?? 'protocol',
      reveal,
    })
    if (!created.ok || !created.path) {
      return { ok: false, error: created.error ?? 'worktree create failed' }
    }

    let sessionId: string | undefined
    if (opts.openSession !== false) {
      const host = useDomainStore.getState().sessions.find((s) => s.id === opts.hostSessionId)
      const slotConfig: SessionConfig = normalizeSessionConfig({
        ...DEFAULT_CONFIG,
        surface: 'code',
        cwd: created.path,
        permissionMode: host?.config.permissionMode ?? 'edit',
        language: currentLanguage(),
      })
      sessionId = this.createSession(slotConfig)
      this.selectSession(sessionId)
    }
    return {
      ok: true,
      path: created.path,
      ...(created.id ? { id: created.id } : {}),
      ...(sessionId ? { sessionId } : {}),
    }
  }

  /**
   * Parallel Studio: fan out one prompt across N isolated git worktrees + sessions.
   * Uses a host session on `baseCwd` for git:worktree ops; agent turns run on slot sessions.
   * Per-slot create uses waitCreateWorktree({ reveal: false }); summary toast is Modal-owned (D23).
   */
  async startParallelRun(opts: {
    prompt: string
    baseCwd: string
    count: number
    permissionMode?: PermissionMode
    /** Prefer an existing code session on baseCwd (avoids extra host + create race). */
    hostSessionId?: string
    /**
     * When true, immediately message:send the prompt on each slot (starts N agent turns).
     * Default false — fan-out only creates worktrees/sessions so the UI stays responsive.
     */
    autoSend?: boolean
  }): Promise<{ runId: string; slotSessionIds: string[]; slotPaths: string[] }> {
    const prompt = opts.prompt.trim()
    if (!prompt) throw new Error('empty prompt')
    const baseCwd = opts.baseCwd.trim()
    if (!baseCwd) throw new Error('baseCwd required')
    const autoSend = opts.autoSend === true
    const { clampParallelCount, useParallelStore } = await import('@/store/parallelStore')
    const { parallelHostTitle, parallelSlotTitle } = await import('@/lib/parallelFormat')
    const { planParallelFanout, assertPrimaryNotInSlotPaths } = await import('@/lib/parallelFanout')
    const n = clampParallelCount(opts.count)
    const runId = nanoid(10)
    const runShort = runId.slice(0, 6)
    // Spec H1 / D26: branch hip-p-{runShort}-{i}, pathKey runId/branch (matches agent tool).
    const fanout = planParallelFanout({ n, prompt, runId: runShort })

    // Reuse caller's session when it is already bound to baseCwd.
    let hostSessionId = opts.hostSessionId?.trim() || ''
    if (hostSessionId) {
      const host = useDomainStore.getState().sessions.find((s) => s.id === hostSessionId)
      if (!host || host.config.cwd !== baseCwd) hostSessionId = ''
    }
    if (!hostSessionId) {
      const hostConfig: SessionConfig = normalizeSessionConfig({
        ...DEFAULT_CONFIG,
        surface: 'code',
        cwd: baseCwd,
        permissionMode: opts.permissionMode ?? 'edit',
        language: currentLanguage(),
      })
      hostSessionId = this.createSession(hostConfig)
      this.renameSession(hostSessionId, parallelHostTitle(runShort))
    }

    useParallelStore.getState().addRun({
      id: runId,
      baseCwd,
      prompt,
      hostSessionId,
      slots: [],
      createdAt: Date.now(),
      source: 'host',
    })

    const slotSessionIds: string[] = []
    const slotPaths: string[] = []
    for (const slotPlan of fanout.slots) {
      const i = slotPlan.index + 1
      const branch = slotPlan.branch
      // D26: pathKey = {runId}/{branch} — same as agent parallel_worktrees.
      const pathKey = `${runId}/${branch}`
      try {
        const created = await this.waitCreateWorktree(hostSessionId, {
          branch,
          createBranch: true,
          pathKey,
          reveal: false,
          // PR7 / D26: host composer fan-out — distinct from agent tool `parallel`.
          source: 'host_fanout',
        })
        if (!created.ok || !created.path) {
          useParallelStore.getState().setSlot(runId, i, {
            index: i,
            sessionId: '',
            worktreePath: '',
            branch,
            status: 'error',
            error: created.error ?? 'worktree create failed',
          })
          continue
        }

        const slotConfig: SessionConfig = normalizeSessionConfig({
          ...DEFAULT_CONFIG,
          surface: 'code',
          cwd: created.path,
          permissionMode: opts.permissionMode ?? 'edit',
          language: currentLanguage(),
        })
        const slotId = this.createSession(slotConfig)
        this.renameSession(slotId, parallelSlotTitle(runShort, i, n))

        useParallelStore.getState().setSlot(runId, i, {
          index: i,
          sessionId: slotId,
          worktreePath: created.path,
          branch,
          status: 'ready',
        })

        // Optional: kick agent turns. Product UI leaves this off so click never
        // freezes the shell under dual LLM / sidecar load.
        if (autoSend) {
          const msgId = nanoid()
          useDomainStore.getState().appendUserMessage(slotId, msgId, prompt, [])
          this.transport.send({
            type: 'message:send',
            sessionId: slotId,
            id: msgId,
            content: prompt,
            role: 'user',
          })
        }
        slotSessionIds.push(slotId)
        slotPaths.push(created.path)
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        useParallelStore.getState().setSlot(runId, i, {
          index: i,
          sessionId: '',
          worktreePath: '',
          branch,
          status: 'error',
          error,
        })
      }
    }

    // H5: product path must not place slot worktrees on the primary cwd itself.
    const primaryCheck = assertPrimaryNotInSlotPaths(baseCwd, slotPaths)
    if (!primaryCheck.ok) {
      useParallelStore.getState().updateRun(runId, {
        error: `slot path collides with primary: ${primaryCheck.conflict}`,
      })
    }

    if (slotSessionIds.length > 0) {
      this.selectSession(slotSessionIds[0]!)
      useUiStore.getState().setSidebarSection('projects')
    }
    return { runId, slotSessionIds, slotPaths }
  }

  /** Mark a parallel slot as the winner and focus it. */
  selectParallelWinner(runId: string, sessionId: string): void {
    void import('@/store/parallelStore').then(({ useParallelStore }) => {
      useParallelStore.getState().selectWinner(runId, sessionId)
    })
    this.selectSession(sessionId)
  }

  selectSession(id: string, messageId?: string): void {
    useDomainStore.getState().selectSession(id)
    useUiStore.getState().setSelectedArtifactPath(null)
    const s = useDomainStore.getState().sessions.find((x) => x.id === id)
    if (s) {
      const surface = surfaceOf(s.config)
      useUiStore.getState().setActiveView(surface)
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
    // Hydrate managed worktree catalog (CLI creates / external; AC2 list hydrate).
    this.requestWorktreeList(id)
    // Carry a clicked search hit's message into the scroll target; a plain select clears any stale one.
    useUiStore.getState().setScrollTarget(messageId ?? null)
  }

  /** Request porcelain+meta worktree list for Studio catalog (git:worktree:list → store). */
  requestWorktreeList(sessionId: string): void {
    this.transport.send({ type: 'git:worktree:list', sessionId })
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

  /**
   * Run Phase2 consolidate and wait for the terminal `memory:pipeline` event
   * (succeeded | failed | noop). Phase "started" is ignored.
   */
  async consolidateMemories(projectKeyHash?: string): Promise<{
    status: 'succeeded' | 'failed' | 'noop'
    detail?: string
  }> {
    const wait = this.waitForServerMessageWhere(
      'memory:pipeline',
      (msg) =>
        msg.phase === 2 &&
        (msg.status === 'succeeded' || msg.status === 'failed' || msg.status === 'noop'),
      180_000,
    )
    this.transport.send({
      type: 'memory:consolidate',
      ...(projectKeyHash ? { projectKeyHash } : {}),
    })
    const msg = await wait
    return {
      status: msg.status as 'succeeded' | 'failed' | 'noop',
      detail: msg.detail,
    }
  }

  async getMemoryStatus(opts?: {
    projectKeyHash?: string
    contextWindowTokens?: number
  }): Promise<import('@hip/protocol').MemoryPipelineStatus> {
    const wait = this.waitForServerMessage('memory:status')
    this.transport.send({
      type: 'memory:getStatus',
      ...(opts?.projectKeyHash ? { projectKeyHash: opts.projectKeyHash } : {}),
      ...(opts?.contextWindowTokens !== undefined
        ? { contextWindowTokens: opts.contextWindowTokens }
        : {}),
    })
    const msg = await wait
    if (msg.error) throw new Error(msg.error)
    return msg.status
  }

  async rewriteMemoryMirrors(projectKeyHash?: string): Promise<string[]> {
    const wait = this.waitForServerMessage('memory:rewriteMirrors:result')
    this.transport.send({
      type: 'memory:rewriteMirrors',
      ...(projectKeyHash ? { projectKeyHash } : {}),
    })
    const msg = await wait
    if (msg.error) throw new Error(msg.error)
    return msg.written
  }

  async importMemoryMirror(opts?: {
    projectKeyHash?: string
    conflict?: 'keep' | 'overwrite'
  }): Promise<{ imported: number; skipped: number }> {
    const wait = this.waitForServerMessage('memory:importMirror:result')
    this.transport.send({
      type: 'memory:importMirror',
      ...(opts?.projectKeyHash ? { projectKeyHash: opts.projectKeyHash } : {}),
      ...(opts?.conflict ? { conflict: opts.conflict } : {}),
    })
    const msg = await wait
    if (msg.error) throw new Error(msg.error)
    return { imported: msg.imported, skipped: msg.skipped }
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

  /**
   * One-shot empty-state greeting via built-in model path (no ACP/tools/session).
   * Uses last-used model when provided. Always-on product path; caller keeps rule-based fallback.
   */
  async generateEmptyGreeting(opts: {
    requestId?: string
    providerID?: string
    modelID?: string
    context: EmptyGreetingGenerateContext
    timeoutMs?: number
  }): Promise<{ ok: true; title: string; sub: string } | { ok: false; error: string }> {
    const requestId = opts.requestId ?? nanoid()
    const timeoutMs = opts.timeoutMs ?? 4_000
    const wait = this.waitForServerMessageWhere(
      'ui:emptyGreeting:generate:result',
      (msg) => msg.requestId === requestId,
      timeoutMs,
    )
    this.transport.send({
      type: 'ui:emptyGreeting:generate',
      requestId,
      ...(opts.providerID ? { providerID: opts.providerID } : {}),
      ...(opts.modelID ? { modelID: opts.modelID } : {}),
      context: opts.context,
    })
    try {
      const msg = await wait
      if (!msg.ok || !msg.title || !msg.sub) {
        return { ok: false, error: msg.error ?? 'empty greeting generation failed' }
      }
      return { ok: true, title: msg.title, sub: msg.sub }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: message || 'timeout' }
    }
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
    useDomainStore.getState().apply({ type: 'session:permissionMode', sessionId: id, permissionMode: mode }) // optimistic
    this.transport.send({ type: 'session:setPermissionMode', sessionId: id, permissionMode: mode })
  }

  /** Force plan/execute/verify for subsequent turns (product /plan chip and slash). */
  setForcePlan(id: string, forcePlan: boolean): void {
    useDomainStore.getState().apply({ type: 'session:forcePlan', sessionId: id, forcePlan }) // optimistic
    this.transport.send({ type: 'session:setForcePlan', sessionId: id, forcePlan })
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
      useUiStore.getState().setSidebarSection(surface === 'code' ? 'projects' : 'chats')
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
    this.lastOutboundUserContent = text
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

  getLastOutboundUserContent(): string | null {
    return this.lastOutboundUserContent
  }

  /** Product path: remove worktree (preflight when force=false). PR7: structured errorCode/dirtySummary. */
  async removeWorktree(
    sessionId: string,
    worktreePath: string,
    force = false,
  ): Promise<{
    ok: boolean
    error?: string
    errorCode?: WorktreeRemoveErrorCode
    dirtySummary?: string
  }> {
    const resultP = this.waitForServerMessageWhere(
      'git:worktree:remove:result',
      (m) => m.sessionId === sessionId,
      60_000,
    )
    this.transport.send({
      type: 'git:worktree:remove',
      sessionId,
      worktreePath,
      force,
    })
    const res = await resultP
    return {
      ok: res.ok,
      ...(res.error ? { error: res.error } : {}),
      ...(res.errorCode ? { errorCode: res.errorCode } : {}),
      ...(res.dirtySummary ? { dirtySummary: res.dirtySummary } : {}),
    }
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
    if (this.feOnlyPlanApprovalSessions.has(activeSessionId)) {
      this.feOnlyPlanApprovalSessions.delete(activeSessionId)
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
 *  branch never carries a cwd/permissionMode (Chat is picker-less). */
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
    surface === 'code' && draft?.permissionMode ? { ...base, permissionMode: draft.permissionMode } : base
  // forcePlan is hip-graph only — skip when ACP primary.
  const withPlan: SessionConfig =
    surface === 'code' && draft?.forcePlan && !externalAgentId
      ? { ...withMode, forcePlan: true, disablePlan: false }
      : withMode
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

/** E2E bridge: only installed outside production builds (vite DEV / e2e). */
export type HipE2EHooks = {
  injectServerMessage: (msg: ServerMessage) => void
  simulateAgentWriteFinished: (
    sessionId: string,
    opts?: { path?: string },
  ) => { turnId: string; callId: string }
  simulateToolStarted: (
    sessionId: string,
    opts?: { name?: string; path?: string },
  ) => { turnId: string; callId: string }
  simulateEditWithDiff: (
    sessionId: string,
    opts?: { path?: string },
  ) => { turnId: string; callId: string }
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
  /** E2E: open Settings on a nav page via store (avoids Radix menu flakes). */
  openSettingsPageForE2e: (page?: string) => void
  /** E2E: open Session History via store. */
  openHistoryPageForE2e: () => void
  /** E2E: open Recycle Bin via store. */
  openTrashPageForE2e: () => void
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
  getActiveSessionForcePlan: () => boolean | null
  /** E2E: read workflow store projection (product path has no dedicated DAG shell). */
  getWorkflowSession: (sessionId: string) => {
    activeWorkflow: { id: string; name: string } | null
    runId: string | null
    runStatus: string | null
    nodeStatuses: Record<string, string>
  }
  seedSubagentPause: (sessionId: string) => {
    turnId: string
    callId: string
    marker: '[hip:subagent_paused]'
  }
  seedAgentInterrupt: (sessionId: string, question?: string) => { turnId: string; question: string }
  seedPlanApproval: (sessionId: string) => {
    turnId: string
    planItems: { content: string; status: string }[]
  }
  seedPlanProgress: (
    sessionId: string,
    opts?: { complete?: boolean },
  ) => {
    turnId: string
    planItems: { content: string; status: string }[]
  }
  /** Switch global active model (DeepSeek dogfood). */
  setActiveModel: (providerID: string, modelID: string, baseURL?: string) => void
  /** Reload session history from sidecar (triggers plan-approval resync D4c.1). */
  reloadSession: (sessionId: string) => void
  /** Whether FE has planApprovalPending for a session. */
  getPlanApprovalPending: (sessionId: string) => boolean
  seedBackgroundTaskKilled: (sessionId: string) => {
    turnId: string
    agentId: string
    taskId: string
  }
  simulateInvalidWorkflowError: (sessionId: string, reason?: string) => void
  getLastAssistantText: (sessionId: string) => string | null
  getPendingInterrupt: (sessionId: string) => { turnId: string; question: string } | null
  /** Focus / write-follow inspection for e2e. */
  getFocusedPath: () => string | null
  getFsActivePath: (sessionId: string) => string | null
  seedGoal: (
    sessionId: string,
    goal: { id?: string; description: string; status: 'active' | 'paused' | 'blocked' | 'completed'; turns?: number; maxTurns?: number },
  ) => void
  seedParallelRun: (opts: {
    hostSessionId: string
    n?: number
    baseCwd: string
    prompt?: string
  }) => { runId: string; slotCount: number }
  /** Product path: host fan-out N worktrees + sessions. */
  startParallelRun: (opts: {
    prompt: string
    baseCwd: string
    count: number
    hostSessionId?: string
    autoSend?: boolean
  }) => Promise<{ runId: string; slotSessionIds: string[]; slotPaths: string[] }>
  /** Last user message content sent via sendMessage (e2e annotation inject). */
  getLastOutboundUserContent: () => string | null
  /** Assert worktree dirty preflight via product remove path. */
  removeWorktree: (
    sessionId: string,
    worktreePath: string,
    force?: boolean,
  ) => Promise<{
    ok: boolean
    error?: string
    errorCode?: WorktreeRemoveErrorCode
    dirtySummary?: string
  }>
  /** Seed pending diff annotations (InputBar product inject path). */
  seedDiffAnnotation: (
    sessionId: string,
    ann: { path: string; body: string; note?: string },
  ) => string
  /** Mirror InputBar submit: format pending annotations + sendMessage. */
  sendWithPendingAnnotations: (sessionId: string, text: string) => void
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
    simulateAgentWriteFinished: (sessionId, opts) => svc.simulateAgentWriteFinished(sessionId, opts),
    simulateToolStarted: (sessionId, opts) => svc.simulateToolStarted(sessionId, opts),
    simulateEditWithDiff: (sessionId, opts) => svc.simulateEditWithDiff(sessionId, opts),
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
    openSettingsPageForE2e: (page) => svc.openSettingsPageForE2e(page),
    openHistoryPageForE2e: () => svc.openHistoryPageForE2e(),
    openTrashPageForE2e: () => svc.openTrashPageForE2e(),
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
    getActiveSessionForcePlan: () => {
      const id = useDomainStore.getState().activeSessionId
      if (!id) return null
      const sess = useDomainStore.getState().sessions.find((s) => s.id === id)
      if (!sess) return null
      return Boolean(sess.config?.forcePlan)
    },
    getWorkflowSession: (sessionId) => svc.getWorkflowSession(sessionId),
    seedSubagentPause: (sessionId) => svc.seedSubagentPause(sessionId),
    seedAgentInterrupt: (sessionId, question) => svc.seedAgentInterrupt(sessionId, question),
    seedPlanApproval: (sessionId) => svc.seedPlanApproval(sessionId),
    seedPlanProgress: (sessionId, opts) => svc.seedPlanProgress(sessionId, opts),
    setActiveModel: (providerID, modelID, baseURL = '') => {
      // Prefer catalog baseURL when empty.
      let resolved = baseURL
      if (!resolved) {
        const { catalog, config } = useProvidersStore.getState()
        try {
          resolved = resolveModelConfig(catalog, config, `${providerID}/${modelID}`).baseURL
        } catch {
          resolved =
            providerID === 'deepseek'
              ? 'https://api.deepseek.com/v1'
              : ''
        }
      }
      svc.setActiveModel(providerID, modelID, resolved)
      // Keep FE store in sync for picker UI.
      useProvidersStore.setState((s) => ({
        config: {
          ...s.config,
          activeModel: { providerID, modelID },
        },
      }))
    },
    reloadSession: (sessionId) => svc.reloadSession(sessionId),
    getPlanApprovalPending: (sessionId) => {
      const sess = useDomainStore.getState().sessions.find((s) => s.id === sessionId)
      return Boolean(sess?.planApprovalPending)
    },
    seedBackgroundTaskKilled: (sessionId) => svc.seedBackgroundTaskKilled(sessionId),
    simulateInvalidWorkflowError: (sessionId, reason) => svc.simulateInvalidWorkflowError(sessionId, reason),
    getLastAssistantText: (sessionId) => svc.getLastAssistantText(sessionId),
    getPendingInterrupt: (sessionId) => svc.getPendingInterrupt(sessionId),
    getFocusedPath: () => useFocusStore.getState().focusedPath,
    getFsActivePath: (sessionId) => useFsStore.getState().bySession[sessionId]?.activePath ?? null,
    seedGoal: (sessionId, goal) => {
      if (goal.status === 'completed') {
        useGoalStore.getState().setGoal(sessionId, null)
        return
      }
      useGoalStore.getState().setGoal(sessionId, {
        id: goal.id ?? `goal-${Date.now()}`,
        description: goal.description,
        status: goal.status,
        turns: goal.turns,
        maxTurns: goal.maxTurns,
      })
    },
    seedParallelRun: (opts) => {
      // Deprecated for P5 e2e — prefer startParallelRun (real product path).
      const n = opts.n ?? 2
      const runId = `e2e-prun-${Date.now().toString(36)}`
      const plan = planParallelFanout({
        n,
        prompt: opts.prompt ?? 'e2e parallel',
        runId,
      })
      useParallelStore.getState().addRun({
        id: runId,
        baseCwd: opts.baseCwd,
        prompt: plan.prompt,
        hostSessionId: opts.hostSessionId,
        source: 'host',
        createdAt: Date.now(),
        // pathKey on the plan is branch segment only; product layout is {runId}/{branch}.
        slots: plan.slots.map((s) => ({
          index: s.index,
          sessionId: `slot-sess-${s.index}`,
          worktreePath: `${opts.baseCwd}/.hip-wt/${runId}/${s.branch}`,
          branch: s.branch,
          status: 'ready' as const,
        })),
      })
      return { runId, slotCount: plan.slots.length }
    },
    startParallelRun: (opts) => svc.startParallelRun(opts),
    getLastOutboundUserContent: () => svc.getLastOutboundUserContent(),
    removeWorktree: (sessionId, worktreePath, force) =>
      svc.removeWorktree(sessionId, worktreePath, force),
    seedDiffAnnotation: (sessionId, ann) =>
      useDiffAnnotationStore.getState().add(sessionId, ann),
    sendWithPendingAnnotations: (sessionId, text) => {
      // Same composition order as InputBar.submit (product path).
      const ann = useDiffAnnotationStore.getState().list(sessionId)
      const annBlock = formatDiffAnnotationsForComposer(ann)
      if (ann.length > 0) useDiffAnnotationStore.getState().clear(sessionId)
      let content = text
      if (annBlock) content = `${annBlock}${content}`
      useDomainStore.getState().selectSession(sessionId)
      svc.sendMessage(content, [])
    },
  }
}

installE2eHooks(sessionService)
