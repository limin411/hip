import type { ServerMessage, SessionConfig, AgentRole, Message, AgentRun, FsEntry, TurnUsage, DiffBase, DiffFile, DiffState, DiffSummary, Checkpoint, CommitLogEntry, CheckpointMode, Branch, PermissionMode, WorkflowDef, Hook, SkillMeta, AgentConfig, McpServerConfig, PlanItem, SessionEvent, TimelineStep, Attachment, ContentPart } from '@hip/protocol'
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
import { estimateTokens, COMPACT_BUDGET_TOKENS, type Summarizer } from './compaction.js'
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
import { runWorkflowTurn as runWorkflowTurnFn } from './workflow-runner.js'
import { shouldPlan } from './plan.js'
import { AgentProfileManager } from './agent-profile-manager.js'
import type { AgentProfile } from './agent-profile.js'
import { ToolOutputStore } from './tool-output-store.js'
import { NetworkPolicy, loadNetworkPolicyConfig } from './network-policy.js'
import { GuardianReviewer } from './guardian.js'
import { SessionInputQueue, type SessionInput } from './session-input.js'
import { prepareSessionContext, type SessionContextState } from './session-context.js'
import { validateAttachments, stageAttachments, buildAttachmentContentParts, type AttachmentPayload } from './attachments.js'
import { defaultScratchRoot } from './scratch.js'
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

export { sanitizeTitle } from './title-generator.js'
export type { TitleGenerator } from './title-generator.js'
export type { SessionInput } from './session-input.js'

type SendFn = (msg: ServerMessage) => void
export const DEFAULT_IDLE_TIMEOUT_MS = 60_000

export function resolveModel(config: SessionConfig): string {
  return config.model || (config.thinking === false ? 'deepseek-chat' : 'deepseek-reasoner')
}

function lastUserText(messages: BaseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.getType() === 'human') return typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
  }
  return ''
}

function logNonCritical(label: string, err: unknown): void {
  console.warn(`[session:${label}]`, err instanceof Error ? err.message : String(err))
}

export function resolveModelChoice(
  config: Pick<SessionConfig, 'llmProvider' | 'model' | 'baseURL'>,
  fallback: { providerID: string; modelID: string; baseURL: string },
  profileBinding?: { providerID: string; modelID: string },
): { providerID: string; modelID: string; baseURL: string } {
  if (profileBinding) {
    return { providerID: profileBinding.providerID, modelID: profileBinding.modelID, baseURL: config.baseURL || fallback.baseURL }
  }
  if (config.model) {
    return { providerID: config.llmProvider || fallback.providerID, modelID: config.model, baseURL: config.baseURL || fallback.baseURL }
  }
  return fallback
}

function buildModel(config: SessionConfig, profileBinding?: { providerID: string; modelID: string }): BaseChatModel {
  return buildChatModel(resolveModelChoice(config, getActiveModel(), profileBinding))
}

const NOOP_SUMMARIZER: Summarizer = { async summarize() { return '' } }

/** Permission kinds that are considered safe (non-destructive) and auto-resolve
 *  in chat mode without emitting a `permission:request` to the user. */
export const SAFE_KINDS = new Set(['read', 'fetch', 'other'])

/**
 * Auto-resolve safe (non-file-modifying) permission requests without user prompting.
 * Returns a {@link PermissionChoice} if the request should be auto-resolved, or
 * `null` if it should go through the normal HITL prompt flow.
 *
 * Auto-resolve rules:
 * - In full mode, permissions are already auto-allowed upstream — skip.
 * - In chat and edit modes, auto-resolve for safe kinds (non-file-modifying ops).
 * - Only for kinds in {@link SAFE_KINDS} (`read`/`fetch`/`other`).
 * - Resolves to the first `allow_*` option, or the first option overall, or `{ cancelled: true }` if no options exist.
 */
export function tryAutoResolvePermission(
  mode: PermissionMode,
  kind: string,
  options: Array<{ optionId: string; kind: string }>,
): PermissionChoice | null {
  if (mode === 'full') return null
  if (!SAFE_KINDS.has(kind)) return null
  const allowOpt = options.find((o) => o.kind.startsWith('allow'))
  if (allowOpt) return { optionId: allowOpt.optionId }
  if (options.length > 0) return { optionId: options[0].optionId }
  return { cancelled: true }
}

export class Session {
  private app!: ReturnType<typeof buildGraph>
  private orchestratorRunner?: AgentRunner
  private readonly hooks = new HookRegistry()
  private readonly injectedRunner?: ModelRunner
  _config: SessionConfig
  private readonly injectedModel?: BaseLanguageModel
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
  private readonly titleGenerator?: TitleGenerator
  private readonly invokerFactory: (cwd: string) => AgentInvoker
  readonly backgroundManager: BackgroundManager
  readonly cronManager: CronManager
  /** @deprecated Use backgroundManager.tasks instead. Kept for test backward-compat. */
  get backgroundTasks(): Map<string, Promise<void>> { return this.backgroundManager.tasks }
  /** @deprecated Use backgroundManager.meta instead. Kept for internal backward-compat. */
  private get backgroundTaskMeta(): Map<string, { description: string; status: 'running' | 'completed' | 'failed'; result?: string; error?: string }> {
    return this.backgroundManager.meta as Map<string, { description: string; status: 'running' | 'completed' | 'failed'; result?: string; error?: string }>
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
    const cwd = this._config.cwd ?? process.cwd()
    const runner = this.modelRunner()
    const summarizer = this.summarizer()
    const rawMode = this._config.permissionMode
    const mode: PermissionMode = rawMode === 'chat' || rawMode === 'full' ? rawMode : 'edit'
    const requestApproval = this.permissions.buildRequestApproval(send, this.id, '', () => 0, mode, this.hooks)

    send({ type: 'agent:started', sessionId: this.id, turnId: `bg-turn-${taskId}`, agentId: taskId, role: 'worker', taskId, taskInput: description })

    const syntheticAgentId = `bg-${taskId}`
    const syntheticTurnId = `bg-turn-${taskId}`
    let result = ''
    let status: 'completed' | 'failed' = 'completed'
    let error: string | undefined

    try {
      result = await runSubagent({
        runner,
        root: cwd,
        summarizer,
        emit: { token: () => {}, reasoning: () => {}, toolStarted: () => {}, toolFinished: () => {}, usage: () => {}, planDelta: () => {}, compaction: () => {} },
        signal,
        description,
        childMaxSteps: CHILD_MAX_STEPS,
        permissionMode: mode,
        requestApproval,
        mode: 'background',
        sessionId: this.id,
        networkPolicy: this.networkPolicy,
        toolOutputStore: this.toolOutputStore,
        guardianReviewer: this.usesEnvModel ? new GuardianReviewer({ modelRunner: runner }) : undefined,
      })
    } catch (err) {
      const msg = safeErrorMessage(err)
      console.error(`Background task ${taskId} failed:`, err instanceof Error ? err.message : String(err))
      result = `Error: ${msg}`
      status = 'failed'
      error = msg
    }

    this.backgroundManager.completeTask(taskId, status, error === undefined ? result : undefined, error)

    const ts = Date.now()
    this.emit({ type: 'step_started', sessionId: this.id, turnId: syntheticTurnId, agentId: syntheticAgentId, timestamp: ts })
    this.emit({ type: 'text_started', sessionId: this.id, messageId: syntheticTurnId, timestamp: ts })
    this.emit({ type: 'text_ended', sessionId: this.id, messageId: syntheticTurnId, content: result, timestamp: ts })
    this.emit({ type: 'step_ended', sessionId: this.id, turnId: syntheticTurnId, agentId: syntheticAgentId, timestamp: ts })
    this.messages.push(new AIMessage(result))

    send({
      type: 'agent:notification',
      sessionId: this.id,
      taskId,
      description,
      status,
      ...(error === undefined ? { result } : { error }),
    })
    send({ type: 'agent:finished', sessionId: this.id, turnId: syntheticTurnId, agentId: taskId })
  }

