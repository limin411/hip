import type { ServerMessage, SessionConfig, AgentRole, Message, AgentRun, FsEntry, TurnUsage, DiffBase, DiffFile, DiffState, DiffSummary, Checkpoint, CommitLogEntry, CheckpointMode, Branch, PermissionMode, WorkflowDef, Hook, SkillMeta, AgentConfig, McpServerConfig, PlanItem, SessionEvent, TimelineStep, Attachment, ContentPart, OrchestrationMode } from '@hip/protocol'
import { FIXED_AGENTS } from '@hip/protocol'
import { mkdir, writeFile, rename } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { HumanMessage, AIMessage, ToolMessage, AIMessageChunk, SystemMessage, type BaseMessage } from '@langchain/core/messages'
import type { BaseLanguageModel } from '@langchain/core/language_models/base'
import { clip, stringify, trajectoryToRuns, trajectoryToTimeline, ReasoningTracker, type TraceRun, type TraceRecorder } from './tool-trace.js'
import { verifyWrites } from './verify.js'
import { IdleWatchdog } from './idle-watchdog.js'
import { getActiveModel, isOpenAICompatible } from '../config/providers.js'
import { isMultimodalModel } from '../config/catalog.js'
import { resolveApiKey } from '../config/auth-file.js'
import { resolveEffectiveConfig } from '../config/hip-config.js'
import { buildGraph, type GraphEmit, type GraphCtx, type LoopState } from './graph.js'
import { selectImageAgent } from './agents/registry.js'
import { SessionApprovalCache } from './tool-runner/approval-cache.js'
import { defaultToolPolicy } from './tool-runner/tool-policy.js'
import { mcpManager } from './mcp/manager.js'
import { readAgentsConfig } from './agents/index.js'
import type { ApprovalFn } from './tools.js'
import { SELF_GATED_TOOLS } from './tools.js'
import { RealModelRunner, type ModelRunner } from './model-runner.js'
import { buildChatModel, createSummarizer } from './model-factory.js'
import { runSubagent } from './subagent.js'
import { recursionLimit, CHILD_MAX_STEPS, MAX_STEPS } from './loop-control.js'
import { Activity, ActivityTracker } from './activity.js'
import { GoalManager } from './goal.js'
import { addUsage, sumUsage } from './usage.js'
import { compactMessages, estimateTokens, COMPACT_BUDGET_TOKENS, KEEP_RECENT_TURNS, type Summarizer } from './compaction.js'
import { PAUSE_QUESTION } from './doom-loop.js'
import type { ExternalAgentHooks, PermissionChoice } from './agents/types.js'
import { HookRegistry } from './hooks/registry.js'
import type { AgentRunner } from '../orchestrator/ports.js'
import { createAgentInvoker, type AgentInvoker } from './agents/invoker.js'
import type { SessionStore } from '../persistence/store.js'
import { EventStore, SnapshotStore, saveSessionSnapshot, loadSessionSnapshot } from '../persistence/event-store.js'
import { loadProjection, projectEvent } from '../persistence/message-projector.js'
import type { SessionMessageData, ProjectedToolCall } from '../persistence/message-types.js'
import { isAssistantStep } from '../persistence/message-types.js'
import { isContentPart } from '../persistence/message-updater.js'
import * as workspaceFs from './workspace-fs.js'
import { GitOperations } from './git-operations.js'
import { PermissionManager } from './permission-manager.js'
import { AgentProviderManager } from './agent-provider.js'
import { ConfigManager } from './config-manager.js'
import { deriveTitle, sanitizeTitle, buildDefaultTitleGenerator, type TitleGenerator } from './title-generator.js'
import { runWorkflowTurn as runWorkflowTurnFn, type WorkflowRunDeps } from './workflow-runner.js'
import { shouldPlan } from './plan.js'
import { AgentProfileManager } from './agent-profile-manager.js'
import type { AgentProfile } from './agent-profile.js'
import { PlanMode } from './plan-mode.js'
import { ToolOutputStore } from './tool-output-store.js'
import { NetworkPolicy, loadNetworkPolicyConfig } from './network-policy.js'
import { GuardianReviewer } from './guardian.js'
import { SessionInputQueue, type SessionInput } from './session-input.js'
import { prepareSessionContext, type SessionContextState } from './session-context.js'
import { validateAttachments, stageAttachments, buildAttachmentContentParts, splitAttachments, type AttachmentPayload } from './attachments.js'
import { defaultScratchRoot, scratchDirFor } from './scratch.js'
import {
  ContextInjectorRegistry,
  SystemPromptInjector,
  SkillsListInjector,
  PermissionModeInjector,
  TokenBudgetInjector,
  SubagentStatusInjector,
} from './context-injector.js'
import { ContextEpoch } from './context-epoch.js'
import { buildSessionTooling, type SessionTooling } from './session-tooling.js'
import { safeErrorMessage } from './error.js'
import { BackgroundManager, BackgroundTaskPersistence, type BackgroundTaskMeta } from './background-manager.js'
import { CronManager } from './cron.js'
import { logInfo, logDebug, logDebugEveryN } from '../debug-logger.js'
import {
  resolveModel,
  resolveModelChoice,
  buildModel,
  SAFE_KINDS,
  tryAutoResolvePermission,
  logNonCritical,
  lastUserText,
  stripImageContentParts,
  isImageAttachment,
  parseToolInput,
} from './session-helpers.js'
import { rowToBaseMessage, sessionEventToEventData, isRichContentParts } from './session-message-codec.js'
import { emitSessionEvent, finalizeAndPersistTurn } from './session-persist.js'
import { processInput, runTurn, runManagedAgentTurn, type SessionTurnHost } from './session-turn-runner.js'
import { runBackgroundSubagent, loadSubagentMessages } from './session-background.js'
import { resume, regenerate, handlePlanResponse, retrySubagent, resumeSubagent } from './session-turn-ops.js'


