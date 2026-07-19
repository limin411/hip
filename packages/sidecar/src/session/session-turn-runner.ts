/**
 * Turn execution extracted from Session (Phase 3b).
 * Session builds a SessionTurnHost and delegates processInput / runTurn / runManagedAgentTurn here.
 */
import type {
  ServerMessage,
  SessionConfig,
  AgentRole,
  AgentRun,
  TurnUsage,
  PermissionMode,
  WorkflowDef,
  PlanItem,
  SessionEvent,
  TimelineStep,
  Attachment,
  ContentPart,
  AgentConfig,
  Hook,
  OrchestrationMode,
} from '@hip/protocol'
import { FIXED_AGENTS } from '@hip/protocol'
import { HumanMessage, AIMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages'
import type { BaseLanguageModel } from '@langchain/core/language_models/base'
import { clipForTool, stringify, trajectoryToRuns, trajectoryToTimeline, ReasoningTracker, type TraceRun, type TraceRecorder } from './tool-trace.js'
import { IdleWatchdog, idleTimeoutMessage } from './idle-watchdog.js'
import { getActiveModel, isOpenAICompatible } from '../config/providers.js'
import { isMultimodalModel } from '../config/catalog.js'
import { resolveApiKey } from '../config/auth-file.js'
import { resolveEffectiveConfig, resolveAcpHostConfig } from '../config/hip-config.js'
import { flushLangSmithTraces, tracingInvokeFields } from '../observability/langsmith.js'
import { buildGraph, type GraphEmit, type GraphCtx, type LoopState } from './graph.js'
import { selectImageAgent } from './agents/registry.js'
import { SessionApprovalCache } from './tool-runner/approval-cache.js'
import type { ToolPolicy } from './tool-runner/tool-policy.js'
import { mcpManager } from './mcp/manager.js'
import { readAgentsConfig } from './agents/index.js'
import { RealModelRunner, type ModelRunner } from './model-runner.js'
import { runSubagent } from './subagent.js'
import { synthesizeSubagentResult } from './subagent-result.js'
import { recursionLimit, childMaxStepsForAgent, maxStepsForSession } from './loop-control.js'
import type { Activity, ActivityTracker } from './activity.js'
import type { GoalManager } from './goal.js'
import { addUsage, sumUsage } from './usage.js'
import { estimateTokens, COMPACT_BUDGET_TOKENS, type Summarizer } from './compaction.js'
import { ensureToolCallResults, hasValidToolCallPairing } from '../persistence/event-store.js'
import { PAUSE_QUESTION, resolveDoomLoopStrategy } from './doom-loop.js'
import type { ExternalAgentHooks, PermissionChoice } from './agents/types.js'
import type { HookRegistry } from './hooks/registry.js'
import type { AgentInvoker } from './agents/invoker.js'
import type { SessionStore } from '../persistence/store.js'
import type { EventStore } from '../persistence/event-store.js'
import type { SkillMeta } from '@hip/protocol'
import { deriveTitle } from './title-generator.js'
import { runWorkflowTurn as runWorkflowTurnFn, type WorkflowRunDeps } from './workflow-runner.js'
import { shouldPlan } from './plan.js'
import type { AgentProfile } from './agent-profile.js'
import type { PlanMode } from './plan-mode.js'
import type { ToolOutputStore } from './tool-output-store.js'
import { NetworkPolicy, loadNetworkPolicyConfig } from './network-policy.js'
import { GuardianReviewer } from './guardian.js'
import type { SessionInput } from './session-input.js'
import { prepareSessionContext, type SessionContextState } from './session-context.js'
import { validateAttachments, stageAttachments, buildAttachmentContentParts, splitAttachments, type AttachmentPayload } from './attachments.js'
import {
  ContextInjectorRegistry,
  SystemPromptInjector,
  PermissionModeInjector,
  TokenBudgetInjector,
  SubagentStatusInjector,
} from './context-injector.js'
import { surfaceOf } from './surface.js'
import { ProjectAgentsMdInjector } from './project-agents-md.js'
import { OpenFileContextInjector } from './open-file-context.js'
import {
  MemoryService,
  MemoryStore,
  resolveProjectKey,
  loadMemoryConfig,
  resolveSessionMemoryFlags,
  refreshMemoryCoreSnapshot,
  resolveAcpExternalMemoryPrefix,
  scheduleMemoryExtractAfterTurn,
  parseMemoryCitations,
  bumpMemoryUseCounts,
  buildMemorySearchToolOnly,
  buildMemoryTools,
} from '../memory/index.js'
import { MemoryInjector } from '../memory/inject.js'
import { tryEnableMemoriesFts, tryEnableSqliteVec } from '../persistence/schema.js'
import { ContextEpoch } from './context-epoch.js'
import { buildSessionTooling, type SessionTooling } from './session-tooling.js'
import { safeErrorMessage } from './error.js'
import type { BackgroundManager } from './background-manager.js'
import type { CronManager } from './cron.js'
import { logInfo, logDebug, logDebugEveryN } from '../debug-logger.js'
import {
  resolveModelChoice,
  tryAutoResolvePermission,
  logNonCritical,
  lastUserText,
  stripImageContentParts,
} from './session-helpers.js'
import { isRichContentParts } from './session-message-codec.js'
import type { PermissionManager } from './permission-manager.js'
import type { AgentProviderManager } from './agent-provider.js'
import type { ConfigManager } from './config-manager.js'

export type SendFn = (msg: ServerMessage) => void

export type TurnBase = {
  messages: BaseMessage[]
  steps: number
  planningMode?: 'fast' | 'plan'
  planStatus?: 'none' | 'generating' | 'ready' | 'approved' | 'rejected'
  plan?: PlanItem[]
}

/**
 * Resolve an explicit pending workflow for this turn.
 * Product path no longer forces `builtin:cluster-default` when orchMode is dag
 * (agent-driven orchestration: supervisor + task/dispatch only).
 * `pendingWorkflowDef` remains for tests / internal callers that set it explicitly.
 */
export function resolveWorkflowDefForTurn(host: {
  orchMode: OrchestrationMode
  pendingWorkflowDef: WorkflowDef | null
}): WorkflowDef | null {
  // Ignore orchMode — user mode toggle is deprecated (D1).
  void host.orchMode
  return host.pendingWorkflowDef
}

/** Last HumanMessage text content (string or first text part in array content). */
export function extractLastUserText(messages: BaseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.getType() !== 'human') continue
    if (typeof m.content === 'string') return m.content
    if (Array.isArray(m.content)) {
      const texts = m.content
        .filter((b): b is { type: 'text'; text: string } =>
          b != null && typeof b === 'object' && 'type' in b && (b as { type: string }).type === 'text' && typeof (b as { text?: unknown }).text === 'string',
        )
        .map((b) => b.text)
      if (texts.length > 0) return texts.join('')
    }
    return ''
  }
  return ''
}

/**
 * Host surface Session implements for turn execution.
 * Populated via runtime cast — private Session fields exist on the instance at runtime.
 */
export interface SessionTurnHost {
  id: string
  _config: SessionConfig
  orchMode: import('@hip/protocol').OrchestrationMode
  pendingWorkflowDef: WorkflowDef | null
  messages: BaseMessage[]
  abortController: AbortController | null
  /** AbortController for subagent resume turns (resumeSubagent). */
  resumeAbortController: AbortController | null
  running: boolean
  /**
   * True while session:setAgent critical section runs (dispose → config → echo).
   * Blocks concurrent turns so dispose cannot race a new prompt.
   */
  switchingAgent: boolean
  awaitingResume: boolean
  /** Multi-client: connection owning the active foreground turn. */
  ownerConnectionId: string | null
  /** Multi-client: connection for the current request path (bg origin). */
  currentConnectionId: string | null
  inputQueue: SessionInput[]
  steerAbortFlag: boolean
  paused: TurnBase | null
  modelDirty: boolean
  turnSeq: number
  stopContinued: boolean
  goalContinued: boolean
  usesEnvModel: boolean
  planMode: PlanMode
  backgroundManager: BackgroundManager
  cronManager: CronManager
  backgroundTasks: Map<string, Promise<void>>
  spawnedSubagentIds: Set<string>
  subagentInstances: Map<string, { description: string }>
  toolOutputStore: ToolOutputStore
  networkPolicy: NetworkPolicy
  eventStore?: EventStore
  activeSteps: Map<string, string>
  activeActivity?: ActivityTracker
  goalManager: GoalManager
  permissions: PermissionManager
  agentProv: AgentProviderManager
  configMgr: ConfigManager
  approvalCache: SessionApprovalCache
  toolPolicy: ToolPolicy
  hooks: HookRegistry
  store?: SessionStore
  app: ReturnType<typeof buildGraph>
  scratchRoot: string
  idleTimeoutMs: number
  workflowDeps: WorkflowRunDeps