  private loadSubagentMessages(taskId: string): BaseMessage[] {
    if (!this.store) return []
    try {
      return this.store.getMessages(taskId).map((m) =>
        m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content),
      )
    } catch (err) {
      console.error(`Failed to load prior messages for subagent ${taskId}:`, err instanceof Error ? err.message : String(err))
      return []
    }
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
    this.invokerFactory = invokerFactory ?? ((cwd) => createAgentInvoker(cwd))
    this.usesEnvModel = !model && !runner
    this.titleGenerator = titleGenerator ?? (this.usesEnvModel ? buildDefaultTitleGenerator(config) : undefined)

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
  applyActiveModel(): boolean { return this.configMgr.applyActiveModel() }
  reloadPlugins(): void { this.configMgr.reloadPlugins() }

  // ── Profile delegation ──
  setAgentProfile(id: string): boolean { return this.profileMgr.setActiveProfile(id) }
  getActiveProfile(): AgentProfile { return this.profileMgr.getActiveProfile() }
  listProfiles(): AgentProfile[] { return this.profileMgr.listProfiles(this._config.cwd) }

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
   *  If crash recovery already warm-started messages from a snapshot, skip
   *  rebuilding so the snapshot remains the source of truth. */
  hydrate(messages?: Message[]): void {
    if (this.messages.length > 0) {
      this.reseedLastCheckpoint()
      return
    }
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
    this.reseedLastCheckpoint()
  }

  /** Load session_message rows and map them back to LangGraph BaseMessages.
   *  This is the boundary where events become the source of truth for LoopState. */
  rebuildMessagesFromEvents(sessionId: string): BaseMessage[] {
    if (!this.store) return []
    const rows = loadProjection(this.store.getDb(), sessionId)
    return rows.map((r) => rowToBaseMessage(r.data))
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
    if (this.modelDirty) { this.buildAgent(); this.modelDirty = false }
    if (!this.requireCompatibleModel(_send)) return ''
    if (!this.requireApiKey(_send)) return ''

    const hasImageAttachment = input.attachments?.some((a) => a.mimeType.startsWith('image/'))

    const userTs = Date.now()
    let isFirstTurn = false
    const parts: ContentPart[] = []
    if (input.content) parts.push({ type: 'text', text: input.content })

    const modelSupportsImages = this.currentModelSupportsImages()
    const needsImageAgent = hasImageAttachment && !modelSupportsImages
    let imageAgent: AgentConfig | null = null
    let imageAgentError: string | null = null
    if (needsImageAgent) {
      try {
        imageAgent = selectImageAgent(this._config.cwd ?? process.cwd(), input.content)
      } catch (err) {
        imageAgentError = err instanceof Error ? err.message : String(err)
        console.warn('Failed to select image agent:', imageAgentError)
      }
    }

    if (input.attachments?.length) {
      await validateAttachments(input.attachments)
      const staged = await stageAttachments(this.id, input.attachments, this.scratchRoot)
      const attachmentParts = await buildAttachmentContentParts(input.attachments)
      parts.push(...attachmentParts)
      if (this.store) {
        isFirstTurn = !this.store.hasMessages(this.id)
        // When dispatching to an internal multimodal agent, keep image_url parts out of the
        // main session history so the text-only main model never sees them on follow-up turns.
        // Also keep them out when no image agent is available and we are about to error.
        const filterImages = needsImageAgent
        const historyParts = filterImages ? undefined : (isRichContentParts(parts) ? parts : undefined)
        this.emit({ type: 'user_message', sessionId: this.id, content: input.content, messageId: input.messageId ?? `u-${userTs}`, timestamp: userTs, attachments: staged, ...(historyParts?.length ? { contentParts: historyParts } : {}) })
      }
    } else if (this.store) {
      isFirstTurn = !this.store.hasMessages(this.id)
      this.emit({ type: 'user_message', sessionId: this.id, content: input.content, messageId: input.messageId ?? `u-${userTs}`, timestamp: userTs })
    }

    if (this.store && isFirstTurn && this.store.updateTitleIfAuto(this.id, deriveTitle(input.content)) === 1) {
      _send({ type: 'session:title', sessionId: this.id, title: deriveTitle(input.content) })
    }

    const promptResult = await this.hooks.fire('UserPromptSubmit', { sessionId: this.id }).catch(() => ({ kind: 'deny' as const, reason: 'Hook error' }))
    if (promptResult.kind !== 'allow') {
      _send({ type: 'error', sessionId: this.id, code: 'HOOK_DENIED', message: `User prompt rejected: ${promptResult.reason ?? 'blocked by hook'}` })
      return ''
    }
    if (isFirstTurn) void this.hooks.fire('SessionStart', { sessionId: this.id }).catch((err) => logNonCritical('SessionStart', err))

    if (input.type === 'message') {
      if (this.activeActivity) this.endActivity()
      this.startActivity(input.content)
    }

    if (imageAgent) {
      // TODO: when the turn also contains non-image attachments (e.g. PDF),
      // those parts are currently forwarded to the image agent. The spec says
      // PDF/text should stay with the main model; implement splitting once we
      // can run multiple sub-agents or stream both branches.
      return this.runManagedAgentTurn(input, imageAgent, parts, _send, isFirstTurn)
    }

    if (needsImageAgent) {
      this.endActivity()
      // Keep in-memory history in sync with the persisted user_message event.
      this.messages.push(new HumanMessage(input.content))
      const message = imageAgentError
        ? `Image agent selection failed: ${imageAgentError}. Please enable a multimodal agent or switch to a multimodal model.`
        : 'No image-capable agent is available. Please enable a multimodal agent or switch to a multimodal model.'
      _send({ type: 'error', sessionId: this.id, code: 'NO_IMAGE_AGENT', message })
      return ''
    }

    this.messages.push(parts.length === 1 && parts[0].type === 'text'
      ? new HumanMessage(input.content)
      : new HumanMessage({ content: parts }))
    const supervisorText = await this.runTurn(_send)

    if (isFirstTurn) {
      await this.generateFirstTurnTitle(input, supervisorText, _send)
    }
    return supervisorText
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
    if (!this.awaitingResume || !this.paused || this.running) return
    const parts: ContentPart[] = []
    if (content) parts.push({ type: 'text', text: content })
    let staged: Attachment[] | undefined

    if (attachments?.length) {
      await validateAttachments(attachments)
      staged = await stageAttachments(this.id, attachments, this.scratchRoot)
      const attachmentParts = await buildAttachmentContentParts(attachments)
      parts.push(...attachmentParts)
    }

    const humanMessage = parts.length === 1 && parts[0].type === 'text'
      ? new HumanMessage(content)
      : new HumanMessage({ content: parts })

    const base = {
      messages: [...this.paused.messages, humanMessage],
      steps: this.paused.steps,
      planningMode: this.paused.planningMode,
      planStatus: this.paused.planStatus,
      plan: this.paused.plan,
    }
    this.awaitingResume = false; this.paused = null
    const ts = Date.now()
    if (this.store) {
      this.emit({ type: 'user_message', sessionId: this.id, content, messageId: `u-${ts}`, timestamp: ts, ...(staged?.length ? { attachments: staged } : {}), ...(isRichContentParts(parts) ? { contentParts: parts } : {}) })
    }
    this.messages.push(humanMessage)
    await this.runTurn(send, base)
  }