export { sanitizeTitle } from './title-generator.js'
export type { TitleGenerator } from './title-generator.js'
export type { SessionInput } from './session-input.js'
export {
  resolveModel,
  resolveModelChoice,
  SAFE_KINDS,
  tryAutoResolvePermission,
  stripImageContentParts,
} from './session-helpers.js'

type SendFn = (msg: ServerMessage) => void
export const DEFAULT_IDLE_TIMEOUT_MS = 60_000

const NOOP_SUMMARIZER: Summarizer = { async summarize() { return '' } }

export class Session {
  private app!: ReturnType<typeof buildGraph>
  private orchestratorRunner?: AgentRunner
  private readonly hooks = new HookRegistry()
  private readonly injectedRunner?: ModelRunner
  _config: SessionConfig
  private readonly injectedModel?: BaseLanguageModel
  orchMode: OrchestrationMode
  /** When set, the next runTurn in 'dag' mode delegates to the workflow runner. */
  pendingWorkflowDef: WorkflowDef | null = null
  private readonly messages: BaseMessage[] = []
  private abortController: AbortController | null = null
  private resumeAbortController: AbortController | null = null
  private running = false
  private awaitingResume = false
  private readonly inputQueue: SessionInput[] = []
  private steerAbortFlag = false
  private paused: {
    messages: BaseMessage[]
    steps: number
    planningMode?: 'fast' | 'plan'
    planStatus?: 'none' | 'generating' | 'ready' | 'approved' | 'rejected'
    plan?: PlanItem[]
  } | null = null
  private readonly injectedSummarizer?: Summarizer
  private modelDirty = false
  private turnSeq = 0
  private stopContinued = false
  private goalContinued = false
  readonly usesEnvModel: boolean
  private readonly planMode: PlanMode
  private readonly titleGenerator?: TitleGenerator
  private readonly invokerFactory: (cwd: string) => AgentInvoker
  readonly backgroundManager: BackgroundManager
  readonly cronManager: CronManager
  /** @deprecated Use backgroundManager.tasks instead. Kept for test backward-compat. */
  get backgroundTasks(): Map<string, Promise<void>> { return this.backgroundManager.tasks }
  /** @deprecated Use backgroundManager.meta instead. Kept for internal backward-compat. */
  private get backgroundTaskMeta(): Map<string, { description: string; status: 'running' | 'completed' | 'failed' | 'lost'; result?: string; error?: string }> {
    return this.backgroundManager.meta as Map<string, { description: string; status: 'running' | 'completed' | 'failed' | 'lost'; result?: string; error?: string }>
  }
  private readonly spawnedSubagentIds = new Set<string>()
  private readonly subagentInstances: Map<string, { description: string }> = new Map()
  private readonly toolOutputStore = new ToolOutputStore()
  private readonly networkPolicy = new NetworkPolicy(loadNetworkPolicyConfig())
  private readonly inputQueueStore?: SessionInputQueue
  static readonly MAX_BACKGROUND_TASKS = 10
  private static readonly MAX_RETAINED_BACKGROUND_META = 50