  buildAgent(): void
  modelRunner(): ModelRunner
  summarizer(): Summarizer
  requireCompatibleModel(send: SendFn): boolean
  requireApiKey(send: SendFn): boolean
  currentModelSupportsImages(): boolean
  rebuildMessagesFromEvents(sessionId: string): BaseMessage[]
  emit(event: SessionEvent, context?: {
    stepId?: string
    usage?: TurnUsage
    runs?: AgentRun[]
    assistant?: { id: string; sessionId: string; agentId: string; content: string; timestamp: number; stopped?: boolean; timeline?: TimelineStep[]; memoryCitations?: import('@hip/protocol').MemoryCitation[] } | null
  }): void
  finalizeAndPersist(send: SendFn, turnId: string, supervisorText: string, trajectory: Map<string, TraceRun>, stopped: boolean, usageByAgent?: Map<string, TurnUsage>, targetMessages?: BaseMessage[]): string
  startActivity(description: string, totalSteps?: number): Activity
  endActivity(): void
  consumeActivitySteps(steps: number): void
  resolvePermissionMode(): PermissionMode
  generateFirstTurnTitle(input: SessionInput, replyText: string, send: SendFn): Promise<void>
  getFixedAgents(): Record<string, boolean> | undefined
  getActiveProfile(): AgentProfile
  checkSteerPromotion(): void
  runBackgroundSubagent(
    taskId: string,
    description: string,
    signal: AbortSignal,
    send: SendFn,
    opts?: import('./session-background.js').BackgroundSubagentOpts,
  ): Promise<void>
  loadSubagentMessages(taskId: string): BaseMessage[]
  retrySubagent(agentId: string, send: SendFn, emit?: GraphEmit): Promise<string>
  captureCheckpoint(turnId: string, label: string | null, send: SendFn): Promise<void>
  lastUserMessageRow(): import('../persistence/message-types.js').SessionMessageData & { role: 'user' } | null
  incompleteAssistantStepAfter(userMessageId: string): { stepId: string; agentId: string } | null
  rebuildPartsForImageAgent(userData: Extract<import('../persistence/message-types.js').SessionMessageData, { role: 'user' }>): Promise<ContentPart[]>
  /** Frozen core memory block; refreshed when project key changes. */
  memoryCoreSnapshot?: string
  /** Pinned/core item ids paired with memoryCoreSnapshot. */
  memoryCoreIds?: string[]
  /** projectKeyHash used when memoryCoreSnapshot was loaded. */
  memorySnapshotProjectKey?: string
  /** Generation baked into memoryCoreSnapshot (KD-13 invalidation). */
  memoryCoreGeneration?: number
  /** Memory item ids injected into context this turn (core + prefetch). */
  memoryIdsInjectedThisTurn?: Set<string>
  /** Lazy MemoryService shared across turns on this host. */
  memoryService?: MemoryService
}


export async function processInput(host: SessionTurnHost, input: SessionInput, _send: SendFn): Promise<string> {
  if (host.modelDirty) { host.buildAgent(); host.modelDirty = false }
  if (!host.requireCompatibleModel(_send)) return ''
  if (!host.requireApiKey(_send)) return ''

  const modelSupportsImages = host.currentModelSupportsImages()

  // Split attachments when the main model is text-only. Multimodal attachments
  // (image/PDF/video) are routed to an image agent; text attachments stay with
  // the main model together with the user's text prompt.
  // When the model IS multimodal, no splitting is needed (existing behavior).
  const { multimodal, text } = input.attachments?.length && !modelSupportsImages
    ? splitAttachments(input.attachments)
    : { multimodal: [] as AttachmentPayload[], text: (input.attachments ?? []) as AttachmentPayload[] }

  const hasMultimodalForAgent = multimodal.length > 0

  const userTs = Date.now()
  let isFirstTurn = false
  const parts: ContentPart[] = []
  if (input.content) parts.push({ type: 'text', text: input.content })

  // Preprocess multimodal attachments with an image agent when the main model is text-only.
  if (hasMultimodalForAgent) {
    await validateAttachments(multimodal)
    const { staged: mStaged, stagedPaths: mStagedPaths } = await stageAttachments(host.id, multimodal, host.scratchRoot)
    const mParts = await buildAttachmentContentParts(multimodal, mStagedPaths)
    // Only image_url parts are forwarded to the image agent (the agent's bound
    // multimodal model is responsible for visual analysis). Non-image multimodal
    // parts (e.g. extracted PDF text) stay with the main model.
    const imageParts = mParts.filter((p) => p.type === 'image_url')
    const multimodalTextParts = mParts.filter((p) => p.type !== 'image_url')
    parts.push(...multimodalTextParts)

    // Process text attachments before emitting so we can combine all staged
    // attachments and content parts into a single user_message event.
    let tStaged: Attachment[] = []
    let tParts: ContentPart[] = []
    if (text.length > 0) {
      await validateAttachments(text)
      const result = await stageAttachments(host.id, text, host.scratchRoot)
      tStaged = result.staged
      tParts = await buildAttachmentContentParts(text, result.stagedPaths)
      parts.push(...tParts)
    }

    if (host.store) {
      isFirstTurn = !host.store.hasMessages(host.id)
      const allStaged = [...mStaged, ...tStaged]
      const allContentParts = [parts[0], ...imageParts, ...multimodalTextParts, ...tParts]
      const historyParts = isRichContentParts(allContentParts) ? allContentParts : undefined
      host.emit({ type: 'user_message', sessionId: host.id, content: input.content, messageId: input.messageId ?? `u-${userTs}`, timestamp: userTs, attachments: allStaged, ...(historyParts?.length ? { contentParts: historyParts } : {}) })
    }

    // Select image agent early so error handling can short-circuit before hooks/activity.
    let imageAgent: AgentConfig | null = null
    let imageAgentError: string | null = null
    if (imageParts.length > 0) {
      try {
        imageAgent = selectImageAgent(host._config.cwd ?? process.cwd(), input.content)
      } catch (err) {
        imageAgentError = err instanceof Error ? err.message : String(err)
        console.warn('Failed to select image agent:', imageAgentError)
      }
    }
    if (imageParts.length > 0 && !imageAgent) {
      host.endActivity()
      host.messages.push(new HumanMessage(input.content))
      const message = imageAgentError
        ? `Image agent selection failed: ${imageAgentError}. Please enable a multimodal agent or switch to a multimodal model.`
        : 'No image-capable agent is available. Please enable a multimodal agent or switch to a multimodal model.'
      _send({ type: 'error', sessionId: host.id, code: 'NO_IMAGE_AGENT', message })
      return ''
    }

    // Run the image agent after hooks/activity (below) so processInput starts the
    // activity that the image agent turn owns. For image-only attachments, the
    // image agent result IS the final answer — we return early without running the
    // main model. For mixed (image + text) attachments, we merge the vision result
    // into the user prompt and fall through to the main model.
    const runImageAgent = async () => {
      if (input.type === 'message') {
        if (host.activeActivity) host.endActivity()
        host.startActivity(input.content)
      }
      const visionResult = await runManagedAgentTurn(host, 
        { type: 'message', content: input.content, messageId: input.messageId, attachments: multimodal },
        imageAgent!,
        imageParts,
        _send,
        isFirstTurn,
      )
      const mergedContent = input.content
        ? `${input.content}\n\n[Image: ${visionResult}]`
        : `[Image: ${visionResult}]`
      return { visionResult, mergedContent }
    }

    // Standard hooks, activity, and image agent dispatch — mirror the original
    // processInput flow (lines that ran before the old imageAgent dispatch).
    if (host.store && isFirstTurn && host.store.updateTitleIfAuto(host.id, deriveTitle(input.content)) === 1) {
      _send({ type: 'session:title', sessionId: host.id, title: deriveTitle(input.content) })
    }
    const promptResult = await host.hooks.fire('UserPromptSubmit', { sessionId: host.id }).catch(() => ({ kind: 'deny' as const, reason: 'Hook error' }))
    if (promptResult.kind !== 'allow') {
      _send({ type: 'error', sessionId: host.id, code: 'HOOK_DENIED', message: `User prompt rejected: ${promptResult.reason ?? 'blocked by hook'}` })
      return ''
    }
    if (isFirstTurn) void host.hooks.fire('SessionStart', { sessionId: host.id }).catch((err) => logNonCritical('SessionStart', err))

    if (imageAgent) {
      const { visionResult, mergedContent } = await runImageAgent()
      parts[0] = { type: 'text', text: mergedContent }

      // Image-only: no text/file attachments to process — the image agent IS the answer.
      if (text.length === 0 && multimodalTextParts.length === 0) {
        return visionResult
      }
      // Mixed attachments: fall through to main model.
    }
  }

  // Handle text attachments (or all attachments when model IS multimodal).
  if (input.attachments?.length && !hasMultimodalForAgent) {
    await validateAttachments(input.attachments)
    const { staged, stagedPaths } = await stageAttachments(host.id, input.attachments, host.scratchRoot)
    const attachmentParts = await buildAttachmentContentParts(input.attachments, stagedPaths)
    parts.push(...attachmentParts)
    if (host.store) {
      isFirstTurn = !host.store.hasMessages(host.id)
      const historyParts = isRichContentParts(parts) ? parts : undefined
      host.emit({ type: 'user_message', sessionId: host.id, content: input.content, messageId: input.messageId ?? `u-${userTs}`, timestamp: userTs, attachments: staged, ...(historyParts?.length ? { contentParts: historyParts } : {}) })
    }
  } else if (host.store && !hasMultimodalForAgent) {
    isFirstTurn = !host.store.hasMessages(host.id)
    host.emit({ type: 'user_message', sessionId: host.id, content: input.content, messageId: input.messageId ?? `u-${userTs}`, timestamp: userTs })
  }

  // Standard title/hooks/activity for non-split cases (multimodal split handled its own above).
  if (!hasMultimodalForAgent) {
    if (host.store && isFirstTurn && host.store.updateTitleIfAuto(host.id, deriveTitle(input.content)) === 1) {
      _send({ type: 'session:title', sessionId: host.id, title: deriveTitle(input.content) })
    }
    const promptResult = await host.hooks.fire('UserPromptSubmit', { sessionId: host.id }).catch(() => ({ kind: 'deny' as const, reason: 'Hook error' }))
    if (promptResult.kind !== 'allow') {
      _send({ type: 'error', sessionId: host.id, code: 'HOOK_DENIED', message: `User prompt rejected: ${promptResult.reason ?? 'blocked by hook'}` })
      return ''
    }
    if (isFirstTurn) void host.hooks.fire('SessionStart', { sessionId: host.id }).catch((err) => logNonCritical('SessionStart', err))
  }

  if (input.type === 'message') {
    if (host.activeActivity) host.endActivity()
    host.startActivity(input.content)
  }

  host.messages.push(parts.length === 1 && parts[0].type === 'text'
    ? new HumanMessage(input.content)
    : new HumanMessage({ content: parts }))
  const supervisorText = await runTurn(host, _send)

  // Flush the turn's LangSmith root *before* any post-turn work that forces
  // tracing off (title refine). Otherwise the first-turn batch can race and
  // never appear in the project while later turns do.
  await flushLangSmithTraces()

  if (isFirstTurn) {
    // Background: must not block the input queue or race the next turn's ALS.
    void host.generateFirstTurnTitle(input, supervisorText, _send).catch((err) => {
      logNonCritical('generateFirstTurnTitle', err)
    })
  }
  return supervisorText
}