  private async runManagedAgentTurn(input: SessionInput, agent: AgentConfig, parts: ContentPart[], _send: SendFn, isFirstTurn: boolean): Promise<string> {
    const turnId = `asst-managed-${agent.id}-${Date.now()}-${this.turnSeq++}`
    logInfo('session', 'turn:start', { sessionId: this.id, turnId, agentId: agent.id })
    this.abortController = new AbortController()
    this.running = true

    const cwd = this._config.cwd ?? process.cwd()
    const mode = this.resolvePermissionMode()
    const requestApproval = this.permissions.buildRequestApproval(_send, this.id, turnId, () => 0, mode, this.hooks)

    let stepSeq = 0
    let reasoningSeq = 0
    const usageByAgent = new Map<string, TurnUsage>()
    const emit: GraphEmit = {
      token: (delta) => { _send({ type: 'token:stream', sessionId: this.id, turnId, agentId: agent.id, delta }) },
      reasoning: (delta) => { _send({ type: 'reasoning:delta', sessionId: this.id, turnId, agentId: agent.id, role: 'subagent', stepSeq: reasoningSeq++, delta }) },
      toolStarted: (name, callId, input) => { _send({ type: 'tool:started', sessionId: this.id, turnId, agentId: agent.id, role: 'subagent', callId, name, input: typeof input === 'string' ? input : JSON.stringify(input), seq: stepSeq++ }) },
      toolFinished: (callId, status, output, error) => { _send({ type: 'tool:finished', sessionId: this.id, turnId, agentId: agent.id, callId, status, ...(output ? { output } : {}), ...(error ? { error } : {}) }) },
      usage: (u) => { usageByAgent.set(agent.id, addUsage(usageByAgent.get(agent.id), u)) },
      planDelta: () => {},
      compaction: () => {},
    }

    // Use role 'supervisor' so the frontend creates the assistant message container that holds
    // streaming tokens for this turn.
    _send({ type: 'agent:started', sessionId: this.id, turnId, agentId: agent.id, role: 'supervisor' })
    this.emit({ type: 'step_started', sessionId: this.id, turnId, agentId: agent.id, timestamp: Date.now() })
    this.emit({ type: 'text_started', sessionId: this.id, messageId: turnId, timestamp: Date.now() })
    // Keep image_url parts out of the main session history; the agent received them via extras.
    this.messages.push(new HumanMessage(input.content))

    let agentText = ''
    try {
      const invoker = this.agentProv.invoker(cwd)
      // Forward the user's text plus image parts to the image agent. Non-image attachments stay with
      // the main model; mixed-attachment splitting is left for future multi-agent streaming work.
      const agentParts = parts.filter((p) => p.type === 'image_url' || p.type === 'text')
      const imageAttachments = input.attachments?.filter((a) => a.mimeType.startsWith('image/'))
      agentText = await invoker.invoke(agent.id, input.content, emit, this.abortController.signal, undefined, {
        mcpTools: mcpManager.tools(),
        skills: this.configMgr.skills,
        requestApproval,
        permissionMode: mode,
        sessionId: this.id,
        networkPolicy: this.networkPolicy,
        toolOutputStore: this.toolOutputStore,
        guardianReviewer: this.usesEnvModel ? new GuardianReviewer({ modelRunner: this.modelRunner() }) : undefined,
        attachmentParts: agentParts,
      }, imageAttachments)
    } catch (err) {
      logInfo('session', 'turn:error', { sessionId: this.id, turnId, agentId: agent.id, error: err instanceof Error ? err.message : String(err) })
      this.emit({ type: 'step_failed', sessionId: this.id, turnId, agentId: agent.id, error: err instanceof Error ? err.message : String(err), timestamp: Date.now() })
      const isAbort = err instanceof Error && err.name === 'AbortError'
      _send({ type: 'error', sessionId: this.id, code: isAbort ? 'CANCELLED' : 'AGENT_ERROR', message: isAbort ? 'User cancelled the request' : safeErrorMessage(err) })
      this.running = false
      this.abortController = null
      this.endActivity()
      _send({ type: 'agent:finished', sessionId: this.id, turnId, agentId: agent.id })
      return ''
    }

    this.running = false
    this.abortController = null
    this.endActivity()
    _send({ type: 'agent:finished', sessionId: this.id, turnId, agentId: agent.id })

    this.messages.push(new AIMessage(agentText))
    this.emit({ type: 'text_ended', sessionId: this.id, messageId: turnId, content: agentText, timestamp: Date.now() })
    const turnUsage = sumUsage([...usageByAgent.values()])
    this.emit({ type: 'step_ended', sessionId: this.id, turnId, agentId: agent.id, timestamp: Date.now() }, { usage: turnUsage })
    _send({ type: 'message:complete', sessionId: this.id, message: { id: turnId, role: 'assistant', content: agentText, agentId: agent.id, timestamp: Date.now() } })

    if (isFirstTurn) {
      await this.generateFirstTurnTitle(input, agentText, _send)
    }

    return agentText
  }