  readonly eventStore?: EventStore
  private readonly snapshotStore?: SnapshotStore
  private readonly activeSteps = new Map<string, string>()
  private activeActivity?: ActivityTracker
  readonly goalManager = new GoalManager()

  readonly git: GitOperations
  readonly permissions: PermissionManager
  readonly agentProv: AgentProviderManager
  readonly configMgr: ConfigManager
  private readonly profileMgr = new AgentProfileManager()
  readonly approvalCache = new SessionApprovalCache()
  readonly toolPolicy = defaultToolPolicy({ selfGatedTools: SELF_GATED_TOOLS })

  listBackgroundTasks(): string[] { return this.backgroundManager.listIds() }

  /** @deprecated Use backgroundManager directly. Kept for backward compat. */
  private trimBackgroundTaskMeta(): void {
    const { meta } = this.backgroundManager
    if (meta.size <= Session.MAX_RETAINED_BACKGROUND_META) return
    for (const [id, m] of meta) {
      if (m.status !== 'running') { meta.delete(id); break }
    }
  }

  /**
   * Run a sub-agent detached from the parent turn. When it completes, its final text is:
   *  1. persisted as a synthetic assistant turn (step_started/text_started/text_ended/step_ended),
   *  2. injected into the in-memory message list so the next parent turn sees it, and
   *  3. delivered to the client as an agent:notification.
   *
   * Errors are caught and injected as a failed synthetic message; they never propagate to the
   * caller, so background tasks are fire-and-forget from the parent turn's perspective.
   */
  async runBackgroundSubagent(taskId: string, description: string, signal: AbortSignal, send: SendFn): Promise<void> {
    return runBackgroundSubagent(this as unknown as SessionTurnHost, taskId, description, signal, send)
  }


  private loadSubagentMessages(taskId: string): BaseMessage[] {
    return loadSubagentMessages(this as unknown as SessionTurnHost, taskId)
  }


  registerHook(hook: Hook): void { this.hooks.register(hook) }