export async function runManagedAgentTurn(host: SessionTurnHost, input: SessionInput, agent: AgentConfig, parts: ContentPart[], _send: SendFn, isFirstTurn: boolean, reuseTurnId?: string): Promise<string> {
  const turnId = reuseTurnId ?? `asst-managed-${agent.id}-${Date.now()}-${host.turnSeq++}`
  logInfo('session', 'turn:start', { sessionId: host.id, turnId, agentId: agent.id })
  host.abortController = new AbortController()
  host.running = true
  // Managed path does not inject cross-session memory; clear stale allowedIds.
  host.memoryIdsInjectedThisTurn = new Set()

  const cwd = host._config.cwd ?? process.cwd()
  const mode = host.resolvePermissionMode()
  const requestApproval = host.permissions.buildRequestApproval(_send, host.id, turnId, () => 0, mode, host.hooks)

  let stepSeq = 0
  const reasoning = new ReasoningTracker(() => stepSeq++)
  const usageByAgent = new Map<string, TurnUsage>()
  // Mirror runTurn's trajectory so the final message:complete can carry the image agent's
  // reasoning bursts, tool calls and per-agent runs. Without this, the frontend's provisional
  // assistant message accumulates the live activity but message:complete replaces it with an
  // empty shell, causing the sub-agent's activity to vanish for a moment.
  const trajectory = new Map<string, TraceRun>()
  const recorder: TraceRecorder = {
    start: (agentId, callId, name, input, seq, truncated) => {
      const r = trajectory.get(agentId); if (!r) return
      r.toolCalls.set(callId, { callId, agentId, name, input, status: 'running', seq, ...(truncated ? { truncated: true } : {}) })
    },
    finish: (agentId, callId, status, output, error, truncated) => {
      const tc = trajectory.get(agentId)?.toolCalls.get(callId)
      if (!tc) return
      tc.status = status
      if (output !== undefined) tc.output = output
      if (error !== undefined) tc.error = error
      if (truncated || tc.truncated) tc.truncated = true
    },
  }
  const closeReasoningBurst = () => {
    const burst = reasoning.close(agent.id)
    const r = trajectory.get(agent.id)
    if (r && burst) r.reasoningBursts.push(burst)
  }
  let agentText = ''
  const emit: GraphEmit = {
    // Stream tokens directly into the assistant body (supervisor role). Don't duplicate them
    // into the trajectory run's output; the image agent's reply is the message content.
    // Also tee them locally so that if the invoker returns an empty string (e.g. the graph's
    // final AIMessage has no text), we still have the streamed reply for message:complete.
    token: (delta) => { agentText += delta; _send({ type: 'token:stream', sessionId: host.id, turnId, agentId: agent.id, delta }) },
    reasoning: (delta) => {
      if (!delta) return
      _send({ type: 'reasoning:delta', sessionId: host.id, turnId, agentId: agent.id, role: 'subagent', stepSeq: reasoning.push(agent.id, delta), delta })
    },
    toolStarted: (name, callId, input) => {
      // Close any open reasoning burst BEFORE the tool claims the next stepSeq, so reasoning and
      // tool steps share a single turn-global ordering (mirrors runTurn).
      closeReasoningBurst()
      const seq = stepSeq++
      const inClip = clipForTool(name, typeof input === 'string' ? input : JSON.stringify(input))
      recorder.start(agent.id, callId, name, inClip.text, seq, inClip.truncated)
      _send({ type: 'tool:started', sessionId: host.id, turnId, agentId: agent.id, role: 'subagent', callId, name, input: inClip.text, seq, ...(inClip.truncated ? { truncated: true } : {}) })
    },
    toolFinished: (callId, status, output, error) => {
      const toolName = trajectory.get(agent.id)?.toolCalls.get(callId)?.name ?? ''
      const outClip = output !== undefined
        ? clipForTool(toolName, typeof output === 'string' ? output : JSON.stringify(output))
        : undefined
      recorder.finish(agent.id, callId, status, outClip?.text, error, outClip?.truncated ?? false)
      _send({ type: 'tool:finished', sessionId: host.id, turnId, agentId: agent.id, callId, status, ...(outClip ? { output: outClip.text } : {}), ...(error ? { error } : {}), ...(outClip?.truncated ? { truncated: true } : {}) })
    },
    usage: (u) => { usageByAgent.set(agent.id, addUsage(usageByAgent.get(agent.id), u)) },
    planDelta: () => {},
    compaction: () => {},
  }

  // Use role 'supervisor' so the frontend creates the assistant message container that holds
  // streaming tokens for this turn. The final message:complete records the run as a dispatched
  // sub-agent (role='subagent', parentAgentId='supervisor') so the UI renders a SubAgentCard.
  _send({ type: 'agent:started', sessionId: host.id, turnId, agentId: agent.id, role: 'supervisor' })
  trajectory.set(agent.id, { role: 'subagent', output: '', startedAt: Date.now(), finishedAt: null, seq: 0, toolCalls: new Map(), reasoningBursts: [] })
  host.emit({ type: 'step_started', sessionId: host.id, turnId, agentId: agent.id, timestamp: Date.now() })
  host.emit({ type: 'text_started', sessionId: host.id, messageId: turnId, timestamp: Date.now() })
  // Keep image_url parts out of the main session history; the agent received them via extras.
  host.messages.push(new HumanMessage(input.content))

  try {
    const invoker = host.agentProv.invoker(cwd)
    // Forward only image_url parts to the image agent (text parts are handled by the main model
    // after multimodal attachment splitting in processInput).
    const agentParts = parts.filter((p) => p.type === 'image_url')
    const imageAttachments = input.attachments?.filter((a) => a.mimeType.startsWith('image/'))
    const returnedText = await invoker.invoke(agent.id, input.content, emit, host.abortController.signal, undefined, {
      mcpTools: mcpManager.tools(),
      skills: host.configMgr.skills,
      requestApproval,
      permissionMode: mode,
      sessionId: host.id,
      title: host.store?.getSession(host.id)?.title,
      networkPolicy: host.networkPolicy,
      toolOutputStore: host.toolOutputStore,
      guardianReviewer: host.usesEnvModel ? new GuardianReviewer({ modelRunner: host.modelRunner() }) : undefined,
      attachmentParts: agentParts,
      pluginHooks: host.hooks,
      turnId,
      agentId: agent.id,
      parentAgentId: 'supervisor',
    }, imageAttachments)
    // Prefer the locally-tee'd streamed text; fall back to the invoker's return value when the
    // graph's final AIMessage happens to be empty (e.g. tool-call-only final step).
    agentText = agentText || returnedText
  } catch (err) {
    logInfo('session', 'turn:error', { sessionId: host.id, turnId, agentId: agent.id, error: err instanceof Error ? err.message : String(err) })
    closeReasoningBurst()
    host.emit({ type: 'step_failed', sessionId: host.id, turnId, agentId: agent.id, error: err instanceof Error ? err.message : String(err), timestamp: Date.now() })
    const isAbort = err instanceof Error && err.name === 'AbortError'
    _send({ type: 'error', sessionId: host.id, code: isAbort ? 'CANCELLED' : 'AGENT_ERROR', message: isAbort ? 'User cancelled the request' : safeErrorMessage(err) })
    host.running = false
    host.abortController = null
    host.endActivity()
    _send({ type: 'agent:finished', sessionId: host.id, turnId, agentId: agent.id })
    return ''
  }

  host.running = false
  host.abortController = null
  host.endActivity()
  closeReasoningBurst()
  const run = trajectory.get(agent.id); if (run) run.finishedAt = Date.now()
  _send({ type: 'agent:finished', sessionId: host.id, turnId, agentId: agent.id })

  const { citations, strippedContent } = parseMemoryCitations(
    agentText,
    host.memoryIdsInjectedThisTurn,
  )
  const memoryCitations = citations.length ? citations : undefined
  if (memoryCitations && host.memoryService) {
    bumpMemoryUseCounts(host.memoryService.store, memoryCitations.map((c) => c.memoryId))
  }
  const finalAgentText = strippedContent
  host.messages.push(new AIMessage(finalAgentText))
  host.emit({ type: 'text_ended', sessionId: host.id, messageId: turnId, content: finalAgentText, timestamp: Date.now() })
  const runs: AgentRun[] = trajectoryToRuns(trajectory).map((r) => ({ ...r, messageId: turnId, parentAgentId: 'supervisor', ...(usageByAgent.get(r.agentId) ? { usage: usageByAgent.get(r.agentId) } : {}) }))
  const turnUsage = sumUsage(runs.map((r) => r.usage))
  const timeline = trajectoryToTimeline(trajectory)
  const toolCalls = runs.flatMap((r) => r.toolCalls ?? []).sort((a, b) => a.seq - b.seq)
  // Persist with agentId='supervisor' so insertTurnBody is invoked and the legacy messages table
  // stores timeline + agentRuns. Without this, a later session:load (common in Code sessions with
  // cwd/project state) returns a stripped message and the sub-agent activity vanishes.
  // Persist assistant even when agentText is empty so tool-only turns keep message_id linkage.
  const hasWork = !!finalAgentText || runs.length > 0 || timeline.length > 0
  host.emit({ type: 'step_ended', sessionId: host.id, turnId, agentId: 'supervisor', timestamp: Date.now() }, {
    usage: turnUsage,
    runs,
    assistant: hasWork
      ? {
          id: turnId,
          sessionId: host.id,
          agentId: agent.id,
          content: finalAgentText,
          timestamp: Date.now(),
          timeline,
          ...(memoryCitations ? { memoryCitations } : {}),
        }
      : null,
  })
  _send({
    type: 'message:complete',
    sessionId: host.id,
    message: {
      id: turnId,
      role: 'assistant',
      content: finalAgentText,
      agentId: agent.id,
      timestamp: Date.now(),
      timeline,
      toolCalls,
      agentRuns: runs,
      ...(turnUsage ? { usage: turnUsage } : {}),
      ...(memoryCitations ? { memoryCitations } : {}),
    },
  })

  await flushLangSmithTraces()
  if (isFirstTurn) {
    void host.generateFirstTurnTitle(input, finalAgentText, _send).catch((err) => {
      logNonCritical('generateFirstTurnTitle', err)
    })
  }

  // Background Phase1 memory extract (fire-and-forget; gated by generate/incognito flags).
  scheduleMemoryExtractAfterTurn(host)

  return finalAgentText
}