  private async runTurn(rawSend: SendFn, base?: {
    messages: BaseMessage[]
    steps: number
    planningMode?: 'fast' | 'plan'
    planStatus?: 'none' | 'generating' | 'ready' | 'approved' | 'rejected'
    plan?: PlanItem[]
  }): Promise<string> {
    this.abortController = new AbortController(); this.running = true

    // Reload network policy config at the top of each turn so that
    // edits to ~/.hip/config/network.json take effect without restart.
    // When the file is deleted after previously being loaded, reset to
    // factory defaults.
    const networkCfg = loadNetworkPolicyConfig()
    if (networkCfg) {
      this.networkPolicy.updateConfig(networkCfg)
    } else if (this.networkPolicy.hasLoadedCustomConfig()) {
      this.networkPolicy.reset()
    }

    if (!base && this._config.useEventSource !== false && this.eventStore) {
      const rebuilt = this.rebuildMessagesFromEvents(this.id)
      if (this.messages.length === 0 || rebuilt.length === this.messages.length) {
        this.messages.length = 0
        this.messages.push(...rebuilt)
      }
    }

    let timedOut = false
    const watchdog = new IdleWatchdog(this.idleTimeoutMs, () => { timedOut = true; this.abortController?.abort() })
    const send: SendFn = (msg) => { watchdog.kick(); rawSend(msg) }

    const turnId = `asst-supervisor-${Date.now()}-${this.turnSeq++}`
    logInfo('session', 'turn:start', { sessionId: this.id, turnId })
    const trajectory = new Map<string, TraceRun>()
    let agentSeq = 0; let stepSeq = 0
    const nextSeq = () => stepSeq++
    const started = new Set<string>()
    const usageByAgent = new Map<string, TurnUsage>()
    const recorder: TraceRecorder = {
      start: (agentId, callId, name, input, seq, truncated) => {
        const r = trajectory.get(agentId); if (r) r.toolCalls.set(callId, { callId, agentId, name, input, status: 'running', seq, ...(truncated ? { truncated: true } : {}) })
      },
      finish: (agentId, callId, status, output, error, truncated) => {
        const tc = trajectory.get(agentId)?.toolCalls.get(callId)
        if (!tc) return; tc.status = status
        if (output !== undefined) tc.output = output
        if (error !== undefined) tc.error = error
        if (truncated || tc.truncated) tc.truncated = true
      },
    }
    const reasoning = new ReasoningTracker(nextSeq)
    const reasoningDelta = (agentId: string, role: AgentRole, delta: string) => {
      if (!delta) return
      send({ type: 'reasoning:delta', sessionId: this.id, turnId, agentId, role, stepSeq: reasoning.push(agentId, delta), delta })
    }
    const closeReasoning = (agentId: string) => {
      const burst = reasoning.close(agentId); if (burst) { const r = trajectory.get(agentId); if (r) r.reasoningBursts.push(burst) }
    }
    const ensureStarted = (agentId: string, role: AgentRole, parentAgentId?: string, taskInput?: string, agentTaskId?: string) => {
      if (started.has(agentId)) return; started.add(agentId)
      const stepId = agentId === 'supervisor' ? turnId : agentId
      this.activeSteps.set(agentId, stepId)
      trajectory.set(agentId, { role, output: '', startedAt: Date.now(), finishedAt: null, seq: agentSeq++, toolCalls: new Map(), reasoningBursts: [], ...(parentAgentId ? { parentAgentId } : {}), ...(taskInput ? { taskInput } : {}) })
      logInfo('session', 'agent:started', { sessionId: this.id, turnId, agentId, role })
      send({ type: 'agent:started', sessionId: this.id, turnId, agentId, role, ...(parentAgentId ? { parentAgentId } : {}), ...(taskInput ? { taskInput } : {}), ...(agentTaskId ? { taskId: agentTaskId } : {}) })
      this.emit({ type: 'step_started', sessionId: this.id, turnId: stepId, agentId, timestamp: Date.now() })
      this.emit({ type: 'text_started', sessionId: this.id, messageId: stepId, timestamp: Date.now() })
    }
    const ensureFinished = (agentId: string, output: string) => {
      if (!started.has(agentId)) return; closeReasoning(agentId)
      const r = trajectory.get(agentId); if (r) { r.output = output; r.finishedAt = Date.now() }
      started.delete(agentId); send({ type: 'agent:finished', sessionId: this.id, turnId, agentId })
      const stepId = this.activeSteps.get(agentId) ?? (agentId === 'supervisor' ? turnId : agentId)
      this.emit({ type: 'text_ended', sessionId: this.id, messageId: stepId, content: output, timestamp: Date.now() })
      if (agentId !== 'supervisor') {
        this.emit({ type: 'step_ended', sessionId: this.id, turnId: stepId, agentId, timestamp: Date.now() })
      }
    }
    const finishRemaining = () => {
      for (const id of started) { closeReasoning(id); const r = trajectory.get(id); if (r) r.finishedAt = Date.now(); send({ type: 'agent:finished', sessionId: this.id, turnId, agentId: id }) }
      started.clear()
    }

    let supervisorText = ''

    const turnStartResult = await this.hooks.fire('TurnStart', { sessionId: this.id, turnId }).catch(() => ({ kind: 'deny' as const, reason: 'Hook error' }))
    if (turnStartResult.kind !== 'allow') {
      this.running = false
      this.abortController = null
      rawSend({ type: 'error', sessionId: this.id, code: 'HOOK_DENIED', message: `Turn start rejected: ${turnStartResult.reason ?? 'blocked by hook'}` })
      return ''
    }

    ensureStarted('supervisor', 'supervisor')

    const cronDue = this.cronManager.tick()
    const cronMessages: BaseMessage[] = cronDue.map((p) => new SystemMessage(`<system-reminder>${p}</system-reminder>`))

    const cwd = this._config.cwd ?? process.cwd()
    const runner = this.modelRunner(); const summarizer = this.summarizer()
    const skills = this.configMgr.skills; const pluginAgents = this.configMgr.pluginAgents
    const rawMode = this._config.permissionMode
    const mode: PermissionMode = rawMode === 'chat' || rawMode === 'full' ? rawMode : 'edit'
    const usedTokens = estimateTokens(this.messages)
    const tokenBudgetPercent = Math.max(0, Math.min(100, Math.round(100 - (usedTokens / COMPACT_BUDGET_TOKENS) * 100)))

    const logToken = logDebugEveryN('session', 10, 'token:stream', { sessionId: this.id, turnId, agentId: 'supervisor' })
    const makeEmit = (agentId: string, role: AgentRole): GraphEmit => ({
      token: (delta) => { if (!delta) return; logToken(); if (agentId === 'supervisor') supervisorText += delta; const r = trajectory.get(agentId); if (r) r.output += delta; send({ type: 'token:stream', sessionId: this.id, turnId, agentId, delta }) },
      reasoning: (delta) => reasoningDelta(agentId, role, delta),
      toolStarted: (name, callId, input) => { closeReasoning(agentId); const seq = nextSeq(); const inClip = clip(stringify(input)); recorder.start(agentId, callId, name, inClip.text, seq, inClip.truncated); send({ type: 'tool:started', sessionId: this.id, turnId, agentId, role, callId, name, input: inClip.text, seq, ...(inClip.truncated ? { truncated: true } : {}) }); const stepId = this.activeSteps.get(agentId) ?? (agentId === 'supervisor' ? turnId : agentId); this.emit({ type: 'tool_called', sessionId: this.id, callId, name, input: inClip.text, timestamp: Date.now() }, { stepId }); this.checkSteerPromotion() },
      toolFinished: (callId, status, output, error) => { const outClip = output !== undefined ? clip(stringify(output)) : undefined; recorder.finish(agentId, callId, status, outClip?.text, error, outClip?.truncated ?? false); send({ type: 'tool:finished', sessionId: this.id, turnId, agentId, callId, status, ...(outClip ? { output: outClip.text } : {}), ...(error ? { error } : {}), ...(outClip?.truncated ? { truncated: true } : {}) }); const stepId = this.activeSteps.get(agentId) ?? (agentId === 'supervisor' ? turnId : agentId); if (status === 'finished') { this.emit({ type: 'tool_success', sessionId: this.id, callId, output: outClip?.text ?? '', timestamp: Date.now() }, { stepId }) } else { this.emit({ type: 'tool_failed', sessionId: this.id, callId, error: error ?? '', timestamp: Date.now() }, { stepId }) }; this.checkSteerPromotion() },
      usage: (u) => { usageByAgent.set(agentId, addUsage(usageByAgent.get(agentId), u)) },
      planDelta: (itemId, delta) => { send({ type: 'plan:delta', sessionId: this.id, turnId, itemId, delta }) },
      compaction: (summary: string) => { this.emit({ type: 'compaction_ended', sessionId: this.id, summary, timestamp: Date.now() }) },
    })
    const emit = makeEmit('supervisor', 'supervisor')
    let subagentSeq = 0
    const spawnSubagent = async (description: string, subagentMode: 'foreground' | 'background' = 'foreground', taskId?: string): Promise<string> => {
      const childId = taskId ?? `worker-${++subagentSeq}`
      this.spawnedSubagentIds.add(childId)
      this.subagentInstances.set(childId, { description })
      if (subagentMode === 'background') {
        const result = this.backgroundManager.spawn(childId, description, async (signal) => {
          await this.runBackgroundSubagent(childId, description, signal, send)
        })
        if (result !== childId) return result
        return `Background task started: ${childId}`
      }
      if (taskId && this.backgroundTasks.has(taskId)) return `Error: subagent ${taskId} is already running`
      const existingMessages = taskId ? this.loadSubagentMessages(taskId) : undefined
      ensureStarted(childId, 'worker', 'supervisor', description, taskId)
      const text = await runSubagent({ runner, root: cwd, summarizer, emit: makeEmit(childId, 'worker'), signal: this.abortController!.signal, description, childMaxSteps: CHILD_MAX_STEPS, permissionMode: mode, requestApproval, sessionId: this.id, networkPolicy: this.networkPolicy, toolOutputStore: this.toolOutputStore, guardianReviewer: this.usesEnvModel ? new GuardianReviewer({ modelRunner: runner }) : undefined, ...(existingMessages && existingMessages.length > 0 ? { existingMessages } : {}) })
      ensureFinished(childId, text)
      return text
    }

    const retrySubagentWrapper = async (agentId: string): Promise<string> => {
      ensureStarted(agentId, 'worker', 'supervisor', 'retrying', agentId)
      const text = await this.retrySubagent(agentId, send)
      ensureFinished(agentId, text)
      return text
    }

    const enabledAgents = [...readAgentsConfig(cwd).filter((a) => a.enabled && a.id !== 'builtin'), ...pluginAgents.filter((a) => a.enabled && a.id !== 'builtin')]
    const invoker = this.agentProv.invoker(cwd)
    const requestApproval = this.permissions.buildRequestApproval(send, this.id, turnId, nextSeq, mode, this.hooks)

    const activeProfile = this.getActiveProfile()
    let tooling: SessionTooling | undefined = undefined
    let contextMessages: BaseMessage[] = []
    let system = ''

    const dispatchAgent = async (agentId: string, task: string): Promise<string> => {
      const cfg = enabledAgents.find((a) => a.id === agentId)
      if (!cfg) return `Error: unknown or disabled agent ${agentId}`
      const childId = `subagent-${++subagentSeq}`
      ensureStarted(childId, 'subagent', 'supervisor', task)
      const hooks: ExternalAgentHooks = {
        requestPermission: (req) => {
          const auto = tryAutoResolvePermission(mode, req.tool.kind, req.options)
          if (auto) return Promise.resolve(auto)
          return new Promise((resolve) => { this.permissions.pendingPermissions.set(req.requestId, resolve); send({ type: 'permission:request', sessionId: this.id, turnId, requestId: req.requestId, tool: req.tool, options: req.options, agentFrame: { agentId: childId, parentAgentId: 'supervisor', name: cfg.name } }) })
        },
        configOptions: () => {},
      }
      try {
        const text = await invoker.invoke(agentId, task, makeEmit(childId, 'subagent'), this.abortController!.signal, hooks, { mcpTools: tooling?.tools, skills, requestApproval, permissionMode: mode, sessionId: this.id, networkPolicy: this.networkPolicy, toolOutputStore: this.toolOutputStore, guardianReviewer: this.usesEnvModel ? new GuardianReviewer({ modelRunner: runner }) : undefined })
        ensureFinished(childId, text); return text || '(sub-agent produced no output)'
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') throw err
        const msg = safeErrorMessage(err); ensureFinished(childId, `Error: ${msg}`); return `Error: ${msg}`
      }
    }

    const t0 = Date.now()

    if (!this.agentProv.isExternalAgent()) {
      const contextState: SessionContextState = {
        cwd,
        customSystemPrompt: this._config.systemPrompt,
        skills,
        permissionMode: mode,
        mcpCatalog: mcpManager.toolCatalog() || undefined,
        tokenBudgetPercent,
        pendingSubagents: this.backgroundManager.runningCount > 0
          ? this.backgroundManager.runningEntries()
          : undefined,
        completedSubagents: (() => {
          const entries = this.backgroundManager.completedEntries()
          return entries.length > 0 ? entries : undefined
        })(),
      }

      const injectorRegistry = new ContextInjectorRegistry()
      injectorRegistry.register(new SystemPromptInjector())
      injectorRegistry.register(new SkillsListInjector())
      injectorRegistry.register(new PermissionModeInjector())
      injectorRegistry.register(new TokenBudgetInjector())
      injectorRegistry.register(new SubagentStatusInjector())

      logDebug('session', 'phase:prepareContext', { sessionId: this.id, elapsedMs: Date.now() - t0 })
      const prepared = await prepareSessionContext(this.id, 'supervisor', contextState, this.store, false, injectorRegistry)
      system = prepared.system
      contextMessages = prepared.contextMessages
      logDebug('session', 'phase:contextDone', { sessionId: this.id, elapsedMs: Date.now() - t0, contextMsgCount: prepared.contextMessages.length })
      tooling = await buildSessionTooling({
        cwd,
        sessionId: this.id,
        mode,
        skills,
        mcpConfigs: this.configMgr.mcpConfigs,
        enabledAgents,
        dispatch: enabledAgents.length ? { agents: enabledAgents.map((a) => ({ id: a.id, name: a.name, description: a.description })), run: dispatchAgent } : undefined,
        spawnSubagent,
        retrySubagent: retrySubagentWrapper,
        stopBackgroundTask: (taskId, reason) => this.backgroundManager.stop(taskId, reason),
        getBackgroundTaskOutput: (taskId) => this.backgroundManager.getOutput(taskId),
        hooks: this.hooks,
        approvalCache: this.approvalCache,
        requestApproval,
        allowedTools: activeProfile.allowedTools,
        blockedTools: activeProfile.blockedTools,
        usesEnvModel: this.usesEnvModel,
        runner,
        toolOutputStore: this.toolOutputStore,
        networkPolicy: this.networkPolicy,
        guardianReviewer: this.usesEnvModel ? new GuardianReviewer({ modelRunner: runner }) : undefined,
        onToolStarted: (name, callId, input) => emit.toolStarted(name, callId, input),
        onToolFinished: (callId, status, output, error) => emit.toolFinished(callId, status, output, error),
        emitRisk: (toolName, risk, approval) => {
          send({ type: 'guardian:risk', sessionId: this.id, turnId, toolName, risk, category: approval, reason: '' })
        },
        goalManager: this.goalManager,
        cronManager: this.cronManager,
      })
      logDebug('session', 'phase:toolingDone', { sessionId: this.id, elapsedMs: Date.now() - t0, toolCount: tooling?.tools.length ?? 0 })
      // After reconcile: status reflects actual connection state
      send({ type: 'mcp:status', servers: mcpManager.connectionStatuses(this.configMgr.mcpConfigs) })
    }

    const maxSteps = this.activeActivity?.stepsRemaining ?? MAX_STEPS
    const ctx: GraphCtx = { runner, tools: tooling?.tools ?? [], emit, summarizer, hooks: this.hooks, sessionId: this.id, toolRunner: tooling?.toolRunner, toolPolicy: this.toolPolicy, approvalCache: this.approvalCache, requestApproval, permissionMode: mode, allowedTools: activeProfile.allowedTools, blockedTools: activeProfile.blockedTools, systemPrompt: system, activeProfileId: activeProfile.id, maxSteps }

    let finalState: LoopState | undefined
    try {
      if (this.agentProv.isExternalAgent()) {
        const userText = lastUserText(base?.messages ?? this.messages)
        const cronPrefix = cronMessages.length ? cronMessages.map((m) => m.content as string).join('\n\n') + '\n\n' : ''
        const hooks: ExternalAgentHooks = {
          requestPermission: (req) => {
            const auto = tryAutoResolvePermission(mode, req.tool.kind, req.options)
            if (auto) return Promise.resolve(auto)
            return new Promise((resolve) => { this.permissions.pendingPermissions.set(req.requestId, resolve); send({ type: 'permission:request', sessionId: this.id, turnId, requestId: req.requestId, tool: req.tool, options: req.options }) })
          },
          configOptions: (options) => send({ type: 'agent:configOptions', sessionId: this.id, options }),
        }
        await this.agentProv.ensureExternalProvider().runTurn(cronPrefix + userText, emit, this.abortController.signal, hooks)
        closeReasoning('supervisor'); finishRemaining()
        const acpId = this.agentProv.acpSessionId; if (acpId && this.store) this.store.setAcpSessionId(this.id, acpId)
      } else {
        const userText = lastUserText(base?.messages ?? this.messages)
        const usePlan = shouldPlan(userText, {
          forcePlan: this._config.forcePlan,
          disablePlan: this._config.disablePlan,
        })
        const initialPlanningMode = base?.planningMode ?? (usePlan || activeProfile.id === 'plan' ? 'plan' : 'fast')
        const stepsBefore = base?.steps ?? 0
        logDebug('session', 'phase:invokeGraph', { sessionId: this.id, elapsedMs: Date.now() - t0, msgCount: base?.messages.length ?? this.messages.length })
        finalState = await this.app.invoke(
          {
            messages: [new SystemMessage(system), ...cronMessages, ...contextMessages, ...(base?.messages ?? this.messages)],
            steps: base?.steps ?? 0,
            recentSigs: [],
            nudgedSig: undefined,
            status: 'running',
            planningMode: initialPlanningMode,
            planStatus: base?.planStatus ?? 'none',
            plan: base?.plan,
            verifyMemo: undefined,
          },
          { configurable: { ctx }, signal: this.abortController.signal, recursionLimit: recursionLimit(maxSteps) },
        )
        this.consumeActivitySteps(finalState.steps - stepsBefore)
        closeReasoning('supervisor'); finishRemaining()

        const ephemeralPrefix = 1 + cronMessages.length + contextMessages.length
        if (finalState.compacted && this.store) {
          new ContextEpoch(this.store.getDb()).requestReplacement(this.id, 0)
        }
        if (finalState.status === 'awaiting_user') {
          this.paused = {
            messages: finalState.messages.slice(ephemeralPrefix),
            steps: finalState.steps,
            planningMode: finalState.planningMode,
            planStatus: finalState.planStatus,
            plan: finalState.plan,
          }
          this.awaitingResume = true
          const stoppedText = this.finalizeAndPersist(send, turnId, supervisorText, trajectory, true, usageByAgent, this.paused.messages)
          void this.hooks.fire('TurnComplete', { sessionId: this.id, turnId }).catch((err) => logNonCritical('TurnComplete', err))
          if (finalState.planningMode === 'plan' && finalState.plan) {
            send({ type: 'plan:published', sessionId: this.id, turnId, plan: finalState.plan })
          }
          const interruptContext = finalState.planningMode === 'plan'
            ? JSON.stringify({ kind: 'plan_approval', plan: finalState.plan })
            : undefined
          send({
            type: 'agent:interrupt',
            sessionId: this.id,
            turnId,
            agentId: 'supervisor',
            question: finalState.pendingQuestion ?? PAUSE_QUESTION,
            ...(interruptContext ? { context: interruptContext } : {}),
          })
          return stoppedText
        }
        const nextMessages = finalState.messages.slice(ephemeralPrefix)
        this.messages.length = 0
        this.messages.push(...nextMessages)
      }
    } catch (err) {
      logInfo('session', 'turn:error', { sessionId: this.id, turnId, error: err instanceof Error ? err.message : String(err), isAbort: err instanceof Error && err.name === 'AbortError' })
      const isAbort = err instanceof Error && err.name === 'AbortError'; finishRemaining()
      const isSteerAbort = this.steerAbortFlag
      if (isSteerAbort) this.steerAbortFlag = false
      if (isSteerAbort) {
        if (supervisorText) {
          const text = this.finalizeAndPersist(rawSend, turnId, supervisorText, trajectory, true, usageByAgent)
          void this.hooks.fire('TurnComplete', { sessionId: this.id, turnId }).catch((err) => logNonCritical('TurnComplete', err))
          return text
        }
        return ''
      }
      if (isAbort && supervisorText) {
        const text = this.finalizeAndPersist(rawSend, turnId, supervisorText, trajectory, true, usageByAgent)
        void this.hooks.fire('TurnComplete', { sessionId: this.id, turnId }).catch((err) => logNonCritical('TurnComplete', err))
        if (timedOut) rawSend({ type: 'error', sessionId: this.id, code: 'TIMEOUT', message: '' })
        return text
      }
      rawSend({ type: 'error', sessionId: this.id, code: timedOut ? 'TIMEOUT' : isAbort ? 'CANCELLED' : 'AGENT_ERROR', message: timedOut ? '' : isAbort ? 'User cancelled the request' : safeErrorMessage(err) })
      return ''
    } finally {
      tooling?.cleanup()
      watchdog.stop(); this.running = false; this.abortController = null; this.permissions.cancelAll()
    }

    const finalText = this.finalizeAndPersist(send, turnId, supervisorText, trajectory, false, usageByAgent)

    // Stop hook: if a hook returns { kind: 'continue', prompt }, inject the prompt
    // as a HumanMessage and loop once. Guarded by stopContinued to prevent infinite loops.
    const stopResult = await this.hooks.fire('Stop', { sessionId: this.id, turnId }).catch(() => ({ kind: 'allow' as const }))
    if (stopResult.kind === 'continue' && stopResult.prompt && !this.stopContinued) {
      this.stopContinued = true
      this.messages.push(new HumanMessage(stopResult.prompt))
      if (stopResult.additionalContexts) {
        for (const ctx of stopResult.additionalContexts) {
          this.messages.push(new SystemMessage(ctx))
        }
      }
      void this.hooks.fire('TurnComplete', { sessionId: this.id, turnId }).catch((err) => logNonCritical('TurnComplete', err))
      try {
        const continuedText = await this.runTurn(rawSend)
        return continuedText
      } finally {
        this.stopContinued = false
      }
    }

    void this.hooks.fire('TurnComplete', { sessionId: this.id, turnId }).catch((err) => logNonCritical('TurnComplete', err))

    // Goal mode: record turn usage for every completed turn.
    const turnUsage = sumUsage([...usageByAgent.values()])
    const totalTokens = (turnUsage?.inputTokens ?? 0) + (turnUsage?.outputTokens ?? 0)
    this.goalManager.recordTurn()
    if (totalTokens > 0) this.goalManager.recordTokens(totalTokens)

    // Goal mode: auto-continue if active goal has remaining budget and no user input pending.
    if (!this.awaitingResume && !this.goalContinued) {
      const driveResult = this.goalManager.drive()
      if (driveResult) {
        this.goalContinued = true
        this.messages.push(new HumanMessage(driveResult.prompt))
        try {
          const continuedText = await this.runTurn(rawSend)
          return continuedText
        } finally {
          this.goalContinued = false
        }
      }
    }

    const ckptLabel = (finalText || '').replace(/\s+/g, ' ').trim().slice(0, 72) || null
    void this.captureCheckpoint(turnId, ckptLabel, send).catch((err) => logNonCritical('captureCheckpoint', err))
    return finalText
  }