  startActivity(description: string, totalSteps: number = MAX_STEPS): Activity {
    if (this.activeActivity) {
      this.endActivity()
    }
    const activity = new ActivityTracker(
      `act-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      description,
      totalSteps,
    )
    this.activeActivity = activity
    void this.hooks.fire('ActivityStart', { sessionId: this.id, activityId: activity.id }).catch((err) => logNonCritical('ActivityStart', err))
    return activity
  }

  currentActivity(): Activity | undefined {
    return this.activeActivity
  }

  async extendActivity(steps: number): Promise<boolean> {
    const activity = this.activeActivity
    if (!activity) return false
    const result = await this.hooks
      .fire('ActivityBudgetRequest', { sessionId: this.id, activityId: activity.id, stepsRequested: steps })
      .catch(() => ({ kind: 'deny' as const, reason: 'Hook error' }))
    if (result.kind !== 'allow') return false
    activity.extend(result.steps ?? steps)
    return true
  }

  endActivity(): void {
    const activity = this.activeActivity
    if (!activity) return
    this.activeActivity = undefined
    void this.hooks.fire('ActivityEnd', { sessionId: this.id, activityId: activity.id }).catch((err) => logNonCritical('ActivityEnd', err))
  }

  private consumeActivitySteps(steps: number): void {
    this.activeActivity?.consume(steps)
  }

  private resolvePermissionMode(): PermissionMode {
    const rawMode = this._config.permissionMode
    return rawMode === 'chat' || rawMode === 'full' ? rawMode : 'edit'
  }

  private async generateFirstTurnTitle(input: SessionInput, replyText: string, _send: SendFn): Promise<void> {
    if (!this.titleGenerator || !replyText || !this.store) return
    try {
      const refined = sanitizeTitle(await this.titleGenerator({ firstUserMessage: input.content, firstReply: replyText }))
      if (refined && this.store.updateTitleIfAuto(this.id, refined) === 1) {
        _send({ type: 'session:title', sessionId: this.id, title: refined })
      }
    } catch (err) {
      console.warn(`Title generation failed for session ${this.id}:`, err instanceof Error ? err.message : String(err))
    }
  }

  constructor(
    readonly id: string,
    config: SessionConfig,
    model?: BaseLanguageModel,
    private readonly store?: SessionStore,
    titleGenerator?: TitleGenerator,
    private readonly idleTimeoutMs: number = DEFAULT_IDLE_TIMEOUT_MS,
    runner?: ModelRunner,
    summarizer?: Summarizer,
    invokerFactory?: (cwd: string) => AgentInvoker,
    private readonly scratchRoot: string = defaultScratchRoot(),
  ) {
    this._config = config
    this.injectedModel = model
    this.injectedRunner = runner
    this.injectedSummarizer = summarizer
    this.invokerFactory = invokerFactory ?? ((cwd) => createAgentInvoker(cwd, { readAgents: () => [...FIXED_AGENTS.filter(a => this.getFixedAgents()?.[a.id] !== false), ...readAgentsConfig(cwd)].filter(a => a.enabled) }))
    this.usesEnvModel = !model && !runner
    this.planMode = new PlanMode()
    this.titleGenerator = titleGenerator ?? (this.usesEnvModel ? buildDefaultTitleGenerator(config) : undefined)
    this.orchMode = config.orchMode ?? 'fast'

    this.backgroundManager = new BackgroundManager(id, {
      maxTasks: Session.MAX_BACKGROUND_TASKS,
      maxRetainedMeta: Session.MAX_RETAINED_BACKGROUND_META,
    })

    this.cronManager = new CronManager(id, store)

    this.eventStore = store ? new EventStore(store.getDb()) : undefined
    this.snapshotStore = store ? new SnapshotStore(store.getDb()) : undefined
    this.inputQueueStore = store ? new SessionInputQueue(store, id) : undefined
    if (this.inputQueueStore) {
      this.inputQueue.push(...this.inputQueueStore.restore())
    }

    this.git = new GitOperations(id, store)
    this.permissions = new PermissionManager(
      () => this._config.permissionMode ?? 'edit',
      (mode) => { if (this.running) return false; this._config = { ...this._config, permissionMode: mode }; return true },
      { enableStickyApproval: this._config.enableStickyApproval ?? true },
    )
    this.permissions.setApprovalCache(this.approvalCache)
    this.agentProv = new AgentProviderManager(id, store, () => this._config, this.invokerFactory)
    this.configMgr = new ConfigManager(
      () => this._config, (cfg) => { this._config = cfg }, () => this.running,
      this.usesEnvModel, () => this.buildAgent(),
      () => this.agentProv.isExternalAgent(), () => this.modelDirty, (v) => { this.modelDirty = v },
      this.hooks,
    )
    this.buildAgent()
    this.configMgr.loadPluginComponents()
    this.recoverFromCrash()
    this.reconcileBackgroundTasks()
  }

  /** Reconcile persisted background task state after a process restart. */
  private reconcileBackgroundTasks(): void {
    const lost = this.backgroundManager.reconcile()
    if (lost.length > 0) {
      logInfo('session', 'background:reconciled', { sessionId: this.id, lostTasks: lost })
    }
  }

  get config(): SessionConfig { return this._config }
  private buildAgent(): void { this.app = buildGraph() }

  private modelRunner(): ModelRunner {
    if (this.injectedRunner) return this.injectedRunner
    return new RealModelRunner((this.injectedModel as BaseChatModel | undefined) ?? buildModel(this._config, this.getActiveProfile().modelBinding))
  }

  private summarizer(): Summarizer {
    if (this.injectedSummarizer) return this.injectedSummarizer
    return this.usesEnvModel ? createSummarizer() : NOOP_SUMMARIZER
  }

  private get workflowDeps(): WorkflowRunDeps {
    return {
      id: this.id,
      config: this._config,
      modelRunner: () => this.modelRunner(),
      summarizer: () => this.summarizer(),
      invokerFactory: this.agentProv.invoker,
      store: this.store,
      idleTimeoutMs: this.idleTimeoutMs,
      pendingPermissions: this.permissions.pendingPermissions,
      orchestratorRunner: this.orchestratorRunner,
      networkPolicy: this.networkPolicy,
      toolOutputStore: this.toolOutputStore,
      guardianReviewer: this.usesEnvModel ? new GuardianReviewer({ modelRunner: this.modelRunner() }) : undefined,
    }
  }

  /** Compact the in-memory message history on demand (e.g. from the /compact slash command).
   *  Returns token counts and message counts before/after for the UI to display. */
  async compactNow(): Promise<{ inputTokens: number; outputTokens: number; messagesBefore: number; messagesAfter: number }> {
    const before = this.messages.length
    const tokensBefore = estimateTokens(this.messages)
    const result = await compactMessages(this.messages, { keepRecentTurns: KEEP_RECENT_TURNS, summarizer: this.summarizer() })
    if (!result) {
      return { inputTokens: tokensBefore, outputTokens: 0, messagesBefore: before, messagesAfter: before }
    }
    const idsToRemove = new Set([result.summary.id, ...result.removeIds])
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const id = this.messages[i].id
      if (id && idsToRemove.has(id)) {
        this.messages.splice(i, 1)
      }
    }
    this.messages.push(result.summary)
    const after = this.messages.length
    const tokensAfter = estimateTokens(this.messages)
    return { inputTokens: tokensBefore, outputTokens: tokensAfter, messagesBefore: before, messagesAfter: after }
  }

  // ── Git delegation ──
  async captureSnapshot() { await this.git.captureSnapshot(this._config.cwd) }
  private reseedLastCheckpoint() { this.git.reseedLastCheckpoint() }
  async workspaceDiff(base: DiffBase = 'head'): Promise<{ state: DiffState; base: DiffBase; hasSessionStart: boolean; files?: DiffFile[]; summary?: DiffSummary; error?: string }> { return this.git.workspaceDiff(this._config.cwd, base) }
  async workspaceDiffSummary(base: DiffBase = 'head'): Promise<{ state: DiffState; base: DiffBase; hasSessionStart: boolean; summary?: DiffSummary; error?: string }> { return this.git.workspaceDiffSummary(this._config.cwd, base) }
  async workspaceDiffFile(filePath: string, base: DiffBase = 'head', context?: number | 'full'): Promise<{ state: DiffState; file?: DiffFile; error?: string }> { return this.git.workspaceDiffFile(this._config.cwd, filePath, base, context) }
  async workspaceGitInit(): Promise<{ ok: boolean; error?: string }> { return this.git.workspaceGitInit(this._config.cwd) }
  async captureCheckpoint(turnId: string, label: string | null, send: SendFn) { await this.git.captureCheckpoint(this._config.cwd, turnId, label, send) }
  async listCheckpoints(): Promise<{ checkpoints: Checkpoint[]; isGitRepo: boolean; currentBranch: string | null }> { return this.git.listCheckpoints(this._config.cwd) }
  async checkpointDiff(checkpointId: string, mode: CheckpointMode): Promise<{ state: DiffState; files?: DiffFile[]; summary?: DiffSummary; error?: string }> { return this.git.checkpointDiff(this._config.cwd, checkpointId, mode) }
  async commitLog(): Promise<{ state: DiffState; commits?: CommitLogEntry[]; error?: string }> { return this.git.commitLog(this._config.cwd) }
  async revertCheckpoint(checkpointId: string, send: SendFn): Promise<{ ok: boolean; safetyCheckpointId?: string; error?: string }> { return this.git.revertCheckpoint(this._config.cwd, checkpointId, send) }
  async listBranches(): Promise<{ branches: Branch[]; currentBranch: string | null }> { return this.git.listBranches(this._config.cwd) }
  async switchBranch(branch: string): Promise<{ ok: boolean; currentBranch: string | null; error?: string }> { return this.git.switchBranch(this._config.cwd, branch) }

  // ── Permission delegation ──
  setPermissionMode(permissionMode: PermissionMode): boolean { return this.configMgr.setPermissionMode(permissionMode) }
  respondPermission(requestId: string, choice: { optionId: string } | { cancelled: true }): void { this.permissions.respondPermission(requestId, choice) }

  // ── Agent provider delegation ──
  async setAgentConfigOption(configId: string, value: string): Promise<void> { await this.agentProv.setAgentConfigOption(configId, value) }

  // ── Config delegation ──
  setCwd(cwd: string): void { this.configMgr.setCwd(cwd) }
  setThinking(thinking: boolean): boolean { return this.configMgr.setThinking(thinking) }
  setModel(llmProvider: string): boolean { return this.configMgr.setModel(llmProvider) }
  setSystemPrompt(systemPrompt: string | null): boolean { return this.configMgr.setSystemPrompt(systemPrompt) }
  setOrchMode(orchMode: OrchestrationMode): boolean {
    if (this.running) return false
    const changed = this.orchMode !== orchMode
    this._config = { ...this._config, orchMode }
    this.orchMode = orchMode
    return changed
  }
  applyActiveModel(): boolean { return this.configMgr.applyActiveModel() }
  reloadPlugins(): void { this.configMgr.reloadPlugins() }

  // ── Profile delegation ──
  private getFixedAgents(): Record<string, boolean> | undefined {
    const cwd = this._config.cwd ?? process.cwd()
    return resolveEffectiveConfig(cwd).fixedAgents
  }

  setAgentProfile(id: string): boolean { return this.profileMgr.setActiveProfile(id, this.getFixedAgents()) }
  getActiveProfile(): AgentProfile { return this.profileMgr.getActiveProfile(this.getFixedAgents()) }
  listProfiles(): AgentProfile[] { return this.profileMgr.listProfiles(this._config.cwd, this.getFixedAgents()) }

  // ── FS helpers ──
  async lsDir(absPath: string): Promise<{ entries?: FsEntry[]; error?: string }> {
    if (!this._config.cwd) return { error: 'no_workspace' }
    try { return { entries: await workspaceFs.lsDir(this._config.cwd, absPath) } }
    catch (e) { return { error: e instanceof Error ? e.message : String(e) } }
  }

  async readForPreview(absPath: string): Promise<workspaceFs.PreviewResult> {
    if (!this._config.cwd) return { error: 'no_workspace' }
    try { return await workspaceFs.readForPreview(this._config.cwd, absPath) }
    catch (e) { return { error: e instanceof Error ? e.message : String(e) } }
  }

  // ── Lifecycle ──
  /**
   * Silent crash recovery: mark any tool calls that were still running when the
   * previous sidecar process died as failed, then warm-start the in-memory
   * message list from the latest snapshot if one exists. Emits durable events
   * but never sends WebSocket messages — recovery must be invisible to the UI.
   */
  private recoverFromCrash(): void {
    if (!this.store || !this.eventStore || !this.snapshotStore) return

    const running = this.findRunningToolCalls()
    for (const { callId, stepId } of running) {
      this.emit(
        { type: 'tool_failed', sessionId: this.id, callId, error: 'interrupted by sidecar crash', timestamp: Date.now() },
        { stepId },
      )
    }

    const snapshot = loadSessionSnapshot(this.snapshotStore, this.id)
    if (snapshot != null && snapshot.messages.length > 0) {
      this.messages.length = 0
      this.messages.push(...snapshot.messages)
    }
  }

  private findRunningToolCalls(): Array<{ callId: string; stepId: string }> {
    if (!this.store) return []
    const rows = loadProjection(this.store.getDb(), this.id)
    const running: Array<{ callId: string; stepId: string }> = []
    for (const row of rows) {
      if (!isAssistantStep(row.data)) continue
      for (const tc of row.data.toolCalls) {
        if (tc.status === 'running') running.push({ callId: tc.callId, stepId: row.data.stepId })
      }
    }
    return running
  }

  /** Rebuild the in-memory message list from the event-sourced projection.
   *  Falls back to the legacy messages table when the projection is empty.
   *  The event projection is authoritative when it exists: it contains any
   *  messages persisted after the last snapshot (e.g. an attachment-bearing
   *  user message sent just before an interruption). */
  hydrate(messages?: Message[]): void {
    this.messages.length = 0
    const rebuilt = this.rebuildMessagesFromEvents(this.id)
    if (rebuilt.length > 0) {
      this.messages.push(...rebuilt)
    } else if (messages && messages.length > 0) {
      for (const m of messages) {
        this.messages.push(m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content))
      }
    } else if (this.store) {
      for (const m of this.store.loadMessages(this.id)) {
        this.messages.push(m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content))
      }
    }
    // If the projection and legacy tables are both empty, fall back to the last
    // snapshot so a session that lost its event log is not left with no history.
    if (this.messages.length === 0 && this.snapshotStore) {
      const snapshot = loadSessionSnapshot(this.snapshotStore, this.id)
      if (snapshot != null && snapshot.messages.length > 0) {
        this.messages.push(...snapshot.messages)
      }
    }
    this.reseedLastCheckpoint()
  }

  private lastUserMessageRow(): Extract<SessionMessageData, { role: 'user' }> | null {
    if (!this.store) return null
    const rows = loadProjection(this.store.getDb(), this.id)
    for (let i = rows.length - 1; i >= 0; i--) {
      const d = rows[i].data
      if (d.role === 'user') return d
    }
    return null
  }

  private incompleteAssistantStepAfter(userMessageId: string): { stepId: string; agentId: string } | null {
    if (!this.store) return null
    const rows = loadProjection(this.store.getDb(), this.id)
    let userIndex = -1
    for (let i = rows.length - 1; i >= 0; i--) {
      const d = rows[i].data
      if (d.role === 'user' && d.messageId === userMessageId) {
        userIndex = i
        break
      }
    }
    if (userIndex === -1) return null
    for (let i = userIndex + 1; i < rows.length; i++) {
      const d = rows[i].data
      if (d.role === 'assistant' && !('kind' in d) && d.content === '' && d.finishedAt === null) {
        return { stepId: d.stepId, agentId: d.agentId }
      }
    }
    return null
  }

  private async rebuildPartsForImageAgent(userData: Extract<SessionMessageData, { role: 'user' }>): Promise<ContentPart[]> {
    const fromParts = userData.contentParts?.filter((p): p is ContentPart => isContentPart(p as Record<string, unknown>))
    if (fromParts && fromParts.length > 0) return fromParts
    const attachments = (userData.attachments ?? []).map((a) => ({ ...a, path: join(scratchDirFor(this.id, this.scratchRoot), 'attachments', a.id, a.name) }) as AttachmentPayload)
    return attachments.length ? await buildAttachmentContentParts(attachments) : []
  }

  /** Load session_message rows and map them back to LangGraph BaseMessages.
   *  This is the boundary where events become the source of truth for LoopState. */
  rebuildMessagesFromEvents(sessionId: string): BaseMessage[] {
    if (!this.store) return []
    const rows = loadProjection(this.store.getDb(), sessionId)
    return rows.flatMap((r) => rowToBaseMessage(r.data))
  }

  private requireCompatibleModel(send: SendFn): boolean {
    if (this.agentProv.isExternalAgent()) return true
    if (this.usesEnvModel) {
      const { providerID } = getActiveModel()
      if (!isOpenAICompatible(providerID)) {
        send({ type: 'error', sessionId: this.id, code: 'INCOMPATIBLE_MODEL', message: `Provider "${providerID}" is not OpenAI-compatible and can't be used here. Pick an OpenAI-compatible model in Settings.` })
        return false
      }
    }
    return true
  }

  private requireApiKey(send: SendFn): boolean {
    if (this.agentProv.isExternalAgent()) return true
    if (this.usesEnvModel) {
      const { providerID } = getActiveModel()
      if (!resolveApiKey(providerID)) {
        send({ type: 'error', sessionId: this.id, code: 'NO_API_KEY', message: 'API key not configured. Set it in Settings.' })
        return false
      }
    }
    return true
  }

  private currentModelSupportsImages(): boolean {
    const choice = resolveModelChoice(this._config, getActiveModel(), this.getActiveProfile().modelBinding)
    return isMultimodalModel(choice.providerID, choice.modelID)
  }

  async sendMessage(content: string, _send: SendFn, userMessageId?: string, attachments?: AttachmentPayload[]): Promise<void> {
    this.enqueueInput({ type: 'message', content, messageId: userMessageId, attachments })
    if (this.running || this.awaitingResume) return
    await this.drainInputQueue(_send)
  }

  private async processInput(input: SessionInput, _send: SendFn): Promise<string> {
    return processInput(this as unknown as SessionTurnHost, input, _send)
  }


  restorePendingInputs(): void {
    if (!this.inputQueueStore) return
    this.inputQueue.length = 0
    this.inputQueue.push(...this.inputQueueStore.restore())
  }

  enqueueInput(input: SessionInput): void {
    const id = this.inputQueueStore?.admit(input)
    if (id && !input.messageId) input.messageId = id
    this.inputQueue.push(input)
    if (input.type === 'steer' && this.running && this.abortController) {
      this.steerAbortFlag = true
      this.abortController.abort()
    }
  }

  promoteSteerInput(): SessionInput | undefined {
    this.inputQueueStore?.promoteSteer()
    let idx = -1
    for (let i = this.inputQueue.length - 1; i >= 0; i--) {
      if (this.inputQueue[i].type === 'steer') {
        idx = i
        break
      }
    }
    if (idx === -1) return undefined
    const [steer] = this.inputQueue.splice(idx, 1)
    this.inputQueue.splice(0, idx)
    return steer
  }

  async drainInputQueue(_send: SendFn): Promise<void> {
    while (!this.running && !this.awaitingResume) {
      const steer = this.promoteSteerInput()
      const input = steer ?? this.inputQueue.shift()
      if (!input) return
      if (input.type === 'message' && input.messageId) {
        this.inputQueueStore?.promoteById(input.messageId)
      }
      await this.processInput(input, _send)
    }
  }

  private hasSteerInput(): boolean {
    return this.inputQueue.some((i) => i.type === 'steer')
  }

  private checkSteerPromotion(): void {
    if (this.running && this.abortController && this.hasSteerInput()) {
      this.steerAbortFlag = true
      this.abortController.abort()
    }
  }

  async resume(content: string, send: SendFn, attachments?: AttachmentPayload[]): Promise<void> {
    return resume(this as unknown as SessionTurnHost, content, send, attachments)
  }


  private async runManagedAgentTurn(input: SessionInput, agent: AgentConfig, parts: ContentPart[], _send: SendFn, isFirstTurn: boolean, reuseTurnId?: string): Promise<string> {
    return runManagedAgentTurn(this as unknown as SessionTurnHost, input, agent, parts, _send, isFirstTurn, reuseTurnId)
  }


  private async runTurn(rawSend: SendFn, base?: {
    messages: BaseMessage[]
    steps: number
    planningMode?: 'fast' | 'plan'
    planStatus?: 'none' | 'generating' | 'ready' | 'approved' | 'rejected'
    plan?: PlanItem[]
  }): Promise<string> {
    return runTurn(this as unknown as SessionTurnHost, rawSend, base)
  }


  async runWorkflowTurn(def: WorkflowDef, send: SendFn): Promise<string> {
    return runWorkflowTurnFn(
      this.workflowDeps,
      def, send,
      (s, turnId, text, traj, stopped) => this.finalizeAndPersist(s, turnId, text, traj, stopped),
    )
  }

  /** Dual-write helper: persists the legacy representation AND publishes a durable
   *  event (plus its session_message projection) inside a single SQLite transaction. */
  private emit(event: SessionEvent, context?: { stepId?: string; usage?: TurnUsage; runs?: AgentRun[]; assistant?: { id: string; sessionId: string; agentId: string; content: string; timestamp: number; stopped?: boolean; timeline?: TimelineStep[] } | null }): void {
    emitSessionEvent(this.persistDeps(), event, context)
  }

  private persistDeps() {
    return {
      id: this.id,
      store: this.store,
      eventStore: this.eventStore,
      snapshotStore: this.snapshotStore,
      config: this._config,
      messages: this.messages,
    }
  }

  private finalizeAndPersist(send: SendFn, turnId: string, supervisorText: string, trajectory: Map<string, TraceRun>, stopped: boolean, usageByAgent?: Map<string, TurnUsage>, targetMessages: BaseMessage[] = this.messages): string {
    return finalizeAndPersistTurn(this.persistDeps(), send, turnId, supervisorText, trajectory, stopped, usageByAgent, targetMessages)
  }

  async regenerate(send: SendFn): Promise<void> {
    return regenerate(this as unknown as SessionTurnHost, send)
  }


  async handlePlanResponse(action: 'approve' | 'reject' | 'amend', send: SendFn, amendContent?: string): Promise<void> {
    return handlePlanResponse(this as unknown as SessionTurnHost, action, send, amendContent)
  }


  cancel(): void {
    if (this.awaitingResume) { this.awaitingResume = false; this.paused = null; return }
    this.abortController?.abort()
    this.resumeAbortController?.abort()
  }

  /**
   * Retry a previously failed or interrupted subagent with the original task
   * description. Prior message history (before the failed turn) is preserved;
   * the failed turn itself is excluded so the retry starts clean.
   *
   * When called from inside runTurn, pass a real `emit` so tokens/reasoning/tools
   * are recorded as part of the current turn. When called standalone, emit is
   * omitted and the method emits its own agent:started/finished lifecycle events.
   */
  async retrySubagent(agentId: string, send: SendFn, emit?: GraphEmit): Promise<string> {
    return retrySubagent(this as unknown as SessionTurnHost, agentId, send, emit)
  }


  async resumeSubagent(taskId: string, content: string, send: SendFn): Promise<void> {
    return resumeSubagent(this as unknown as SessionTurnHost, taskId, content, send)
  }


  async destroy(): Promise<void> {
    this.cancel()
    if (this.backgroundManager.totalCount > 0) {
      const timeout = new Promise<'timed_out'>((resolve) => setTimeout(() => resolve('timed_out'), 5_000))
      await Promise.race([Promise.allSettled([...this.backgroundManager.tasks.values()]).then(() => 'settled' as const), timeout])
      this.backgroundManager.clear()
    }
    this.spawnedSubagentIds.clear()
    this.agentProv.dispose()
  }
}