export async function runTurn(host: SessionTurnHost, rawSend: SendFn, base?: {
  messages: BaseMessage[]
  steps: number
  planningMode?: 'fast' | 'plan'
  planStatus?: 'none' | 'generating' | 'ready' | 'approved' | 'rejected'
  plan?: PlanItem[]
}): Promise<string> {
  // ── DAG orchestration branch ──
  // Only an explicit pendingWorkflowDef enters this path (resolveWorkflowDefForTurn
  // ignores orchMode; no forced builtin:cluster-default). Persistence goes through
  // DurableExecutor when SQLite is available (see workflow-runner). User text is
  // injected as runInputs.
  const dagDef = resolveWorkflowDefForTurn(host)
  if (dagDef) {
    host.pendingWorkflowDef = null
    const userText = extractLastUserText(host.messages)
    // runWorkflowTurnFn is free-standing and does not touch host.running — set the
    // busy flag here so concurrent workflow:run / message:send see BUSY. Cleanup
    // mirrors the fast-path finally block below (running + abortController).
    // Pass host.abortController.signal so Session.cancel() aborts the DAG turn.
    host.abortController = new AbortController()
    host.running = true
    try {
      return await runWorkflowTurnFn(
        host.workflowDeps,
        dagDef,
        rawSend,
        (s, turnId, text, traj, stopped) => host.finalizeAndPersist(s, turnId, text, traj, stopped),
        {
          runInputs: { text: userText },
          signal: host.abortController.signal,
          // UserPromptSubmit already fired in processInput.
          skipUserPromptSubmit: true,
        },
      )
    } finally {
      host.running = false
      host.abortController = null
    }
  }

  host.abortController = new AbortController(); host.running = true

  // Reload network policy config at the top of each turn so that
  // edits to ~/.hip/config/network.json take effect without restart.
  // When the file is deleted after previously being loaded, reset to
  // factory defaults.
  const networkCfg = loadNetworkPolicyConfig()
  if (networkCfg) {
    host.networkPolicy.updateConfig(networkCfg)
  } else if (host.networkPolicy.hasLoadedCustomConfig()) {
    host.networkPolicy.reset()
  }

  if (!base && host._config.useEventSource !== false && host.eventStore) {
    const rebuilt = host.rebuildMessagesFromEvents(host.id)
    if (host.messages.length === 0 || rebuilt.length === host.messages.length) {
      host.messages.length = 0
      host.messages.push(...rebuilt)
    }
  }

  // Providers reject histories where AIMessage.tool_calls lack following ToolMessages
  // (INVALID_TOOL_RESULTS). Repair before invoke — covers corrupt snapshots and aborts.
  if (!hasValidToolCallPairing(host.messages)) {
    const fixed = ensureToolCallResults(host.messages)
    host.messages.length = 0
    host.messages.push(...fixed)
  }

  const supportsImages = host.currentModelSupportsImages()
  const modelReady = (messages: BaseMessage[]) => supportsImages ? messages : stripImageContentParts(messages)
  const visibleMessages = modelReady(host.messages)

  let timedOut = false
  const watchdog = new IdleWatchdog(host.idleTimeoutMs, () => { timedOut = true; host.abortController?.abort() })
  const send: SendFn = (msg) => { watchdog.kick(); rawSend(msg) }

  const turnId = `asst-supervisor-${Date.now()}-${host.turnSeq++}`
  logInfo('session', 'turn:start', { sessionId: host.id, turnId })
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
    send({ type: 'reasoning:delta', sessionId: host.id, turnId, agentId, role, stepSeq: reasoning.push(agentId, delta), delta })
  }
  const closeReasoning = (agentId: string) => {
    const burst = reasoning.close(agentId); if (burst) { const r = trajectory.get(agentId); if (r) r.reasoningBursts.push(burst) }
  }
  const ensureStarted = (agentId: string, role: AgentRole, parentAgentId?: string, taskInput?: string, agentTaskId?: string) => {
    if (started.has(agentId)) return; started.add(agentId)
    const stepId = agentId === 'supervisor' ? turnId : agentId
    host.activeSteps.set(agentId, stepId)
    trajectory.set(agentId, { role, output: '', startedAt: Date.now(), finishedAt: null, seq: agentSeq++, toolCalls: new Map(), reasoningBursts: [], ...(parentAgentId ? { parentAgentId } : {}), ...(taskInput ? { taskInput } : {}) })
    logInfo('session', 'agent:started', { sessionId: host.id, turnId, agentId, role })
    send({ type: 'agent:started', sessionId: host.id, turnId, agentId, role, ...(parentAgentId ? { parentAgentId } : {}), ...(taskInput ? { taskInput } : {}), ...(agentTaskId ? { taskId: agentTaskId } : {}) })
    host.emit({ type: 'step_started', sessionId: host.id, turnId: stepId, agentId, timestamp: Date.now() })
    host.emit({ type: 'text_started', sessionId: host.id, messageId: stepId, timestamp: Date.now() })
  }
  const ensureFinished = (agentId: string, output: string) => {
    if (!started.has(agentId)) return; closeReasoning(agentId)
    const r = trajectory.get(agentId)
    // Prefer the explicit final output, but fall back to the tee'd streamed output when the
    // invoker/runSubagent happens to return an empty string (e.g. tool-call-only final step).
    const effectiveOutput = output || r?.output || ''
    if (r) { r.output = effectiveOutput; r.finishedAt = Date.now() }
    started.delete(agentId); send({ type: 'agent:finished', sessionId: host.id, turnId, agentId })
    const stepId = host.activeSteps.get(agentId) ?? (agentId === 'supervisor' ? turnId : agentId)
    host.emit({ type: 'text_ended', sessionId: host.id, messageId: stepId, content: effectiveOutput, timestamp: Date.now() })
    if (agentId !== 'supervisor') {
      host.emit({ type: 'step_ended', sessionId: host.id, turnId: stepId, agentId, timestamp: Date.now() })
    }
  }
  const finishRemaining = () => {
    for (const id of started) { closeReasoning(id); const r = trajectory.get(id); if (r) r.finishedAt = Date.now(); send({ type: 'agent:finished', sessionId: host.id, turnId, agentId: id }) }
    started.clear()
  }

  let supervisorText = ''

  const turnStartResult = await host.hooks.fire('TurnStart', { sessionId: host.id, turnId }).catch(() => ({ kind: 'deny' as const, reason: 'Hook error' }))
  if (turnStartResult.kind !== 'allow') {
    host.running = false
    host.abortController = null
    rawSend({ type: 'error', sessionId: host.id, code: 'HOOK_DENIED', message: `Turn start rejected: ${turnStartResult.reason ?? 'blocked by hook'}` })
    return ''
  }

  ensureStarted('supervisor', 'supervisor')

  const cronDue = host.cronManager.tick()
  const cronMessages: BaseMessage[] = cronDue.map((p) => new SystemMessage(`<system-reminder>${p}</system-reminder>`))

  const cwd = host._config.cwd ?? process.cwd()
  const runner = host.modelRunner(); const summarizer = host.summarizer()
  const skills = host.configMgr.skills; const pluginAgents = host.configMgr.pluginAgents
  const rawMode = host._config.permissionMode
  const mode: PermissionMode = rawMode === 'chat' || rawMode === 'full' ? rawMode : 'edit'
  const usedTokens = estimateTokens(visibleMessages)
  const tokenBudgetPercent = Math.max(0, Math.min(100, Math.round(100 - (usedTokens / COMPACT_BUDGET_TOKENS) * 100)))

  const logToken = logDebugEveryN('session', 10, 'token:stream', { sessionId: host.id, turnId, agentId: 'supervisor' })
  const makeEmit = (agentId: string, role: AgentRole): GraphEmit => ({
    token: (delta) => { if (!delta) return; logToken(); if (agentId === 'supervisor') supervisorText += delta; const r = trajectory.get(agentId); if (r) r.output += delta; send({ type: 'token:stream', sessionId: host.id, turnId, agentId, delta }) },
    reasoning: (delta) => reasoningDelta(agentId, role, delta),
    toolStarted: (name, callId, input) => { closeReasoning(agentId); const seq = nextSeq(); const inClip = clipForTool(name, stringify(input)); recorder.start(agentId, callId, name, inClip.text, seq, inClip.truncated); send({ type: 'tool:started', sessionId: host.id, turnId, agentId, role, callId, name, input: inClip.text, seq, ...(inClip.truncated ? { truncated: true } : {}) }); const stepId = host.activeSteps.get(agentId) ?? (agentId === 'supervisor' ? turnId : agentId); host.emit({ type: 'tool_called', sessionId: host.id, callId, name, input: inClip.text, timestamp: Date.now() }, { stepId }); host.checkSteerPromotion() },
    toolFinished: (callId, status, output, error) => { const toolName = trajectory.get(agentId)?.toolCalls.get(callId)?.name ?? ''; const outClip = output !== undefined ? clipForTool(toolName, stringify(output)) : undefined; recorder.finish(agentId, callId, status, outClip?.text, error, outClip?.truncated ?? false); send({ type: 'tool:finished', sessionId: host.id, turnId, agentId, callId, status, ...(outClip ? { output: outClip.text } : {}), ...(error ? { error } : {}), ...(outClip?.truncated ? { truncated: true } : {}) }); const stepId = host.activeSteps.get(agentId) ?? (agentId === 'supervisor' ? turnId : agentId); if (status === 'finished') { host.emit({ type: 'tool_success', sessionId: host.id, callId, output: outClip?.text ?? '', timestamp: Date.now() }, { stepId }) } else { host.emit({ type: 'tool_failed', sessionId: host.id, callId, error: error ?? '', timestamp: Date.now() }, { stepId }) }; host.checkSteerPromotion() },
    usage: (u) => { usageByAgent.set(agentId, addUsage(usageByAgent.get(agentId), u)) },
    planDelta: (itemId, delta) => { send({ type: 'plan:delta', sessionId: host.id, turnId, itemId, delta }) },
    planUpdated: (plan) => { send({ type: 'plan:updated', sessionId: host.id, turnId, plan }) },
    compaction: (summary: string, meta?: { replacedMessageIds?: string[] }) => {
      host.emit({
        type: 'compaction_ended',
        sessionId: host.id,
        summary,
        timestamp: Date.now(),
        ...(meta?.replacedMessageIds?.length ? { replacedMessageIds: meta.replacedMessageIds } : {}),
      })
    },
    // Keep idle watchdog alive during long tool walks (grep/glob) without extra WS traffic.
    activity: () => { watchdog.kick() },
  })
  const emit = makeEmit('supervisor', 'supervisor')
  let subagentSeq = 0
  const spawnSubagent = async (description: string, subagentMode: 'foreground' | 'background' = 'foreground', taskId?: string, signal?: AbortSignal): Promise<string> => {
    const childId = taskId ?? `worker-${++subagentSeq}`
    host.spawnedSubagentIds.add(childId)
    host.subagentInstances.set(childId, { description })
    if (subagentMode === 'background') {
      const result = host.backgroundManager.spawn(
        childId,
        description,
        async (signal) => {
          await host.runBackgroundSubagent(childId, description, signal, send)
        },
        { originConnectionId: host.currentConnectionId ?? host.ownerConnectionId ?? null },
      )
      if (result !== childId) return result
      return `Background task started: ${childId}`
    }
    if (taskId && host.backgroundTasks.has(taskId)) return `Error: subagent ${taskId} is already running`
    const existingMessages = taskId ? host.loadSubagentMessages(taskId) : undefined
    ensureStarted(childId, 'worker', 'supervisor', description, taskId)
    const toolsOf = () => {
      const run = trajectory.get(childId)
      return run
        ? Array.from(run.toolCalls.values())
            .sort((a, b) => a.seq - b.seq)
            .map((t) => ({ name: t.name, status: t.status, output: t.output, error: t.error, input: t.input }))
        : []
    }
    try {
      const text = await runSubagent({
        runner, root: cwd, summarizer, emit: makeEmit(childId, 'worker'),
        signal: signal ?? host.abortController!.signal, description, childMaxSteps: childMaxStepsForAgent('worker', cwd),
        permissionMode: mode, requestApproval, sessionId: host.id,
        title: host.store?.getSession(host.id)?.title,
        networkPolicy: host.networkPolicy, toolOutputStore: host.toolOutputStore,
        guardianReviewer: host.usesEnvModel ? new GuardianReviewer({ modelRunner: runner }) : undefined,
        hooks: host.hooks, turnId, agentId: childId, parentAgentId: 'supervisor',
        ...(existingMessages && existingMessages.length > 0 ? { existingMessages } : {}),
      })
      const run = trajectory.get(childId)
      const tools = toolsOf()
      // Prefer invoker text; fall back to tee'd stream (empty lastAiText but tokens streamed).
      const result = synthesizeSubagentResult(text || run?.output, tools)
      ensureFinished(childId, result)
      return result
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw err
      const msg = safeErrorMessage(err)
      const tools = toolsOf()
      const run = trajectory.get(childId)
      // Preserve partial research when the model dies mid-loop (e.g. provider 404).
      const partial = synthesizeSubagentResult(run?.output, tools)
      const result =
        partial && !partial.startsWith('Error:')
          ? `${partial}\n\nError: sub-agent stopped early: ${msg}`
          : tools.length > 0
            ? `${synthesizeSubagentResult('', tools)}\n\nError: sub-agent stopped early: ${msg}`
            : `Error: ${msg}`
      ensureFinished(childId, result)
      return result
    }
  }

  const retrySubagentWrapper = async (agentId: string): Promise<string> => {
    ensureStarted(agentId, 'worker', 'supervisor', 'retrying', agentId)
    const text = await host.retrySubagent(agentId, send, makeEmit(agentId, 'worker'))
    ensureFinished(agentId, text)
    return text
  }

  const enabledFixedAgents = FIXED_AGENTS.filter(a => host.getFixedAgents()?.[a.id] !== false)
  const enabledAgents = [...readAgentsConfig(cwd).filter((a) => a.enabled && a.id !== 'builtin'), ...pluginAgents.filter((a) => a.enabled && a.id !== 'builtin'), ...enabledFixedAgents]
  const invoker = host.agentProv.invoker(cwd)
  const requestApproval = host.permissions.buildRequestApproval(send, host.id, turnId, nextSeq, mode, host.hooks)
  const requestChoice = (
    req: { title: string; kind: string; content: string; options: import('@hip/protocol').PermissionOption[] },
  ) =>
    host.permissions.requestChoice(send, host.id, turnId, nextSeq, {
      title: req.title,
      kind: req.kind,
      content: req.content,
    }, req.options)

  const spawnInWorktree = async (args: {
    taskId: string
    description: string
    root: string
  }): Promise<string> => {
    const childId = args.taskId
    host.spawnedSubagentIds.add(childId)
    host.subagentInstances.set(childId, { description: args.description })
    const result = host.backgroundManager.spawn(
      childId,
      args.description,
      async (signal) => {
        await host.runBackgroundSubagent(childId, args.description, signal, send, {
          root: args.root,
          keepWorktree: true,
        })
      },
      { originConnectionId: host.currentConnectionId ?? host.ownerConnectionId ?? null },
    )
    if (result !== childId) return result
    return `Background task started: ${childId}`
  }

  const activeProfile = host.getActiveProfile()
  let tooling: SessionTooling | undefined = undefined
  let contextMessages: BaseMessage[] = []
  let system = ''

  const dispatchAgent = async (agentId: string, task: string, overrideSignal?: AbortSignal): Promise<string> => {
    const cfg = enabledAgents.find((a) => a.id === agentId)
    if (!cfg) return `Error: unknown or disabled agent ${agentId}`
    const childId = `subagent-${++subagentSeq}`
    ensureStarted(childId, 'subagent', 'supervisor', task)
    const hooks: ExternalAgentHooks = {
      requestPermission: (req) => {
        const auto = tryAutoResolvePermission(mode, req.tool.kind, req.options)
        if (auto) return Promise.resolve(auto)
        return new Promise((resolve) => { host.permissions.pendingPermissions.set(req.requestId, resolve); send({ type: 'permission:request', sessionId: host.id, turnId, requestId: req.requestId, tool: req.tool, options: req.options, agentFrame: { agentId: childId, parentAgentId: 'supervisor', name: cfg.name } }) })
      },
      configOptions: () => {},
    }
    try {
      // Read-only memory for managed agents when useMemories (KD-7).
      // When perAgentMemory is on, load shared ∪ this registry agentId (not ephemeral childId).
      let systemPromptExtra: string | undefined
      let extraTools: import('@langchain/core/tools').StructuredToolInterface[] | undefined
      const memFlags = resolveSessionMemoryFlags(loadMemoryConfig(), host._config)
      if (memFlags.use && host.memoryService) {
        const memCfg = host.memoryService.getConfig()
        const bucketAgentId = memCfg.perAgentMemory ? agentId : undefined
        let coreSnap = host.memoryCoreSnapshot
        if (memCfg.perAgentMemory) {
          let projectKeyHash: string | undefined
          try {
            projectKeyHash = resolveProjectKey(cwd).projectKeyHash
          } catch {
            projectKeyHash = undefined
          }
          coreSnap = host.memoryService.loadCoreSnapshot(projectKeyHash, undefined, {
            agentId: bucketAgentId,
          }).text
        }
        if (coreSnap) {
          systemPromptExtra = `## Cross-session memory (read-only for sub-agent)\n\n${coreSnap}`
        }
        const subTools = memCfg.memoryToolsForSubagents ?? 'search'
        if (subTools === 'search' || subTools === 'all') {
          const toolCtx = {
            sessionId: host.id,
            cwd,
            defaultScope: memCfg.defaultScope,
            agentId: bucketAgentId,
          }
          extraTools =
            subTools === 'all'
              ? buildMemoryTools(host.memoryService, toolCtx)
              : [buildMemorySearchToolOnly(host.memoryService, toolCtx)]
        }
      }
      const text = await invoker.invoke(agentId, task, makeEmit(childId, 'subagent'), overrideSignal ?? host.abortController!.signal, hooks, {
        mcpTools: tooling?.tools, skills, requestApproval, permissionMode: mode, sessionId: host.id,
        title: host.store?.getSession(host.id)?.title,
        networkPolicy: host.networkPolicy, toolOutputStore: host.toolOutputStore,
        guardianReviewer: host.usesEnvModel ? new GuardianReviewer({ modelRunner: runner }) : undefined,
        pluginHooks: host.hooks, turnId, agentId: childId, parentAgentId: 'supervisor',
        systemPromptExtra,
        extraTools,
      })
      const run = trajectory.get(childId)
      const tools = run
        ? Array.from(run.toolCalls.values())
            .sort((a, b) => a.seq - b.seq)
            .map((t) => ({ name: t.name, status: t.status, output: t.output, error: t.error, input: t.input }))
        : []
      // Prefer invoker text; fall back to tee'd stream (empty lastAiText but tokens streamed).
      const result = synthesizeSubagentResult(text || run?.output, tools)
      ensureFinished(childId, result)
      return result
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw err
      const msg = safeErrorMessage(err)
      const run = trajectory.get(childId)
      const tools = run
        ? Array.from(run.toolCalls.values())
            .sort((a, b) => a.seq - b.seq)
            .map((t) => ({ name: t.name, status: t.status, output: t.output, error: t.error, input: t.input }))
        : []
      const partial = synthesizeSubagentResult(run?.output, tools)
      const result =
        partial && !partial.startsWith('Error:')
          ? `${partial}\n\nError: sub-agent stopped early: ${msg}`
          : tools.length > 0
            ? `${synthesizeSubagentResult('', tools)}\n\nError: sub-agent stopped early: ${msg}`
            : `Error: ${msg}`
      ensureFinished(childId, result)
      return result
    }
  }

  const t0 = Date.now()

  const planMode: PlanMode | undefined = host._config.disablePlan ? undefined : host.planMode

  if (!host.agentProv.isExternalAgent()) {
    // Cross-session memory: ensure service, resolve flags, freeze/refresh core snapshot.
    if (!host.memoryService && host.store) {
      const db = host.store.getDb()
      const memoriesFts = tryEnableMemoriesFts(db)
      const memoriesVec = tryEnableSqliteVec(db)
      host.memoryService = new MemoryService(new MemoryStore(db, memoriesFts, memoriesVec))
      host.memoryService.runStartupDecayOnce()
    }
    const flags = resolveSessionMemoryFlags(loadMemoryConfig(), host._config)
    const useMemories = flags.use
    const snapshotResult = refreshMemoryCoreSnapshot({
      useMemories: useMemories && !!host.memoryService,
      cwd,
      hostSnapshot: host.memoryCoreSnapshot,
      hostCoreIds: host.memoryCoreIds,
      hostProjectKey: host.memorySnapshotProjectKey,
      hostGeneration: host.memoryCoreGeneration,
      storeGeneration: host.memoryService?.getCoreGeneration() ?? 0,
      load: (projectKeyHash) => host.memoryService!.loadCoreSnapshot(projectKeyHash),
      resolveKey: resolveProjectKey,
    })
    host.memoryCoreSnapshot = snapshotResult.snapshot
    host.memoryCoreIds = snapshotResult.coreIds
    host.memorySnapshotProjectKey = snapshotResult.projectKey
    host.memoryCoreGeneration = snapshotResult.generation
    const memoryCoreSnapshot = snapshotResult.snapshot
    const memoryIdsInjectedThisTurn = new Set<string>()
    host.memoryIdsInjectedThisTurn = memoryIdsInjectedThisTurn

    const prefetchQuery = extractLastUserText(
      base?.messages !== undefined ? modelReady(base.messages) : visibleMessages,
    )

    const resolvedSurface = surfaceOf(host._config, host.id)
    const contextState: SessionContextState = {
      cwd,
      customSystemPrompt: host._config.systemPrompt,
      skills,
      permissionMode: mode,
      mcpCatalog: mcpManager.toolCatalog() || undefined,
      tokenBudgetPercent,
      surface: resolvedSurface,
      pendingSubagents: host.backgroundManager.runningCount > 0
        ? host.backgroundManager.runningEntries()
        : undefined,
      completedSubagents: (() => {
        const entries = host.backgroundManager.completedEntries()
        return entries.length > 0 ? entries : undefined
      })(),
      sessionId: host.id,
      useMemories,
      memoryCoreSnapshot,
      memoryCoreIds: snapshotResult.coreIds,
      memoryIdsInjected: memoryIdsInjectedThisTurn,
      prefetchQuery: prefetchQuery || undefined,
      openFilePath: (host as { openFilePath?: string }).openFilePath,
      openFileExcerpt: (host as { openFileExcerpt?: string }).openFileExcerpt,
    }

    const injectorRegistry = new ContextInjectorRegistry()
    injectorRegistry.register(new SystemPromptInjector())
    injectorRegistry.register(new ProjectAgentsMdInjector())
    // Skills already embedded by SystemPromptInjector / buildSystemPrompt — skip SkillsListInjector.
    injectorRegistry.register(new PermissionModeInjector())
    injectorRegistry.register(new TokenBudgetInjector())
    injectorRegistry.register(new SubagentStatusInjector())
    injectorRegistry.register(new OpenFileContextInjector())
    // Memory last (Option A): AGENTS.md / other injectors take priority ordering-wise.
    if (host.memoryService) {
      injectorRegistry.register(new MemoryInjector(host.memoryService))
    }

    logDebug('session', 'phase:prepareContext', { sessionId: host.id, elapsedMs: Date.now() - t0 })
    const prepared = await prepareSessionContext(host.id, 'supervisor', contextState, host.store, false, injectorRegistry)
    system = prepared.system
    contextMessages = prepared.contextMessages
    logDebug('session', 'phase:contextDone', { sessionId: host.id, elapsedMs: Date.now() - t0, contextMsgCount: prepared.contextMessages.length })
    tooling = await buildSessionTooling({
      cwd,
      sessionId: host.id,
      mode,
      surface: resolvedSurface,
      skills,
      mcpConfigs: host.configMgr.mcpConfigs,
      enabledAgents,
      dispatch: enabledAgents.length ? { agents: enabledAgents.map((a) => ({ id: a.id, name: a.name, description: a.description })), signal: host.abortController!.signal, run: dispatchAgent } : undefined,
      spawnSubagent,
      retrySubagent: retrySubagentWrapper,
      stopBackgroundTask: (taskId, reason) => host.backgroundManager.stop(taskId, reason),
      getBackgroundTaskOutput: (taskId) => host.backgroundManager.getOutput(taskId),
      hooks: host.hooks,
      approvalCache: host.approvalCache,
      requestApproval,
      requestChoice,
      spawnInWorktree,
      onParallelRunStarted: (payload) => {
        send({
          type: 'parallel:started',
          sessionId: host.id,
          runId: payload.runId,
          baseCwd: payload.baseCwd,
          goal: payload.goal,
          slots: payload.slots,
        })
      },
      onWorktreeChanged: (ev) => {
        send({
          type: 'worktree:changed',
          sessionId: ev.sessionId ?? host.id,
          repoKey: ev.repoKey,
          kind: ev.kind,
          worktree: ev.worktree,
          ...(ev.reveal !== undefined ? { reveal: ev.reveal } : {}),
        })
      },
      allowedTools: activeProfile.allowedTools,
      blockedTools: activeProfile.blockedTools,
      usesEnvModel: host.usesEnvModel,
      runner,
      toolOutputStore: host.toolOutputStore,
      networkPolicy: host.networkPolicy,
      guardianReviewer: host.usesEnvModel ? new GuardianReviewer({ modelRunner: runner }) : undefined,
      onToolStarted: (name, callId, input) => emit.toolStarted(name, callId, input),
      onToolFinished: (callId, status, output, error) => emit.toolFinished(callId, status, output, error),
      emitRisk: (toolName, risk, approval) => {
        send({ type: 'guardian:risk', sessionId: host.id, turnId, toolName, risk, category: approval, reason: '' })
      },
      goalManager: host.goalManager,
      onGoalUpdated: (goal) => {
        send({
          type: 'goal:updated',
          sessionId: host.id,
          goal: goal
            ? {
                id: goal.id,
                description: goal.description,
                status: goal.status as 'active' | 'paused' | 'blocked' | 'completed',
                turns: goal.usage.turns,
                maxTurns: goal.budget.maxTurns,
                tokens: goal.usage.tokens,
                maxTokens: goal.budget.maxTokens,
              }
            : null,
        })
      },
      cronManager: host.cronManager,
      planMode,
      memoryService: host.memoryService,
      useMemories,
      turnId,
      agentId: 'supervisor',
    })
    logDebug('session', 'phase:toolingDone', { sessionId: host.id, elapsedMs: Date.now() - t0, toolCount: tooling?.tools.length ?? 0 })
    // After reconcile: status reflects actual connection state
    send({ type: 'mcp:status', servers: mcpManager.connectionStatuses(host.configMgr.mcpConfigs) })
  }

  const effectiveLoop = resolveEffectiveConfig(cwd).agentLoop
  const maxSteps = host.activeActivity?.stepsRemaining ?? maxStepsForSession(cwd)
  // Product path: pass doom strategy from hip.toml; never inject CircuitBreaker (experimental).
  const doomLoopStrategy = resolveDoomLoopStrategy(effectiveLoop?.doomLoopStrategy)
  const ctx: GraphCtx = {
    runner, tools: tooling?.tools ?? [], emit, summarizer, hooks: host.hooks, sessionId: host.id,
    turnId, agentId: 'supervisor',
    toolRunner: tooling?.toolRunner, toolPolicy: host.toolPolicy, approvalCache: host.approvalCache,
    requestApproval, permissionMode: mode, allowedTools: activeProfile.allowedTools,
    blockedTools: activeProfile.blockedTools, systemPrompt: system, activeProfileId: activeProfile.id,
    maxSteps, planMode, doomLoopStrategy,
  }

  let finalState: LoopState | undefined
  try {
    if (host.agentProv.isExternalAgent()) {
      const userText = lastUserText(base?.messages !== undefined ? modelReady(base.messages) : visibleMessages)
      const cronPrefix = cronMessages.length ? cronMessages.map((m) => m.content as string).join('\n\n') + '\n\n' : ''
      // ACP primary only: optional fenced memory prefix (not for subagent invoker).
      // Single gate lives in resolveAcpExternalMemoryPrefix — pass real flag values.
      let memoryPrefix = ''
      {
        const memCfgEarly = host.memoryService?.getConfig() ?? loadMemoryConfig()
        const flagsEarly = resolveSessionMemoryFlags(memCfgEarly, host._config)
        const mayInject =
          flagsEarly.use && !!memCfgEarly.useMemoriesWithExternal && !flagsEarly.incognito
        if (mayInject && !host.memoryService && host.store) {
          const db = host.store.getDb()
          const memoriesFts = tryEnableMemoriesFts(db)
          const memoriesVec = tryEnableSqliteVec(db)
          host.memoryService = new MemoryService(new MemoryStore(db, memoriesFts, memoriesVec))
          host.memoryService.runStartupDecayOnce()
        }
        const memCfg = host.memoryService?.getConfig() ?? memCfgEarly
        const flags = resolveSessionMemoryFlags(memCfg, host._config)
        let coreBody = ''
        if (mayInject && host.memoryService) {
          const snapshotResult = refreshMemoryCoreSnapshot({
            useMemories: flags.use,
            cwd,
            hostSnapshot: host.memoryCoreSnapshot,
            hostCoreIds: host.memoryCoreIds,
            hostProjectKey: host.memorySnapshotProjectKey,
            hostGeneration: host.memoryCoreGeneration,
            storeGeneration: host.memoryService.getCoreGeneration(),
            load: (projectKeyHash) => host.memoryService!.loadCoreSnapshot(projectKeyHash),
            resolveKey: resolveProjectKey,
          })
          host.memoryCoreSnapshot = snapshotResult.snapshot
          host.memoryCoreIds = snapshotResult.coreIds
          host.memorySnapshotProjectKey = snapshotResult.projectKey
          host.memoryCoreGeneration = snapshotResult.generation
          coreBody = snapshotResult.snapshot ?? ''
        }
        memoryPrefix = resolveAcpExternalMemoryPrefix({
          useMemories: flags.use,
          useMemoriesWithExternal: !!memCfg.useMemoriesWithExternal,
          incognito: flags.incognito,
          memoryServiceAvailable: !!host.memoryService,
          coreSnapshotBody: coreBody,
          maxCoreSummaryChars: memCfg.maxCoreSummaryChars,
        })
      }
      const hooks: ExternalAgentHooks = {
        requestPermission: (req) => {
          const auto = tryAutoResolvePermission(mode, req.tool.kind, req.options)
          if (auto) return Promise.resolve(auto)
          return new Promise((resolve) => { host.permissions.pendingPermissions.set(req.requestId, resolve); send({ type: 'permission:request', sessionId: host.id, turnId, requestId: req.requestId, tool: req.tool, options: req.options }) })
        },
        configOptions: (options) => send({ type: 'agent:configOptions', sessionId: host.id, options }),
      }
      const provider = host.agentProv.ensureExternalProvider()
      const setFs = (provider as { setTurnFsContext?: (ctx: { cwd: string; permissionMode: PermissionMode; readMaxBytes: number }) => void }).setTurnFsContext
      if (typeof setFs === 'function') {
        const acpHost = resolveAcpHostConfig(cwd)
        setFs.call(provider, {
          cwd,
          permissionMode: mode,
          readMaxBytes: acpHost.fsReadMaxBytes,
        })
      }
      await provider.runTurn(memoryPrefix + cronPrefix + userText, emit, host.abortController.signal, hooks)
      closeReasoning('supervisor'); finishRemaining()
      const acpId = host.agentProv.acpSessionId; if (acpId && host.store) host.store.setAcpSessionId(host.id, acpId)
    } else {
      const effectiveMessages = base?.messages !== undefined ? modelReady(base.messages) : visibleMessages
      const userText = lastUserText(effectiveMessages)
      const usePlan = shouldPlan(userText, {
        forcePlan: host._config.forcePlan,
        disablePlan: host._config.disablePlan,
      })
      const initialPlanningMode = base?.planningMode ?? (usePlan || activeProfile.id === 'plan' ? 'plan' : 'fast')
      const stepsBefore = base?.steps ?? 0
      // Product forcePlan: hard-enter PlanMode so write_file/edit outside the plan file is blocked
      // until ExitPlanMode (prompt-only nudge was ignored by agents in live eval).
      if (
        host._config.forcePlan &&
        !host._config.disablePlan &&
        planMode &&
        !planMode.isActive &&
        (base?.planStatus === undefined || base?.planStatus === 'none' || base?.planStatus === 'generating')
      ) {
        try {
          await planMode.enter(host.id)
        } catch {
          // already active or fs error — continue with soft nudge
        }
      }
      const forcePlanMessages = host._config.forcePlan
        ? [
            new SystemMessage(
              'Plan mode is required and already active for this task. ' +
                'Do NOT answer the user request yet. ' +
                'Investigate with read-only tools if needed, then write the plan ' +
                '(plan file and/or write_todos with structured steps), ' +
                'and call ExitPlanMode so the user can approve before any non-plan work or final answer.',
            ),
          ]
        : []
      logDebug('session', 'phase:invokeGraph', { sessionId: host.id, elapsedMs: Date.now() - t0, msgCount: effectiveMessages.length })
      finalState = await host.app.invoke(
        {
          messages: [new SystemMessage(system), ...forcePlanMessages, ...cronMessages, ...contextMessages, ...effectiveMessages],
          steps: base?.steps ?? 0,
          recentSigs: [],
          nudgedSig: undefined,
          status: 'running',
          planningMode: initialPlanningMode,
          planStatus: base?.planStatus ?? (host._config.forcePlan && planMode?.isActive ? 'generating' : 'none'),
          plan: base?.plan,
          verifyMemo: undefined,
        },
        {
          configurable: { ctx },
          signal: host.abortController.signal,
          recursionLimit: recursionLimit(maxSteps),
          ...tracingInvokeFields({
            kind: 'session-turn',
            sessionId: host.id,
            turnId,
            agentId: 'supervisor',
            // LangSmith project list shows this runName — use session id.
            title: host.store?.getSession(host.id)?.title,
          }),
        },
      )
      host.consumeActivitySteps(finalState.steps - stepsBefore)
      closeReasoning('supervisor'); finishRemaining()

      const ephemeralPrefix = 1 + forcePlanMessages.length + cronMessages.length + contextMessages.length
      if (finalState.compacted && host.store) {
        new ContextEpoch(host.store.getDb()).requestReplacement(host.id, 0)
      }
      if (finalState.status === 'awaiting_user') {
        host.paused = {
          messages: finalState.messages.slice(ephemeralPrefix),
          steps: finalState.steps,
          planningMode: finalState.planningMode,
          planStatus: finalState.planStatus,
          plan: finalState.plan,
        }
        host.awaitingResume = true
        const stoppedText = host.finalizeAndPersist(send, turnId, supervisorText, trajectory, true, usageByAgent, host.paused.messages)
        void host.hooks.fire('TurnComplete', { sessionId: host.id, turnId }).catch((err) => logNonCritical('TurnComplete', err))
        if (finalState.planningMode === 'plan' && finalState.plan) {
          send({ type: 'plan:published', sessionId: host.id, turnId, plan: finalState.plan })
        }
        const interruptContext = finalState.planningMode === 'plan'
          ? JSON.stringify({ kind: 'plan_approval', plan: finalState.plan })
          : undefined
        send({
          type: 'agent:interrupt',
          sessionId: host.id,
          turnId,
          agentId: 'supervisor',
          question: finalState.pendingQuestion ?? PAUSE_QUESTION,
          ...(interruptContext ? { context: interruptContext } : {}),
        })
        return stoppedText
      }
      const nextMessages = finalState.messages.slice(ephemeralPrefix)
      host.messages.length = 0
      host.messages.push(...nextMessages)
    }
  } catch (err) {
    logInfo('session', 'turn:error', { sessionId: host.id, turnId, error: err instanceof Error ? err.message : String(err), isAbort: err instanceof Error && err.name === 'AbortError' })
    const isAbort = err instanceof Error && err.name === 'AbortError'; finishRemaining()
    const isSteerAbort = host.steerAbortFlag
    if (isSteerAbort) host.steerAbortFlag = false

    /** Best-effort text: streamed supervisor output, else any trajectory agent output. */
    const partialFromTraj = (() => {
      const sup = trajectory.get('supervisor')?.output?.trim()
      if (sup) return sup
      const parts = [...trajectory.values()].map((r) => r.output?.trim()).filter(Boolean) as string[]
      return parts.length ? parts.join('\n\n') : ''
    })()
    const body = (supervisorText || partialFromTraj).trim()
    const stoppedSuffix = timedOut ? '(timed out)' : '(cancelled)'
    const stoppedBody = body ? `${body}\n\n${stoppedSuffix}` : stoppedSuffix

    if (isSteerAbort) {
      // Steer abort: persist partial if any so the UI is not left blank mid-turn.
      if (body || trajectory.size > 0) {
        const text = host.finalizeAndPersist(rawSend, turnId, stoppedBody, trajectory, true, usageByAgent)
        void host.hooks.fire('TurnComplete', { sessionId: host.id, turnId }).catch((err) => logNonCritical('TurnComplete', err))
        return text
      }
      return ''
    }
    if (isAbort) {
      // Always project a stopped assistant message (Sprint A — no empty cancel).
      const text = host.finalizeAndPersist(rawSend, turnId, stoppedBody, trajectory, true, usageByAgent)
      void host.hooks.fire('TurnComplete', { sessionId: host.id, turnId }).catch((err) => logNonCritical('TurnComplete', err))
      rawSend({
        type: 'error',
        sessionId: host.id,
        code: timedOut ? 'TIMEOUT' : 'CANCELLED',
        message: timedOut ? idleTimeoutMessage(host.idleTimeoutMs) : 'User cancelled the request',
      })
      return text
    }
    rawSend({ type: 'error', sessionId: host.id, code: 'AGENT_ERROR', message: safeErrorMessage(err) })
    // Unexpected errors: still project trajectory if we have partial work.
    if (body || trajectory.size > 0) {
      const text = host.finalizeAndPersist(
        rawSend,
        turnId,
        body ? `${body}\n\n(error)` : `(error: ${safeErrorMessage(err)})`,
        trajectory,
        true,
        usageByAgent,
      )
      void host.hooks.fire('TurnComplete', { sessionId: host.id, turnId }).catch((e) => logNonCritical('TurnComplete', e))
      return text
    }
    return ''
  } finally {
    tooling?.cleanup()
    watchdog.stop(); host.running = false; host.abortController = null; host.permissions.cancelAll()
  }

  const finalText = host.finalizeAndPersist(send, turnId, supervisorText, trajectory, false, usageByAgent)

  // Stop hook: if a hook returns { kind: 'continue', prompt }, inject the prompt
  // as a HumanMessage and loop once. Guarded by stopContinued to prevent infinite loops.
  const stopResult = await host.hooks.fire('Stop', { sessionId: host.id, turnId }).catch(() => ({ kind: 'allow' as const }))
  if (stopResult.kind === 'continue' && stopResult.prompt && !host.stopContinued) {
    host.stopContinued = true
    host.messages.push(new HumanMessage(stopResult.prompt))
    if (stopResult.additionalContexts) {
      for (const ctx of stopResult.additionalContexts) {
        host.messages.push(new SystemMessage(ctx))
      }
    }
    void host.hooks.fire('TurnComplete', { sessionId: host.id, turnId }).catch((err) => logNonCritical('TurnComplete', err))
    try {
      const continuedText = await runTurn(host, rawSend)
      return continuedText
    } finally {
      host.stopContinued = false
    }
  }

  void host.hooks.fire('TurnComplete', { sessionId: host.id, turnId }).catch((err) => logNonCritical('TurnComplete', err))

  // Goal mode: record turn usage for every completed turn.
  const turnUsage = sumUsage([...usageByAgent.values()])
  const totalTokens = (turnUsage?.inputTokens ?? 0) + (turnUsage?.outputTokens ?? 0)
  host.goalManager.recordTurn()
  if (totalTokens > 0) host.goalManager.recordTokens(totalTokens)

  // Goal mode: auto-continue if active goal has remaining budget and no user input pending.
  if (!host.awaitingResume && !host.goalContinued) {
    const driveResult = host.goalManager.drive()
    if (driveResult) {
      host.goalContinued = true
      host.messages.push(new HumanMessage(driveResult.prompt))
      try {
        const continuedText = await runTurn(host, rawSend)
        return continuedText
      } finally {
        host.goalContinued = false
      }
    }
  }

  const ckptLabel = (finalText || '').replace(/\s+/g, ' ').trim().slice(0, 72) || null
  void host.captureCheckpoint(turnId, ckptLabel, send).catch((err) => logNonCritical('captureCheckpoint', err))

  // Background Phase1 memory extract (fire-and-forget; gated by generate/incognito flags).
  scheduleMemoryExtractAfterTurn(host)

  return finalText
}