  async runWorkflowTurn(def: WorkflowDef, send: SendFn): Promise<string> {
    return runWorkflowTurnFn(
      {
        id: this.id, config: this._config,
        modelRunner: () => this.modelRunner(), summarizer: () => this.summarizer(),
        invokerFactory: this.agentProv.invoker, store: this.store,
        idleTimeoutMs: this.idleTimeoutMs, pendingPermissions: this.permissions.pendingPermissions,
        orchestratorRunner: this.orchestratorRunner,
        networkPolicy: this.networkPolicy,
        toolOutputStore: this.toolOutputStore,
        guardianReviewer: this.usesEnvModel ? new GuardianReviewer({ modelRunner: this.modelRunner() }) : undefined,
      },
      def, send,
      (s, turnId, text, traj, stopped) => this.finalizeAndPersist(s, turnId, text, traj, stopped),
    )
  }

  /** Dual-write helper: persists the legacy representation AND publishes a durable
   *  event (plus its session_message projection) inside a single SQLite transaction.
   *  On error, ROLLBACK leaves both stores consistent. */
  private emit(event: SessionEvent, context?: { stepId?: string; usage?: TurnUsage; runs?: AgentRun[]; assistant?: { id: string; sessionId: string; agentId: string; content: string; timestamp: number; stopped?: boolean; timeline?: TimelineStep[] } | null }): void {
    if (!this.store || !this.eventStore) return
    const db = this.store.getDb()
    db.exec('BEGIN')
    try {
      switch (event.type) {
        case 'user_message':
          this.store.insertMessage({ id: event.messageId, sessionId: event.sessionId, role: 'user', agentId: null, content: event.content, timestamp: event.timestamp, attachments: event.attachments })
          this.store.touchSession(event.sessionId, event.timestamp)
          break
        case 'step_ended':
          if (event.agentId === 'supervisor' && context?.assistant !== undefined) {
            this.store.insertTurnBody(context.assistant, event.sessionId, context.runs ?? [])
          }
          break
      }

      const data = sessionEventToEventData(event, context)
      const published = this.eventStore.append(event.sessionId, event.type, data)
      projectEvent(db, published)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }

  private finalizeAndPersist(send: SendFn, turnId: string, supervisorText: string, trajectory: Map<string, TraceRun>, stopped: boolean, usageByAgent?: Map<string, TurnUsage>, targetMessages: BaseMessage[] = this.messages): string {
    const { correction } = verifyWrites(trajectory, supervisorText, this._config.language ?? 'en')
    const finalText = correction ? `${supervisorText}\n\n${correction}` : supervisorText
    const last = targetMessages[targetMessages.length - 1]
    if ((last instanceof AIMessage || last instanceof AIMessageChunk) && typeof last.content === 'string' && last.content === supervisorText && finalText) {
      targetMessages[targetMessages.length - 1] = new AIMessage(finalText)
    } else if (finalText) {
      targetMessages.push(new AIMessage(finalText))
    }
    const ts = Date.now()
    const runs: AgentRun[] = trajectoryToRuns(trajectory).map((r) => { const u = usageByAgent?.get(r.agentId); return { ...r, messageId: turnId, ...(u ? { usage: u } : {}) } })
    const turnUsage = sumUsage(runs.map((r) => r.usage))
    const timeline = trajectoryToTimeline(trajectory)
    const toolCalls = runs.flatMap((r) => r.toolCalls ?? []).sort((a, b) => a.seq - b.seq)
    if (this.store) {
      this.emit({ type: 'text_ended', sessionId: this.id, messageId: turnId, content: finalText, timestamp: ts })
      this.emit({ type: 'step_ended', sessionId: this.id, turnId, agentId: 'supervisor', timestamp: ts }, {
        usage: turnUsage,
        runs,
        assistant: finalText ? { id: turnId, sessionId: this.id, agentId: 'supervisor', content: finalText, timestamp: ts, stopped, timeline } : null,
      })
      this.store.touchSession(this.id, ts)
      if (this.snapshotStore) {
        const latestSeq = this.eventStore?.latestSeq(this.id) ?? 0
        saveSessionSnapshot(this.snapshotStore, this.id, latestSeq, {
          messages: targetMessages,
          config: this._config,
          usageByAgent: usageByAgent ? Object.fromEntries(usageByAgent) : undefined,
        })
      }
    }
    logInfo('session', 'message:complete', { sessionId: this.id, turnId, textLen: finalText.length, stopped })
    send({ type: 'message:complete', sessionId: this.id, message: { id: turnId, role: 'assistant', content: finalText, agentId: 'supervisor', timestamp: ts, timeline, toolCalls, agentRuns: runs, ...(turnUsage ? { usage: turnUsage } : {}), ...(stopped ? { stopped: true } : {}) } })
    return finalText
  }

  async regenerate(send: SendFn): Promise<void> {
    if (this.running) {
      send({ type: 'error', sessionId: this.id, code: 'BUSY', message: 'A turn is already running' })
      return
    }
    if (this.awaitingResume) {
      this.awaitingResume = false
      this.paused = null
    }
    if (!this.requireCompatibleModel(send)) return
    if (!this.requireApiKey(send)) return
    while (this.messages[this.messages.length - 1] instanceof AIMessage) {
      this.messages.pop()
      this.store?.deleteLastAssistantMessage(this.id)
    }
    const tail = this.messages[this.messages.length - 1]
    if (tail instanceof HumanMessage || tail instanceof ToolMessage) {
      await this.runTurn(send)
      return
    }
    send({ type: 'error', sessionId: this.id, code: 'CANNOT_REGENERATE', message: 'No user turn to regenerate from' })
  }

  async handlePlanResponse(action: 'approve' | 'reject' | 'amend', send: SendFn, amendContent?: string): Promise<void> {
    if (!this.awaitingResume || !this.paused) return
    switch (action) {
      case 'approve': {
        // Persist the approved plan to .hip/plans/<sessionId>.json atomically
        try {
          const cwd = this._config.cwd ?? process.cwd()
          const safeId = this.id.replace(/[^a-zA-Z0-9_-]/g, '_')
          const filePath = join(cwd, '.hip', 'plans', `${safeId}.json`)
          const dir = dirname(filePath)
          await mkdir(dir, { recursive: true })
          const tmpFile = `${filePath}.tmp-${Date.now()}`
          const planPayload = {
            sessionId: this.id,
            plan: this.paused?.plan ?? [],
            approvedAt: Date.now(),
          }
          await writeFile(tmpFile, JSON.stringify(planPayload, null, 2), 'utf8')
          await rename(tmpFile, filePath)
        } catch (err) {
          console.error('Failed to persist approved plan:', err instanceof Error ? err.message : String(err))
          send({ type: 'agent:notification', sessionId: this.id, taskId: 'plan-persist', description: 'Plan was approved but could not be saved to disk.', status: 'failed' })
        }
        const base = {
          messages: this.paused.messages,
          steps: this.paused.steps,
          planningMode: 'plan' as const,
          planStatus: 'approved' as const,
          plan: this.paused.plan,
        }
        this.awaitingResume = false; this.paused = null
        await this.runTurn(send, base)
        break
      }
      case 'reject': {
        this.awaitingResume = false; this.paused = null
        send({ type: 'error', sessionId: this.id, code: 'PLAN_REJECTED', message: 'Plan was rejected by the user.' })
        break
      }
      case 'amend': {
        const content = amendContent ?? 'Please revise the plan.'
        const base = {
          messages: [...this.paused.messages, new HumanMessage(content)],
          steps: this.paused.steps,
          planningMode: 'plan' as const,
          planStatus: 'generating' as const,
          plan: this.paused.plan,
        }
        this.awaitingResume = false; this.paused = null
        const ts = Date.now()
        if (this.store) {
          this.emit({ type: 'user_message', sessionId: this.id, content, messageId: `u-${ts}`, timestamp: ts })
        }
        this.messages.push(new HumanMessage(content))
        await this.runTurn(send, base)
        break
      }
    }
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
   */
  async retrySubagent(agentId: string, send: SendFn): Promise<string> {
    const instance = this.subagentInstances.get(agentId)
    if (!instance) return `Error: subagent ${agentId} not found`
    if (!this.spawnedSubagentIds.has(agentId)) return `Error: ${agentId} is not a known subagent`

    const allMessages = this.loadSubagentMessages(agentId)

    let retryDescription = instance.description
    let lastUserIdx = -1
    for (let i = allMessages.length - 1; i >= 0; i--) {
      if (allMessages[i].getType() === 'human') { lastUserIdx = i; break }
    }
    if (lastUserIdx >= 0) {
      const content = allMessages[lastUserIdx].content
      if (typeof content === 'string') retryDescription = content
    }

    const priorContext = lastUserIdx > 0 ? allMessages.slice(0, lastUserIdx) : []

    const cwd = this._config.cwd ?? process.cwd()
    const runner = this.modelRunner()
    const summarizer = this.summarizer()
    const rawMode = this._config.permissionMode
    const mode: PermissionMode = rawMode === 'chat' || rawMode === 'full' ? rawMode : 'edit'
    const requestApproval = this.permissions.buildRequestApproval(send, this.id, '', () => 0, mode, this.hooks)

    const turnId = `retry-${agentId}-${Date.now()}`
    send({ type: 'agent:started', sessionId: this.id, turnId, agentId, role: 'worker', taskId: agentId, taskInput: retryDescription })

    let result = ''
    try {
      result = await runSubagent({
        runner,
        root: cwd,
        summarizer,
        emit: { token: () => {}, reasoning: () => {}, toolStarted: () => {}, toolFinished: () => {}, usage: () => {}, planDelta: () => {}, compaction: () => {} },
        signal: new AbortController().signal,
        description: retryDescription,
        childMaxSteps: CHILD_MAX_STEPS,
        permissionMode: mode,
        requestApproval,
        sessionId: this.id,
        networkPolicy: this.networkPolicy,
        toolOutputStore: this.toolOutputStore,
        guardianReviewer: this.usesEnvModel ? new GuardianReviewer({ modelRunner: runner }) : undefined,
        ...(priorContext.length > 0 ? { existingMessages: priorContext } : {}),
      })
    } catch (err) {
      const msg = safeErrorMessage(err)
      result = `Error: ${msg}`
    }

    send({ type: 'agent:finished', sessionId: this.id, turnId, agentId })
    return result
  }

  async resumeSubagent(taskId: string, content: string, send: SendFn): Promise<void> {
    if (this.running || this.awaitingResume) return
    if (this.backgroundTasks.has(taskId)) return
    if (!this.spawnedSubagentIds.has(taskId)) return
    this.running = true

    const existingMessages = this.loadSubagentMessages(taskId)

    const cwd = this._config.cwd ?? process.cwd()
    const runner = this.modelRunner()
    const summarizer = this.summarizer()
    const rawMode = this._config.permissionMode
    const mode: PermissionMode = rawMode === 'chat' || rawMode === 'full' ? rawMode : 'edit'
    const requestApproval = this.permissions.buildRequestApproval(send, this.id, '', () => 0, mode, this.hooks)

    const turnId = `asst-${taskId}-${Date.now()}-${this.turnSeq++}`
    const ac = new AbortController()
    this.resumeAbortController = ac
    const role: AgentRole = 'worker'
    send({ type: 'agent:started', sessionId: this.id, turnId, agentId: taskId, role, taskId, taskInput: content })

    let output = ''
    const emit: GraphEmit = {
      token: (delta) => { if (delta) { output += delta; send({ type: 'token:stream', sessionId: this.id, turnId, agentId: taskId, delta }) } },
      reasoning: () => {},
      toolStarted: (name, callId, input) => { const inClip = clip(stringify(input)); send({ type: 'tool:started', sessionId: this.id, turnId, agentId: taskId, role, callId, name, input: inClip.text, seq: 0, ...(inClip.truncated ? { truncated: true } : {}) }) },
      toolFinished: (callId, status, resOutput, error) => { const outClip = resOutput !== undefined ? clip(stringify(resOutput)) : undefined; send({ type: 'tool:finished', sessionId: this.id, turnId, agentId: taskId, callId, status, ...(outClip ? { output: outClip.text } : {}), ...(error ? { error } : {}), ...(outClip?.truncated ? { truncated: true } : {}) }) },
      usage: () => {},
      planDelta: () => {},
      compaction: () => {},
    }

    try {
      const text = await runSubagent({
        runner, root: cwd, summarizer, emit, signal: ac.signal,
        description: content, childMaxSteps: CHILD_MAX_STEPS,
        permissionMode: mode, requestApproval,
        existingMessages: [...existingMessages, new HumanMessage(content)],
        sessionId: this.id,
      })
      send({ type: 'agent:finished', sessionId: this.id, turnId, agentId: taskId })
      const ts = Date.now()
      send({ type: 'message:complete', sessionId: this.id, message: { id: turnId, role: 'assistant', content: text, agentId: taskId, timestamp: ts } })
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        send({ type: 'agent:finished', sessionId: this.id, turnId, agentId: taskId })
      } else {
        const msg = safeErrorMessage(err)
        send({ type: 'agent:finished', sessionId: this.id, turnId, agentId: taskId })
        send({ type: 'error', sessionId: this.id, code: 'AGENT_ERROR', message: msg })
      }
    } finally {
      this.running = false
      this.resumeAbortController = null
    }
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

function isRichContentParts(parts: ContentPart[] | undefined): boolean {
  return !!parts && parts.length > 0 && !(parts.length === 1 && parts[0].type === 'text')
}

function rowToBaseMessage(d: SessionMessageData): BaseMessage {
  if (d.role === 'user') {
    const validParts = d.contentParts?.filter((p): p is ContentPart => isContentPart(p as Record<string, unknown>))
    if (isRichContentParts(validParts)) {
      return new HumanMessage({ content: validParts })
    }
    return new HumanMessage(d.content)
  }
  if (d.role === 'assistant' && 'kind' in d) return new SystemMessage(d.summary)
  const toolCalls = d.toolCalls.length > 0 ? d.toolCalls.map(projectedToolCallToToolCall) : undefined
  return new AIMessage({ content: d.content, ...(toolCalls ? { tool_calls: toolCalls } : {}) })
}

function projectedToolCallToToolCall(t: ProjectedToolCall) {
  return { name: t.name, args: parseToolInput(t.input), id: t.callId, type: 'tool_call' as const }
}

function parseToolInput(input: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(input)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch (err) { logNonCritical('parseToolInput', err) }
  return {}
}

/** Map a protocol SessionEvent into the internal event payload that the
 *  message projector expects. Protocol identifiers (`turnId`, `messageId`)
 *  map to the projector's `stepId`; tool events use the caller-supplied stepId. */
function sessionEventToEventData(
  event: SessionEvent,
  context?: {
    stepId?: string
    usage?: TurnUsage
    runs?: AgentRun[]
    assistant?: {
      id: string
      sessionId: string
      agentId: string
      content: string
      timestamp: number
      stopped?: boolean
      timeline?: TimelineStep[]
    } | null
  },
): Record<string, unknown> {
  switch (event.type) {
    case 'user_message':
      return { messageId: event.messageId, content: event.content, timestamp: event.timestamp, ...(event.attachments?.length ? { attachments: event.attachments } : {}), ...(event.contentParts?.length ? { contentParts: event.contentParts } : {}) }
    case 'step_started':
      return { stepId: event.turnId, agentId: event.agentId, startedAt: event.timestamp }
    case 'step_ended':
      return { stepId: event.turnId, agentId: event.agentId, finishedAt: event.timestamp, ...(context?.usage ? { usage: context.usage } : {}) }
    case 'step_failed':
      return { stepId: event.turnId, agentId: event.agentId, error: event.error, finishedAt: event.timestamp }
    case 'text_started':
      return { stepId: event.messageId }
    case 'text_ended':
      return { stepId: event.messageId, content: event.content }
    case 'tool_called':
      return { callId: event.callId, stepId: context?.stepId, name: event.name, input: event.input, seq: event.timestamp }
    case 'tool_success':
      return { callId: event.callId, stepId: context?.stepId, output: event.output }
    case 'tool_failed':
      return { callId: event.callId, stepId: context?.stepId, error: event.error }
    case 'compaction_ended':
      return { summary: event.summary, timestamp: event.timestamp }
  }
}
