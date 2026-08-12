// src/domain/actions/sessionActions.ts
// Session lifecycle + config setters + message-sending wire actions, extracted
// from SessionService (P4, spec docs/design/2026-08-07-session-service-decomposition-spec.md).
// Transport + a ServerMessage injector (facade receive) are constructor-injected.
import type {
  ExecutionMode,
  OrchestrationMode,
  PermissionMode,
  ServerMessage,
  SessionConfig,
} from '@hip/protocol'
import { normalizeSessionConfig, resolveExecutionMode, executionModeConfigPatch } from '@hip/protocol'
import { nanoid } from 'nanoid'
import type { Transport } from '../transport'
import { useDomainStore, DEFAULT_CONFIG } from '../sessionStore'
import { isFeOnlyPlanApproval, unmarkFeOnlyPlanApproval } from '../e2eHooks'
import type { SessionService } from '../sessionService'
import { ptyKill } from '@/ipc/pty'
import type { LocalAttachment } from '@/components/chat/attachmentTypes'
import { useDiffStore } from '@/store/diffStore'
import { useDraftStore, type Draft } from '@/store/draftStore'
import { useFocusStore } from '@/store/focusStore'
import { useFsStore } from '@/store/fsStore'
import { useDetectionStore } from '@/store/detectionStore'
import { useHipConfigStore } from '@/store/hipConfigStore'
import { useManagedTerminalStore } from '@/store/managedTerminalStore'
import { useNavHistoryStore } from '@/store/navHistoryStore'
import { useProjectPathStore } from '@/store/projectPathStore'
import { useProvidersStore } from '@/store/providersStore'
import { useTerminalAgentStore } from '@/store/terminalAgentStore'
import { useTerminalStore } from '@/store/terminalStore'
import { useUiStore, normalizeAppLanguage, type AppLanguage, type Surface } from '@/store/uiStore'
import i18n from '@/i18n'
import { clampEffortForKey } from '@/lib/modelEffort'
import { activeModelKey, resolveModelConfig } from '@/lib/modelKey'
import { isProjectPathBlocked } from '@/lib/projectPathGate'
import { buildRoundtableOutbound } from '@/lib/roundtable'
import { auditSessionDelete, debugSessionDelete } from '@/lib/sessionDelete'
import { resolveValidAcpAgentId } from '@/lib/sessionAgent'
import { isTerminalSession, surfaceOf } from '@/lib/sessions'
import { toast } from 'sonner'

/**
 * Map the current i18next language to a SessionConfig-supported value.
 * Exported for unit tests — same path used when enriching session configs.
 */
export function currentLanguage(): AppLanguage {
  return normalizeAppLanguage(i18n.resolvedLanguage ?? i18n.language) ?? 'en'
}

/** Build the committed SessionConfig from the current draft. Surface is derived from the draft
 *  mode — a project draft (folder picked) is a Code conversation; a chat draft is a sandboxed
 *  Chat conversation. The Chat new-conversation view keeps chat drafts in chat mode, so the chat
 *  branch never carries a cwd (Chat is picker-less); the only chat permission override is
 *  controlPermission, which lifts the sandbox to full machine access ('full'). */
export function configFromDraft(draft: Draft | null): SessionConfig {
  const surface: 'chat' | 'code' = draft?.mode === 'project' ? 'code' : 'chat'
  const agents = useHipConfigStore.getState().config.agents ?? []
  const { installed, checked: detectionChecked } = useDetectionStore.getState()
  // Only emit agentId when the id still names a selectable ACP agent (stale/missing-binary omit).
  const externalAgentId = resolveValidAcpAgentId(draft?.agentId, agents, {
    installed,
    detectionChecked,
  })
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


export class SessionActions {
  private lastOutboundUserContent: string | null = null

  constructor(
    private readonly transport: Transport,
    private readonly inject: (msg: ServerMessage) => void,
    /** Facade reference: internal cross-calls (resume/respondPlan) go through the
     *  facade forwards so tests spying on sessionService methods keep intercepting. */
    private readonly svc: Pick<SessionService, 'resume' | 'respondPlan'>,
  ) {}

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
    const { activeSessionId } = useDomainStore.getState()
    if (!activeSessionId) return
    this.setSessionModelFor(activeSessionId, modelKey)
  }

  /** Session-scoped model switch (terminal ops composer: the bound session is not the global
   *  active session). Same resolve/optimistic/send flow as setSessionModel. */
  setSessionModelFor(sessionId: string, modelKey: string): void {
    const { sessions } = useDomainStore.getState()
    const { catalog, config } = useProvidersStore.getState()
    const { llmProvider, model, baseURL } = resolveModelConfig(catalog, config, modelKey)
    // Optimistic — the sidecar echoes session:model to confirm.
    useDomainStore.getState().apply({ type: 'session:model', sessionId, llmProvider, model })
    this.transport.send({ type: 'session:setModel', sessionId, llmProvider, model, baseURL })

    // Effort is model-specific (OpenAI has none/xhigh; Anthropic has max; many models have none).
    // Clamp or clear so a leftover `max` is never sent to a model that does not advertise it.
    const prev = sessions.find((s) => s.id === sessionId)?.config.effort
    const next = clampEffortForKey(catalog, modelKey, prev)
    if (next !== prev && (next !== undefined || prev !== undefined)) {
      this.setEffort(sessionId, next ?? null)
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
      this.svc.respondPlan('amend', text || undefined)
      return
    }
    // Non-plan interrupt continues via message:resume.
    if (active?.interrupt) { this.svc.resume(text, attachments); return }
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

  /** Respond to a plan approval interrupt (approve / reject / amend) for a specific session. */
  respondPlanFor(
    sessionId: string,
    action: 'approve' | 'reject' | 'amend',
    amendContent?: string,
  ): void {
    const { sessions } = useDomainStore.getState()
    const sess = sessions.find((s) => s.id === sessionId)
    // Idempotent: ignore double-clicks after optimistic dismiss (eval multi-pump / UI re-entry).
    if (!sess?.planApprovalPending) return
    // Drop PlanApprovalCard immediately so eval/UI do not keep a disabled shell for the whole execute turn.
    useDomainStore.getState().respondPlanOptimistic(sessionId, action)
    // FE-only seed (seedPlanApproval): no sidecar pause — complete locally so KD-16
    // does not restore the card via not_awaiting from a real plan:respond.
    if (isFeOnlyPlanApproval(sessionId)) {
      unmarkFeOnlyPlanApproval(sessionId)
      this.inject({
        type: 'plan:respond:result',
        sessionId,
        ok: true,
        action,
      })
      return
    }
    this.transport.send({ type: 'plan:respond', sessionId, action, amendContent })
  }

  /** Respond to a plan approval interrupt (approve / reject / amend) on the active session. */
  respondPlan(action: 'approve' | 'reject' | 'amend', amendContent?: string): void {
    const { activeSessionId } = useDomainStore.getState()
    if (!activeSessionId) return
    this.respondPlanFor(activeSessionId, action, amendContent)
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
  resyncActiveIfRunning(): void {
    const { activeSessionId, sessions } = useDomainStore.getState()
    if (!activeSessionId) return
    const s = sessions.find((x) => x.id === activeSessionId)
    if (s?.status === 'running') this.reloadSession(activeSessionId)
  }

}
