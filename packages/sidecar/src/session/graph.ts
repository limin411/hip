import { StateGraph, Annotation, START, END, messagesStateReducer } from '@langchain/langgraph'
import type { LangGraphRunnableConfig } from '@langchain/langgraph'
import { AIMessage, SystemMessage, ToolMessage, RemoveMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { TurnUsage, PermissionMode, PlanItem } from '@hip/protocol'
import type { ModelRunner } from './model-runner.js'
import { MAX_STEPS } from './loop-control.js'
import { READ_TOOLS, DELEGATE_TOOLS, defaultToolPolicy } from './tool-runner/tool-policy.js'
import { resolveMaxConcurrency } from './subagent-batch.js'
import type { ToolPolicy } from './tool-runner/tool-policy.js'
import type { ApprovalCache } from './tool-runner/approval-cache.js'
import { SessionApprovalCache } from './tool-runner/approval-cache.js'
import { ToolRunner, resolveToolName } from './tool-runner/tool-runner.js'
import type { ToolCallResult } from './tool-runner/tool-runner.js'
import { runWithConcurrency } from './run-with-concurrency.js'
import type { ApprovalFn } from './tools.js'
import { SELF_GATED_TOOLS } from './tools.js'
import {
  sigOf,
  trailingRepeatCount,
  DOOM_LOOP_N,
  SIG_WINDOW,
  DOOM_LOOP_NUDGE,
  PAUSE_QUESTION,
  pathHitKey,
  countPathHits,
  PATH_HIT_LIMIT,
  PATH_REPEAT_MESSAGE,
  trailingErrorStreak,
  harvestTrailingToolErrors,
  isLoopToolError,
  ERROR_STREAK_LIMIT,
  ERROR_STREAK_NUDGE,
  resolveDoomLoopStrategy,
  type DoomLoopStrategy,
} from './doom-loop.js'
import { PLAN_APPROVAL_QUESTION_TOKEN } from './plan-approval-constants.js'
import {
  compactMessages,
  applyCompactResult,
  selectCompactMiddle,
  COMPACT_BUDGET_TOKENS,
  KEEP_RECENT_TURNS,
  MIN_STEPS_BETWEEN_LLM_COMPACT,
  isOverflowError,
  estimatePromptTokens,
  type Summarizer,
  type CompactResult,
} from './compaction.js'
import { usageFromModelMetadata } from './usage.js'
import { getActiveModel } from '../config/providers.js'
import {
  AUTO_COMPACT_THRESHOLD_PERCENT,
  TARGET_THRESHOLD_PERCENT,
  exceedsThreshold,
  estimateTextTokens,
  estimateToolsTokens,
  messageKeepTokenBudget,
  createContextPressureState,
  resetPressureOnUsage,
  addPressureDelta,
  reducePressureDelta,
  hybridUsedTokens,
  type ContextPressureState,
} from './context-budget.js'
import {
  PrefireCache,
  isTwoPassPrefireEnabled,
  shouldStartPrefire,
} from './prefire.js'
import {
  DEFAULT_CONTEXT_POLICY,
  type ResolvedContextPolicy,
} from './context-policy.js'
import { estimateMessagesTokens, usageFillPercent } from './context-budget.js'
import type { LoopCompactReason, LoopPrefireOutcome } from './loop-events.js'
// note: SUBAGENT compact budget is applied by callers via GraphCtx or buildGraph(maxSteps, budget)
import { applySlidingWindow } from './context/sliding-window.js'
import { isMicroCompactionEnabled, MicroCompaction } from './micro-compaction.js'
import type { HookRegistry } from './hooks/registry.js'
import type { ToolOutputStore } from './tool-output-store.js'
import type { GuardianReviewer } from './guardian.js'
import type { PlanMode } from './plan-mode.js'
import type { CircuitBreaker } from '../orchestrator/circuit-breaker.js'
import { emitLoopSignal, type LoopEventSink } from './loop-events.js'
// decideReplan only — do not import planner PlanMode (collides with plan-mode.PlanMode).
import { decideReplan, TurnReplanGuard, REPLAN_ERROR_THRESHOLD } from './planner.js'

function fullPlanReminder(planFilePath: string): string {
  return `Plan mode is active. You MUST NOT make any edits (with the exception of the current plan file) or otherwise make changes to the system unless a tool request is explicitly approved. Prefer read-only tools. Use Bash only for read operations — do not write/modify files via shell commands. This supersedes any other instructions you have received.

Workflow:
1. Understand — explore the codebase with Glob, Grep, Read.
2. Design — converge on the best approach.
3. Write Plan — modify the plan file with Write or Edit (narrative Markdown: context, approach, key files).
4. Call write_todos — with structured plan items for execution tracking.
5. Exit — call ExitPlanMode for user approval.

For implementation plans, prefer BOTH the narrative plan file AND write_todos before ExitPlanMode. Do not rush ExitPlanMode without plan content. Pure research/analysis that only needs a written answer should not use plan mode / ExitPlanMode.

Your turn must end with either AskUserQuestion (to clarify requirements) or ExitPlanMode (to request plan approval).
Plan file: ${planFilePath}`
}

function sparsePlanReminder(planFilePath: string): string {
  return `Plan mode still active (see full instructions earlier). Prefer read-only tools except the current plan file. Use Bash only for read operations. End turns with AskUserQuestion or ExitPlanMode.
Plan file: ${planFilePath}`
}

function reentryPlanReminder(planFilePath: string): string {
  return `Plan mode is active. A plan file already exists. Before proceeding:
1. Read the existing plan file to understand what was previously planned.
2. Evaluate the user's current request against that plan.
3. Update the plan file as needed.
4. Call write_todos with updated plan items.
5. Call ExitPlanMode for user approval.
Plan file: ${planFilePath}`
}

/** Injected when the model tries to finish while planStatus is still generating. */
const PLAN_EXIT_NUDGE = `Plan mode is still active — you must NOT deliver a final answer yet.

Required next steps:
1. Prefer BOTH: write a narrative plan to the plan file (Write/Edit) AND call write_todos with structured steps. Do not rush ExitPlanMode without plan content.
2. Call ExitPlanMode so the user can approve before any non-plan work.

Do this now. Do not answer the user request until ExitPlanMode has been called.`

/** Max times we re-prompt before auto-submitting an existing plan (or allowing END). */
const PLAN_EXIT_NUDGE_MAX = 1

/** Streaming sinks the graph emits through (wired to the WS layer in session.ts). */
export interface GraphEmit {
  token(delta: string): void
  reasoning(delta: string): void
  toolStarted(name: string, callId: string, input: unknown): void
  toolFinished(callId: string, status: 'finished' | 'error', output?: string, error?: string): void
  usage(u: TurnUsage): void
  planDelta(itemId: string, delta: string): void
  /** Optional: emit when write_todos replaces the structured plan (UI sticky checklist). */
  planUpdated?(plan: PlanItem[]): void
  compaction(
    summary: string,
    meta?: {
      replacedMessageIds?: string[]
      reason?: import('./loop-events.js').LoopCompactReason
      used?: number
      window?: number
      fillPercent?: number
      mode?: string
      prefire?: import('./loop-events.js').LoopPrefireOutcome
    },
  ): void
  /** Optional: signal that work is still progressing (keeps idle watchdog alive during long tools). */
  activity?(): void
  /**
   * Optional loop lifecycle sink (Track E / K16).
   * A/E call via `ctx.emit.loopSignal?.(e)` — **not** on GraphCtx.
   * Sync, best-effort; implementations must not throw.
   */
  loopSignal?: LoopEventSink
}

/** Per-turn context passed via config.configurable.ctx (keeps the compiled graph reusable). */
export interface GraphCtx {
  runner: ModelRunner
  tools: StructuredToolInterface[]
  emit: GraphEmit
  summarizer: Summarizer
  hooks?: HookRegistry
  sessionId: string
  /** Optional frame fields forwarded into HookContext via ToolRunner. */
  turnId?: string
  runId?: string
  nodeId?: string
  agentId?: string
  parentAgentId?: string
  toolOutputStore?: ToolOutputStore
  guardianReviewer?: GuardianReviewer
  toolRunner?: ToolRunner
  toolPolicy?: ToolPolicy
  approvalCache?: ApprovalCache
  requestApproval?: ApprovalFn
  permissionMode?: PermissionMode
  allowedTools?: string[]
  blockedTools?: string[]
  systemPrompt?: string
  activeProfileId?: string
  toolParallelism?: number
  /** Per-activity step cap. When provided, overrides the `maxSteps` passed to `buildGraph`. */
  maxSteps?: number
  /**
   * Model context window in tokens. Used with `compactThresholdPercent` when
   * `compactBudgetTokens` is not set. Defaults to 128k.
   */
  contextWindowTokens?: number
  /**
   * Absolute token trigger for auto-compact. When set, overrides the percentage
   * gate (tests and forced budgets). When omitted, uses
   * `contextWindowTokens * compactThresholdPercent / 100`.
   */
  compactBudgetTokens?: number
  /** Auto-compact threshold as % of context window (default 85). */
  compactThresholdPercent?: number
  /**
   * Last model call's prompt / input token count (from provider usage).
   * When set, gates use max(estimate, lastPromptTokens) (and hybrid when on).
   */
  lastPromptTokens?: number
  /**
   * Mid-turn hybrid pressure (KD-13 / PR-3). Per graph invoke.
   * Seeded from lastPromptTokens; updated on usage + tool results.
   */
  contextPressure?: ContextPressureState
  /**
   * Optional keep-tail token budget (message body). When omitted, derived from
   * contextWindowTokens × TARGET_THRESHOLD_PERCENT minus system/tools overhead.
   */
  targetKeepTokens?: number
  /** Goal/todos/verify block forced into LLM compact summaries. */
  protectedStructures?: string
  /**
   * Best-effort hook before LLM history compaction (e.g. memory flush).
   * Must not throw; errors are swallowed by the compact node.
   */
  beforeLlmCompact?: () => Promise<void>
  /**
   * Two-pass prefire cache (NOTE₁). Shared across compactNode visits in one
   * invoke. Created lazily when two-pass is enabled.
   */
  prefire?: PrefireCache
  /** Resolved [context] policy from hip.toml + env. */
  contextPolicy?: ResolvedContextPolicy
  planMode?: PlanMode
  /**
   * @experimental Test / harness only. Product session-turn paths never inject.
   * Optional circuit breaker for stalled-loop / budget experiments. Prefer doom /
   * error-streak / MAX_STEPS for product loop safety.
   */
  circuitBreaker?: CircuitBreaker
  /**
   * Doom-loop strategy from `HipConfig.agentLoop.doomLoopStrategy`.
   * When omitted, defaults to `nudge_then_pause` (current behavior).
   */
  doomLoopStrategy?: DoomLoopStrategy
  /**
   * Turn-local replan guard (max 1 replan per graph invoke).
   * Created once per invoke if missing; not LangGraph state.
   */
  replanGuard?: TurnReplanGuard
  /**
   * Model used by `runner` for this invoke — must match `resolveModelChoice` /
   * `buildModel` at construction time so usage.modelId is capture-honest.
   * When omitted, capture falls back to process-global `getActiveModel()`.
   */
  modelId?: string
  providerId?: string
}

/** sessionId + turnId fields shared by every LoopEvent (turnId may be unset on GraphCtx). */
function loopIds(ctx: GraphCtx): { sessionId: string; turnId: string } {
  return { sessionId: ctx.sessionId, turnId: ctx.turnId ?? '' }
}

const LoopState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: messagesStateReducer, default: () => [] }),
  steps: Annotation<number>({ reducer: (_prev, next) => next, default: () => 0 }),
  recentSigs: Annotation<string[]>({ reducer: (_prev, next) => next, default: () => [] }),
  /** History of pathHitKey() values for path-thrash detection (LoopGuard v2). */
  pathHits: Annotation<string[]>({ reducer: (_prev, next) => next, default: () => [] }),
  nudgedSig: Annotation<string | undefined>({ reducer: (_prev, next) => next, default: () => undefined }),
  status: Annotation<'running' | 'awaiting_user'>({ reducer: (_prev, next) => next, default: () => 'running' }),
  pendingQuestion: Annotation<string | undefined>({ reducer: (_prev, next) => next, default: () => undefined }),
  planningMode: Annotation<'fast' | 'plan'>({ reducer: (_prev, next) => next, default: () => 'fast' }),
  planStatus: Annotation<'none' | 'generating' | 'ready' | 'approved' | 'rejected'>({ reducer: (_prev, next) => next, default: () => 'none' }),
  plan: Annotation<PlanItem[] | undefined>({ reducer: (_prev, next) => next, default: () => undefined }),
  verifyMemo: Annotation<string | undefined>({ reducer: (_prev, next) => next, default: () => undefined }),
  compacted: Annotation<boolean>({ reducer: (_prev, next) => next, default: () => false }),
  deferredMessages: Annotation<BaseMessage[]>({ reducer: (prev, next) => [...(Array.isArray(prev) ? prev : []), ...(Array.isArray(next) ? next : [])], default: () => [] }),
  planStepsSinceInjection: Annotation<number>({ reducer: (_prev, next) => next, default: () => 0 }),
  /** How many times we nudged the model to ExitPlanMode while planStatus=generating. */
  planExitNudgeCount: Annotation<number>({ reducer: (_prev, next) => next, default: () => 0 }),
  /**
   * Steps since the last LLM summary compaction. Defaults to MIN so the first
   * over-budget compact is allowed immediately; reset to 0 after each LLM compact.
   * Micro-prune is not gated on this counter.
   */
  stepsSinceLastLlmCompact: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => MIN_STEPS_BETWEEN_LLM_COMPACT,
  }),
})

type State = typeof LoopState.State
export type LoopState = State

function ctxOf(config: LangGraphRunnableConfig): GraphCtx {
  const ctx = (config.configurable as { ctx?: GraphCtx } | undefined)?.ctx
  if (!ctx) throw new Error('graph invoked without configurable.ctx')
  return ctx
}

/** Turn-local guard: create once per GraphCtx if the caller did not inject one. */
function getReplanGuard(ctx: GraphCtx): TurnReplanGuard {
  if (!ctx.replanGuard) ctx.replanGuard = new TurnReplanGuard()
  return ctx.replanGuard
}

/** Tool results from the most recent AI→tools batch (walks back until AIMessage). */
function collectRecentToolContents(state: State): string[] {
  const out: string[] = []
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const m = state.messages[i]
    if (m instanceof ToolMessage) out.unshift(String(m.content))
    else if (m instanceof AIMessage) break
  }
  return out
}

/** Scan the last AIMessage's tool_calls and return IDs without a matching ToolMessage in the message history. */
export function getPendingToolCallIds(messages: BaseMessage[]): Set<string> {
  const lastAi = messages.filter((m): m is AIMessage => m instanceof AIMessage).at(-1)
  if (!lastAi || !lastAi.tool_calls?.length) return new Set()
  const resolvedIds = new Set(
    messages.filter((m): m is ToolMessage => m instanceof ToolMessage).map((m) => m.tool_call_id),
  )
  return new Set(lastAi.tool_calls.map((c) => c.id ?? c.name).filter((id) => !resolvedIds.has(id)))
}

/** Flush orphaned deferred messages (tool results that never arrived) with an error annotation. */
export function resolveDeferred(state: State): Partial<State> {
  const deferred = state.deferredMessages ?? []
  if (!deferred.length) return { deferredMessages: deferred }
  const resolvedIds = new Set(
    state.messages.filter((m): m is ToolMessage => m instanceof ToolMessage).map((m) => m.tool_call_id),
  )
  const orphaned = deferred.filter((m) => {
    if (!(m instanceof ToolMessage)) return false
    // Skip pending placeholders — they are still waiting for results
    if (typeof m.content === 'string' && m.content.startsWith('[Deferred: pending]')) return false
    return !resolvedIds.has(m.tool_call_id)
  })
  // Keep non-orphaned entries (resolved or still-pending) for next cycle
  const keep = deferred.filter((m) => !orphaned.includes(m))
  if (!orphaned.length) return { deferredMessages: keep }
  // Mark orphans with error annotation and flush them as ToolMessages
  const flushed = orphaned.map(
    (m) =>
      new ToolMessage({
        content: `[Deferred: tool result never arrived] ${typeof m.content === 'string' ? m.content : ''}`,
        tool_call_id: (m as ToolMessage).tool_call_id,
        name: (m as ToolMessage).name ?? 'unknown',
      }),
  )
  return { messages: flushed, deferredMessages: keep }
}

function applyCompaction(stateMessages: BaseMessage[], result: CompactResult): BaseMessage[] {
  return applyCompactResult(stateMessages, result)
}

function policyOf(ctx: GraphCtx): ResolvedContextPolicy {
  return ctx.contextPolicy ?? DEFAULT_CONTEXT_POLICY
}

/** Lazy-init hybrid pressure; seed from lastPromptTokens when first needed. */
function ensurePressure(ctx: GraphCtx): ContextPressureState {
  if (!ctx.contextPressure) {
    ctx.contextPressure = createContextPressureState({
      lastProviderContextTokens: ctx.lastPromptTokens ?? 0,
    })
  }
  return ctx.contextPressure
}

/** Resolve whether the prompt is over the compact budget for this invoke. */
function isOverCompactBudget(
  working: BaseMessage[],
  ctx: GraphCtx,
  fallbackAbsoluteBudget: number,
): boolean {
  const used = estimateUsedForGate(working, ctx)

  // Explicit absolute budget (tests, buildGraph second arg, forced overrides).
  if (ctx.compactBudgetTokens != null && ctx.compactBudgetTokens > 0) {
    return used > ctx.compactBudgetTokens
  }
  // Percentage of model context window (product path).
  if (ctx.contextWindowTokens != null && ctx.contextWindowTokens > 0) {
    const pct =
      ctx.compactThresholdPercent ??
      policyOf(ctx).autoCompactPercent ??
      AUTO_COMPACT_THRESHOLD_PERCENT
    return exceedsThreshold(used, ctx.contextWindowTokens, pct)
  }
  // Fallback: absolute budget from buildGraph(maxSteps, compactBudget).
  return used > fallbackAbsoluteBudget
}

/** Derive message-tail keep budget for compactMessages (product path only). */
function resolveTargetKeepTokens(ctx: GraphCtx): number | undefined {
  if (ctx.targetKeepTokens != null && ctx.targetKeepTokens > 0) return ctx.targetKeepTokens
  // Absolute forced budgets (tests / harness) keep classic turn counts.
  if (ctx.compactBudgetTokens != null && ctx.compactBudgetTokens > 0) return undefined
  // Only size the keep-tail from a real model window on the product path.
  if (ctx.contextWindowTokens == null || ctx.contextWindowTokens <= 0) return undefined
  const tools = (ctx.tools ?? []).map((t) => ({
    name: t.name,
    description: typeof t.description === 'string' ? t.description : undefined,
  }))
  const overhead =
    estimateTextTokens(ctx.systemPrompt ?? '') + estimateToolsTokens(tools)
  const keepPct = policyOf(ctx).targetKeepPercent ?? TARGET_THRESHOLD_PERCENT
  return messageKeepTokenBudget(ctx.contextWindowTokens, overhead, keepPct)
}

function ensurePrefire(ctx: GraphCtx): PrefireCache | null {
  const pol = policyOf(ctx)
  if (!pol.twoPass || !isTwoPassPrefireEnabled()) return null
  if (!ctx.prefire) ctx.prefire = new PrefireCache()
  return ctx.prefire
}

function emitCompactObs(
  ctx: GraphCtx,
  payload: {
    reason: LoopCompactReason
    used?: number
    window?: number
    mode?: 'user-turn' | 'tool-round' | 'sliding_window' | 'prune'
    prefire?: LoopPrefireOutcome
    tokensBefore?: number
    tokensAfter?: number
    hybrid?: boolean
    throttled?: boolean
  },
): void {
  const window = payload.window ?? ctx.contextWindowTokens
  const used = payload.used
  const fillPercent =
    used != null && window != null && window > 0 ? usageFillPercent(used, window) : undefined
  const hybrid = payload.hybrid ?? policyOf(ctx).hybridFill
  emitLoopSignal(ctx.emit.loopSignal, {
    type: 'loop.compact',
    ...loopIds(ctx),
    reason: payload.reason,
    ...(used != null ? { used } : {}),
    ...(window != null ? { window } : {}),
    ...(fillPercent != null ? { fillPercent } : {}),
    ...(payload.mode ? { mode: payload.mode } : {}),
    ...(payload.prefire ? { prefire: payload.prefire } : {}),
    ...(payload.tokensBefore != null ? { tokensBefore: payload.tokensBefore } : {}),
    ...(payload.tokensAfter != null ? { tokensAfter: payload.tokensAfter } : {}),
    ...(hybrid ? { hybrid: true } : {}),
    ...(payload.throttled ? { throttled: true } : {}),
  })
}

/** Used-token estimate for prefire / compact gates (hybrid when enabled). */
function estimateUsedForGate(
  working: BaseMessage[],
  ctx: GraphCtx,
): number {
  const tools = (ctx.tools ?? []).map((t) => ({
    name: t.name,
    description: typeof t.description === 'string' ? t.description : undefined,
  }))
  const fullEstimate = estimatePromptTokens({
    messages: working,
    systemPrompt: ctx.systemPrompt,
    tools,
  })
  return hybridUsedTokens(
    fullEstimate,
    ensurePressure(ctx),
    policyOf(ctx).hybridFill,
    ctx.lastPromptTokens,
  )
}

/** Kick off background pass-1 when approaching the compact threshold (or throttled over-budget). */
function maybeStartPrefire(
  working: BaseMessage[],
  ctx: GraphCtx,
  compactBudget: number,
  opts?: { allowOverBudget?: boolean },
): void {
  const cache = ensurePrefire(ctx)
  if (!cache) return

  const used = estimateUsedForGate(working, ctx)
  let window = ctx.contextWindowTokens ?? 0
  const pol = policyOf(ctx)
  let thresholdPct =
    ctx.compactThresholdPercent ?? pol.autoCompactPercent ?? AUTO_COMPACT_THRESHOLD_PERCENT
  const lead = pol.prefireLeadPercent

  if (ctx.compactBudgetTokens != null && ctx.compactBudgetTokens > 0) {
    window = Math.max(ctx.compactBudgetTokens, 1)
    thresholdPct = 100
  } else if (window <= 0) {
    // Fallback absolute path from buildGraph second arg
    window = Math.max(compactBudget, 1)
    thresholdPct = 100
  }

  if (
    !shouldStartPrefire(used, window, thresholdPct, lead, {
      allowOverBudget: opts?.allowOverBudget === true,
    })
  ) {
    return
  }

  const targetKeep = resolveTargetKeepTokens(ctx)
  const plan = selectCompactMiddle(working, {
    keepRecentTurns: KEEP_RECENT_TURNS,
    ...(targetKeep != null ? { targetKeepTokens: targetKeep } : {}),
  })
  if (!plan) return
  const outcome = cache.startPass1(plan.middle, ctx.summarizer, { sessionId: ctx.sessionId })
  emitLoopSignal(ctx.emit.loopSignal, {
    type: 'loop.prefire',
    ...loopIds(ctx),
    outcome: outcome as LoopPrefireOutcome,
    used,
    window,
    fillPercent: usageFillPercent(used, window),
    ...(opts?.allowOverBudget ? { throttled: true } : {}),
  })
  if (outcome === 'started') {
    try {
      ctx.emit.compaction('[prefire] pass-1 started')
    } catch {
      // best-effort
    }
  }
}

/** Build the agent-loop graph. `maxSteps` and `compactBudget` are injectable for tests. */
export function buildGraph(maxSteps: number = MAX_STEPS, compactBudget: number = COMPACT_BUDGET_TOKENS) {
  /**
   * Pre-model compaction each graph cycle:
   * 1) Prune old tool bodies (default on) — cheap, runs every step even after LLM compact
   * 2) Sliding window when message count is high (multi-turn)
   * 3) LLM summary when over token budget (user-turn or tool-round fallback),
   *    throttled by MIN_STEPS_BETWEEN_LLM_COMPACT
   */
  async function compactNode(state: State, config: LangGraphRunnableConfig): Promise<Partial<State>> {
    const deferredResolved = resolveDeferred(state)
    const ctx = ctxOf(config)
    const out: BaseMessage[] = [...(deferredResolved.messages ?? [])]
    let working = state.messages
    let stepsSince = state.stepsSinceLastLlmCompact ?? MIN_STEPS_BETWEEN_LLM_COMPACT

    // 1) Cheap prune of stale tool results (default on; not gated on state.compacted).
    if (isMicroCompactionEnabled()) {
      const mc = new MicroCompaction()
      const { messages: mcMessages, truncated } = mc.compact(working)
      if (truncated > 0) {
        let freed = 0
        for (let i = 0; i < working.length; i++) {
          if (mcMessages[i] !== working[i]) {
            const orig = working[i]
            freed += Math.max(
              0,
              estimateMessagesTokens([orig]) - estimateMessagesTokens([mcMessages[i]]),
            )
            if (orig.id) out.push(new RemoveMessage({ id: orig.id }))
            out.push(mcMessages[i])
          }
        }
        // Shrink mid-turn delta only — never re-add full messages into delta (KD-13).
        if (freed > 0) reducePressureDelta(ensurePressure(ctx), freed)
        working = mcMessages
        try {
          ctx.emit.compaction(`Pruned ${truncated} stale tool result(s)`, { reason: 'prune' })
        } catch {
          // best-effort
        }
        emitCompactObs(ctx, { reason: 'prune', mode: 'prune' })
      }
    }

    // 2) Sliding window — multi-Human-turn conversations primarily.
    const windowResult = applySlidingWindow(working)
    if (windowResult.removed.length > 0) {
      const beforeTok = estimateMessagesTokens(windowResult.removed) + estimateMessagesTokens(windowResult.kept)
      const summary = await ctx.summarizer.summarize(windowResult.removed, { sessionId: ctx.sessionId })
      const summaryMsg = new SystemMessage(`[Earlier conversation summary]\n${summary}`)
      ctx.emit.compaction(`Sliding window: ${windowResult.removed.length} messages summarized`, {
        reason: 'sliding_window',
        mode: 'sliding_window',
      })
      const afterTok = estimateMessagesTokens([summaryMsg, ...windowResult.kept])
      emitCompactObs(ctx, {
        reason: 'sliding_window',
        mode: 'sliding_window',
        tokensBefore: beforeTok,
        tokensAfter: afterTok,
      })
      return {
        messages: [...out, summaryMsg, ...windowResult.kept],
        compacted: true,
        stepsSinceLastLlmCompact: 0,
        deferredMessages: deferredResolved.deferredMessages,
      }
    }

    // 3) Token-budget LLM compact (user-turn or tool-round). Throttled between LLM passes.
    const overBudget = isOverCompactBudget(working, ctx, compactBudget)
    const canLlmCompact = stepsSince >= MIN_STEPS_BETWEEN_LLM_COMPACT
    const throttled = overBudget && !canLlmCompact

    // Prefire when approaching band, or when over-budget but LLM compact is throttled (KD-16).
    // Skip only when we are about to run LLM compact on this visit.
    if (!overBudget || !canLlmCompact) {
      maybeStartPrefire(working, ctx, compactBudget, {
        allowOverBudget: throttled,
      })
    }

    if (!overBudget || !canLlmCompact) {
      // Always tick the counter so we eventually re-enable LLM compact after a prior one.
      // Throttled over-budget is visible via loop.prefire { throttled: true } (KD-16).
      const nextSteps = stepsSince + 1
      if (out.length === 0) {
        return {
          ...deferredResolved,
          stepsSinceLastLlmCompact: nextSteps,
        }
      }
      return {
        messages: out,
        deferredMessages: deferredResolved.deferredMessages,
        stepsSinceLastLlmCompact: nextSteps,
      }
    }

    // Memory flush (best-effort) before we destroy the middle span.
    if (ctx.beforeLlmCompact) {
      try {
        await ctx.beforeLlmCompact()
      } catch {
        // never block compact
      }
    }

    const targetKeep = resolveTargetKeepTokens(ctx)
    const prefire = ensurePrefire(ctx)
    const usedBefore = estimateUsedForGate(working, ctx)
    const tokensBefore = estimateMessagesTokens(working)
    // Peek prefire validity without consuming (match only peeks when middle is non-empty).
    const plannedMiddle = selectCompactMiddle(working, {
      keepRecentTurns: KEEP_RECENT_TURNS,
      ...(targetKeep != null ? { targetKeepTokens: targetKeep } : {}),
    })?.middle
    let prefireOutcome: LoopPrefireOutcome = 'miss'
    if (prefire && plannedMiddle && plannedMiddle.length > 0) {
      // Snapshot fingerprint path: if note exists and prefix matches, classify hit/pass2.
      // compactMessages will call match again (idempotent when valid).
      const peek = prefire.match(plannedMiddle)
      if (peek) {
        prefireOutcome = peek.delta.length > 0 ? 'pass2' : 'hit'
        // Re-seed note after peek match? match does not clear on success.
      } else if (prefire.note1) {
        prefireOutcome = 'miss'
      }
    }
    const result = await compactMessages(working, {
      keepRecentTurns: KEEP_RECENT_TURNS,
      summarizer: ctx.summarizer,
      sessionId: ctx.sessionId,
      ...(targetKeep != null ? { targetKeepTokens: targetKeep } : {}),
      ...(prefire ? { prefire } : {}),
      ...(ctx.protectedStructures ? { protectedStructures: ctx.protectedStructures } : {}),
    })
    // Consumed NOTE₁ — clear so the next cycle does not reuse a stale note.
    prefire?.clear()
    if (!result) {
      if (out.length === 0) {
        return { ...deferredResolved, stepsSinceLastLlmCompact: stepsSince + 1 }
      }
      return {
        messages: out,
        deferredMessages: deferredResolved.deferredMessages,
        stepsSinceLastLlmCompact: stepsSince + 1,
      }
    }
    const summaryText = typeof result.summary.content === 'string' ? result.summary.content : ''
    const mode = result.mode ?? 'user-turn'
    const tokensAfter = estimateMessagesTokens([
      result.summary,
      ...working.filter((m) => !result.replacedIds.includes(m.id ?? '')),
    ])
    ctx.emit.compaction(`[${mode}] ${summaryText}`, {
      replacedMessageIds: result.replacedIds,
      reason: 'budget',
      used: usedBefore,
      window: ctx.contextWindowTokens,
      fillPercent:
        ctx.contextWindowTokens && ctx.contextWindowTokens > 0
          ? usageFillPercent(usedBefore, ctx.contextWindowTokens)
          : undefined,
      mode,
      prefire: prefireOutcome,
    })
    emitCompactObs(ctx, {
      reason: 'budget',
      used: usedBefore,
      window: ctx.contextWindowTokens,
      mode,
      prefire: prefireOutcome,
      tokensBefore,
      tokensAfter,
    })
    // Post-compact: reset hybrid pressure from full re-estimate; clear delta (KD-13).
    {
      const kept = working.filter((m) => !result.replacedIds.includes(m.id ?? ''))
      const afterMsgs = [result.summary, ...kept]
      const afterEst = estimatePromptTokens({
        messages: afterMsgs,
        systemPrompt: ctx.systemPrompt,
        tools: (ctx.tools ?? []).map((t) => ({
          name: t.name,
          description: typeof t.description === 'string' ? t.description : undefined,
        })),
      })
      resetPressureOnUsage(ensurePressure(ctx), afterEst, afterMsgs.length)
      ctx.lastPromptTokens = afterEst
    }
    return {
      messages: [
        ...out,
        result.summary,
        ...result.removeIds.map((id) => new RemoveMessage({ id })),
      ],
      compacted: true,
      stepsSinceLastLlmCompact: 0,
      deferredMessages: deferredResolved.deferredMessages,
    }
  }

  async function agent(state: State, config: LangGraphRunnableConfig): Promise<Partial<State>> {
    const deferredResolved = resolveDeferred(state)
    const ctx = ctxOf(config)
    const { runner, tools, emit, systemPrompt } = ctx
    const stepCap = ctx.maxSteps ?? maxSteps
    const capped = state.steps >= stepCap - 1

    // Determine plan-mode reminder (if any) — computed once so both execution
    // paths use the same reminder and counter.
    let planReminder: string | null = null
    let planStepsSinceInjection = state.planStepsSinceInjection
    if (state.planningMode === 'plan' && ctx.planMode?.isActive) {
      const planFilePath = ctx.planMode.planFilePath ?? 'not set'
      const counter = state.planStepsSinceInjection
      if (counter === 0) {
        const existingContent = await ctx.planMode.readPlan()
        if (existingContent.trim().length > 0) {
          planReminder = reentryPlanReminder(planFilePath)
        } else {
          planReminder = fullPlanReminder(planFilePath)
        }
      } else if (counter % 5 === 0) {
        planReminder = fullPlanReminder(planFilePath)
      } else if (counter % 2 === 0) {
        planReminder = sparsePlanReminder(planFilePath)
      }
      if (planReminder) {
        planStepsSinceInjection = counter + 1
      }
    }

    function prepareMessages(list: BaseMessage[]): BaseMessage[] {
      const next = [...list]
      if (systemPrompt !== undefined) {
        if (next[0] instanceof SystemMessage) {
          next[0] = new SystemMessage(systemPrompt)
        } else {
          next.unshift(new SystemMessage(systemPrompt))
        }
      }
      if (planReminder) {
        next.unshift(new SystemMessage(planReminder))
      }
      return next
    }

    async function runModel(input: BaseMessage[]): Promise<AIMessage> {
      return runner.run(input, {
        tools,
        bindTools: !capped,
        signal: config.signal,
        callbacks: config.callbacks,
        metadata: config.metadata as Record<string, unknown> | undefined,
        tags: config.tags,
        runName: 'hip.model',
        onText: (d) => emit.token(d),
        onReasoning: (d) => emit.reasoning(d),
        onActivity: () => emit.activity?.(),
      })
    }

    async function execute(input: BaseMessage[]): Promise<Partial<State>> {
      const msg = await runModel(input)
      // MiniMax (and some OpenAI-compat hosts) stream usage with input_tokens=0.
      // Fall back to chars/4 over the prepared prompt so context fill % stays honest.
      const estimated = estimatePromptTokens({
        messages: input,
        tools: tools.map((t) => ({ name: t.name, description: t.description })),
      })
      // Prefer GraphCtx stamp (same resolveModelChoice as buildModel); fallback active.
      const active = getActiveModel()
      const turnUsage = usageFromModelMetadata(msg.usage_metadata, estimated, {
        modelId: ctx.modelId ?? active.modelID,
        providerId: ctx.providerId ?? active.providerID,
      })
      if (turnUsage) {
        emit.usage(turnUsage)
        // Keep gate honest for subsequent compactNode cycles in this invoke.
        const prompt = turnUsage.contextTokens ?? turnUsage.inputTokens
        if (prompt > 0) {
          ctx.lastPromptTokens = prompt
          // Provider baseline + clear mid-turn delta; watermark includes this AI message.
          resetPressureOnUsage(
            ensurePressure(ctx),
            prompt,
            (state.messages?.length ?? 0) + 1,
          )
        }
      }
      return { messages: [msg], steps: state.steps + 1 }
    }

    const messages = prepareMessages(state.messages)
    try {
      const result = await execute(messages)

      // Circuit breaker check
      if (ctx.circuitBreaker) {
        const lastMsg = result.messages?.[result.messages.length - 1]
        if (lastMsg instanceof AIMessage) {
          const usage = lastMsg.usage_metadata
          const tokensUsed = (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0)
          const hadFileWrite = lastMsg.tool_calls?.some(
            (tc) => tc.name === 'write_file' || tc.name === 'edit_file',
          ) ?? false
          const decision = ctx.circuitBreaker.step(tokensUsed, hadFileWrite)
          if (decision.action === 'terminate') {
            emitLoopSignal(emit.loopSignal, {
              type: 'loop.end',
              ...loopIds(ctx),
              reason: 'circuit_breaker',
            })
            return {
              messages: [new AIMessage(`CIRCUIT BREAKER TRIPPED: ${decision.reason}\n\nTerminating execution.`)],
              steps: state.steps + 1,
              status: 'awaiting_user' as const,
              deferredMessages: deferredResolved.deferredMessages,
              planStepsSinceInjection,
            }
          }
          if (decision.action === 'warn') {
            state.messages.push(new SystemMessage(`⚠️ ${decision.reason}`))
          }
        }
      }

      return {
        ...result,
        messages: [...(deferredResolved.messages ?? []), ...(result.messages ?? [])],
        deferredMessages: deferredResolved.deferredMessages,
        planStepsSinceInjection,
      }
    } catch (err) {
      if (state.compacted || !isOverflowError(err)) throw err
      if (ctx.beforeLlmCompact) {
        try {
          await ctx.beforeLlmCompact()
        } catch {
          // best-effort
        }
      }

      const runOverflowCompact = async (
        workingMsgs: BaseMessage[],
        reason: LoopCompactReason,
        keepTurns: number,
        keepRounds: number,
        targetKeep?: number,
      ) => {
        const prefire = ensurePrefire(ctx)
        const result = await compactMessages(workingMsgs, {
          keepRecentTurns: keepTurns,
          keepRecentToolRounds: keepRounds,
          summarizer: ctx.summarizer,
          overflowRecovery: true,
          sessionId: ctx.sessionId,
          ...(targetKeep != null ? { targetKeepTokens: targetKeep } : {}),
          ...(prefire ? { prefire } : {}),
          ...(ctx.protectedStructures ? { protectedStructures: ctx.protectedStructures } : {}),
        })
        prefire?.clear()
        if (!result) return null
        const summaryText = typeof result.summary.content === 'string' ? result.summary.content : ''
        const mode = result.mode ?? 'user-turn'
        emit.compaction(summaryText, {
          replacedMessageIds: result.replacedIds,
          reason,
          mode,
        })
        emitCompactObs(ctx, {
          reason,
          mode,
          used: estimateUsedForGate(workingMsgs, ctx),
          window: ctx.contextWindowTokens,
          tokensBefore: estimateMessagesTokens(workingMsgs),
          // Overflow recovery counter surface for baseline compare (PR-3 / P0b).
          hybrid: policyOf(ctx).hybridFill,
        })
        return result
      }

      const targetKeep = resolveTargetKeepTokens(ctx)
      const halfKeep =
        targetKeep != null ? Math.max(500, Math.floor(targetKeep / 2)) : undefined

      // Pass 1: standard overflow recovery compact.
      let result = await runOverflowCompact(
        messages,
        'overflow',
        KEEP_RECENT_TURNS,
        3,
        halfKeep,
      )

      // Pass 2 (secondary): aggressive prune + tighter keep if first compact failed
      // or if we need an even smaller prompt for the retry.
      if (!result) {
        let secondary = [...state.messages]
        if (isMicroCompactionEnabled()) {
          const mc = new MicroCompaction({ keepRecent: 8 })
          secondary = mc.compact(secondary).messages
        }
        result = await runOverflowCompact(secondary, 'overflow_secondary', 1, 2, halfKeep != null ? Math.floor(halfKeep / 2) : undefined)
        if (result) {
          // Apply micro-prune removals are already in secondary content stubs;
          // compact plan is relative to secondary.
          const compactedState = applyCompaction(secondary, result)
          const retryMessages = prepareMessages(compactedState)
          try {
            const msgResult = await execute(retryMessages)
            const compactedMessages = [
              result.summary,
              ...result.removeIds.map((id) => new RemoveMessage({ id })),
            ]
            return {
              ...msgResult,
              messages: [
                ...(deferredResolved.messages ?? []),
                ...compactedMessages,
                ...(msgResult.messages ?? []),
              ],
              compacted: true,
              stepsSinceLastLlmCompact: 0,
              deferredMessages: deferredResolved.deferredMessages,
              planStepsSinceInjection,
            }
          } catch (err2) {
            if (!isOverflowError(err2)) throw err2
            throw err
          }
        }
        throw err
      }

      const compactedMessages = [result.summary, ...result.removeIds.map((id) => new RemoveMessage({ id }))]
      const compactedState = applyCompaction(state.messages, result)
      const retryMessages = prepareMessages(compactedState)
      try {
        const msgResult = await execute(retryMessages)
        return {
          ...msgResult,
          messages: [...(deferredResolved.messages ?? []), ...compactedMessages, ...(msgResult.messages ?? [])],
          compacted: true,
          stepsSinceLastLlmCompact: 0,
          deferredMessages: deferredResolved.deferredMessages,
          planStepsSinceInjection,
        }
      } catch (err2) {
        if (!isOverflowError(err2)) throw err2
        // Retry still overflowed — secondary pass on already-compacted state.
        let secondary = compactedState
        if (isMicroCompactionEnabled()) {
          secondary = new MicroCompaction({ keepRecent: 8 }).compact(secondary).messages
        }
        const result2 = await runOverflowCompact(secondary, 'overflow_secondary', 1, 2, halfKeep != null ? Math.floor(halfKeep / 2) : undefined)
        if (!result2) throw err
        const compacted2 = applyCompaction(secondary, result2)
        const retry2 = prepareMessages(compacted2)
        const msgResult = await execute(retry2)
        return {
          ...msgResult,
          messages: [
            ...(deferredResolved.messages ?? []),
            result.summary,
            ...result.removeIds.map((id) => new RemoveMessage({ id })),
            result2.summary,
            ...result2.removeIds.map((id) => new RemoveMessage({ id })),
            ...(msgResult.messages ?? []),
          ],
          compacted: true,
          stepsSinceLastLlmCompact: 0,
          deferredMessages: deferredResolved.deferredMessages,
          planStepsSinceInjection,
        }
      }
    }
  }

  function getOrCreateToolRunner(ctx: GraphCtx): ToolRunner {
    if (ctx.toolRunner) return ctx.toolRunner

    const byName = new Map(ctx.tools.map((t) => [t.name, t]))
    ctx.toolRunner = new ToolRunner({
      tools: byName,
      hooks: ctx.hooks,
      toolPolicy: ctx.toolPolicy ?? defaultToolPolicy({ selfGatedTools: SELF_GATED_TOOLS }),
      approvalCache: ctx.approvalCache ?? new SessionApprovalCache(),
      permissionMode: ctx.permissionMode ?? 'edit',
      requestApproval: ctx.requestApproval,
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      runId: ctx.runId,
      nodeId: ctx.nodeId,
      agentId: ctx.agentId,
      parentAgentId: ctx.parentAgentId,
      toolOutputStore: ctx.toolOutputStore,
      guardianReviewer: ctx.guardianReviewer,
      onToolStarted: (name, callId, input) => ctx.emit.toolStarted(name, callId, input),
      onToolFinished: (callId, status, output, error) => ctx.emit.toolFinished(callId, status, output, error),
      onActivity: () => ctx.emit.activity?.(),
    })
    return ctx.toolRunner
  }

  async function toolsNode(state: State, config: LangGraphRunnableConfig): Promise<Partial<State>> {
    const ctx = ctxOf(config)
    const runner = getOrCreateToolRunner(ctx)
    const last = state.messages[state.messages.length - 1] as AIMessage
    const blockedCalls: ToolMessage[] = []
    const calls: typeof last.tool_calls = []
    for (const call of last.tool_calls ?? []) {
      const resolvedName = resolveToolName(call.name)
      // Normalize aliases (bash→run_script) before profile / plan-mode gates.
      const normalized =
        resolvedName === call.name ? call : { ...call, name: resolvedName }
      const isMcp = resolvedName.startsWith('mcp__')
      if (ctx.allowedTools && ctx.allowedTools.length > 0 && !isMcp && !ctx.allowedTools.includes(resolvedName)) {
        console.warn(`Blocked tool call "${call.name}" by allowedTools profile filter`)
        blockedCalls.push(new ToolMessage({
          content: `Error: Tool "${call.name}" is not available in the current agent profile.`,
          tool_call_id: call.id ?? call.name,
          name: call.name,
        }))
        continue
      }
      if (ctx.blockedTools && ctx.blockedTools.length > 0 && ctx.blockedTools.includes(resolvedName)) {
        console.warn(`Blocked tool call "${call.name}" by blockedTools profile filter`)
        blockedCalls.push(new ToolMessage({
          content: `Error: Tool "${call.name}" is blocked in the current agent profile.`,
          tool_call_id: call.id ?? call.name,
          name: call.name,
        }))
        continue
      }
      if (ctx.planMode?.isActive && ctx.planMode.planFilePath) {
        if (resolvedName === 'write_file' || resolvedName === 'edit_file') {
          const targetPath = (normalized.args as Record<string, unknown>)?.path as string | undefined
          if (targetPath !== ctx.planMode.planFilePath) {
            blockedCalls.push(new ToolMessage({
              content: `Plan mode is active. Write/Edit is only allowed to the plan file: ${ctx.planMode.planFilePath}`,
              tool_call_id: call.id ?? call.name,
              name: call.name,
            }))
            continue
          }
        }
        if (resolvedName === 'git_commit' || resolvedName === 'run_script') {
          blockedCalls.push(new ToolMessage({
            content: `Plan mode is active. The "${resolvedName}" tool is not allowed during plan mode.`,
            tool_call_id: call.id ?? call.name,
            name: call.name,
          }))
          continue
        }
      }
      calls.push(normalized)
    }

    // LoopGuard v2: block path re-reads before invoke once PATH_HIT_LIMIT is reached.
    const pathHits = [...(state.pathHits ?? [])]
    const pathBlocked: ToolMessage[] = []
    const allowedCalls: typeof calls = []
    for (const call of calls) {
      const key = pathHitKey(call.name, call.args)
      if (key && countPathHits(pathHits, key) >= PATH_HIT_LIMIT - 1) {
        // This call would be the Nth hit — reject and record the hit for counting.
        pathHits.push(key)
        pathBlocked.push(new ToolMessage({
          content: PATH_REPEAT_MESSAGE,
          tool_call_id: call.id ?? call.name,
          name: call.name,
        }))
        continue
      }
      if (key) pathHits.push(key)
      allowedCalls.push(call)
    }
    // Replace calls with non-blocked; keep blocked in blockedCalls for the model.
    blockedCalls.push(...pathBlocked)
    calls.length = 0
    calls.push(...allowedCalls)

    const parallelism = ctx.toolParallelism ?? 5
    const delegateParallelism = resolveMaxConcurrency()
    const parallelIndices: number[] = []
    const delegateIndices: number[] = []
    const sequentialIndices: number[] = []
    for (let i = 0; i < calls.length; i++) {
      const name = calls[i].name
      if (READ_TOOLS.has(name)) {
        parallelIndices.push(i)
      } else if (DELEGATE_TOOLS.has(name)) {
        // Multiple task/dispatch_agent/task_batch in one model step run concurrently
        // (capped by HIP_SUBAGENT_MAX_CONCURRENCY). task_batch is itself parallel internally.
        delegateIndices.push(i)
      } else {
        sequentialIndices.push(i)
      }
    }

    const results: (ToolCallResult | undefined)[] = new Array(calls.length)

    const runOne = async (index: number): Promise<void> => {
      const call = calls[index]
      const id = call.id ?? call.name
      results[index] = await runner.runToolCall({
        name: call.name,
        callId: id,
        args: (call.args as Record<string, unknown>) ?? {},
        callbacks: config.callbacks,
      })
    }

    // Reads first (cheap, feed context), then parallel delegates, then writes/scripts serial.
    await runWithConcurrency(parallelIndices, parallelism, runOne)
    await runWithConcurrency(delegateIndices, delegateParallelism, runOne)

    for (const index of sequentialIndices) {
      await runOne(index)
    }

    const resolvedResults = results.filter((r): r is ToolCallResult => r !== undefined)
    const allResolved = resolvedResults.length === calls.length

    const out: ToolMessage[] = resolvedResults.map((result) => new ToolMessage({
      content: result.content,
      tool_call_id: result.tool_call_id,
      name: result.name,
    }))

    // Detect ExitPlanMode / EnterPlanMode results and set state accordingly
    let planStatus: State['planStatus'] | undefined
    let planningMode: State['planningMode'] | undefined
    for (let i = 0; i < calls.length; i++) {
      const call = calls[i]
      const result = results[i]
      if (!result) continue
      if (call.name === 'ExitPlanMode' && !result.content.startsWith('Error')) {
        planStatus = 'ready'
      }
      if (call.name === 'EnterPlanMode' && !result.content.startsWith('Error')) {
        planningMode = 'plan'
        planStatus = 'generating'
      }
    }

    const updatedPlan = deriveUpdatedPlan(state.plan, last.tool_calls ?? [])
    // Notify UI whenever write_todos produced a checklist (may fire multiple times per turn).
    const fromWriteTodos = planFromWriteTodos(last.tool_calls ?? [])
    if (fromWriteTodos) {
      try {
        ctx.emit.planUpdated?.(fromWriteTodos)
      } catch {
        // best-effort; never break the tools node
      }
    }

    const sig = sigOf(last.tool_calls ?? [])

    const planOverride = {
      ...(planStatus !== undefined ? { planStatus } : {}),
      ...(planningMode !== undefined ? { planningMode } : {}),
    }

    const pathHitState = { pathHits: pathHits.slice(-50) }

    // Hybrid mid-turn pressure: count only newly appended tool / blocked messages (KD-13).
    {
      const newMsgs: BaseMessage[] = [...blockedCalls, ...out]
      let delta = 0
      for (const m of newMsgs) delta += estimateMessagesTokens([m])
      if (delta > 0) addPressureDelta(ensurePressure(ctx), delta)
    }

    if (allResolved) {
      return {
        messages: [...blockedCalls, ...out],
        recentSigs: [...state.recentSigs, sig].slice(-SIG_WINDOW),
        plan: updatedPlan,
        ...pathHitState,
        ...planOverride,
      }
    }
    // Some tool calls did not resolve yet: show resolved results in messages,
    // include placeholder entries for all calls in deferredMessages for tracking.
    const unresolvedIds = new Set(
      calls.filter((_c, i) => results[i] === undefined).map((c) => c.id ?? c.name),
    )
    const deferredEntries: ToolMessage[] = [
      ...out,
      ...calls
        .filter((c) => unresolvedIds.has(c.id ?? c.name))
        .map((c) => new ToolMessage({
          content: '[Deferred: pending]',
          tool_call_id: c.id ?? c.name,
          name: c.name,
        })),
    ]
    return {
      messages: [...blockedCalls, ...out],
      deferredMessages: deferredEntries,
      recentSigs: [...state.recentSigs, sig].slice(-SIG_WINDOW),
      plan: updatedPlan,
      ...pathHitState,
      ...planOverride,
    }
  }

  /**
   * Corrective note after doom or error-streak.
   * Priority MUST match routeAfterTools: doom > error-streak, so nudgedSig
   * latches the same key the router uses for pause on the next identical batch.
   */
  function nudge(state: State, config: LangGraphRunnableConfig): Partial<State> {
    const ctx = ctxOf(config)
    const recentToolContents = collectRecentToolContents(state)
    const lastSig = state.recentSigs[state.recentSigs.length - 1]
    const isDoom =
      lastSig !== undefined && trailingRepeatCount(state.recentSigs, lastSig) >= DOOM_LOOP_N
    if (isDoom) {
      emitLoopSignal(ctx.emit.loopSignal, {
        type: 'loop.nudge',
        ...loopIds(ctx),
        reason: 'doom',
      })
      return { messages: [new SystemMessage(DOOM_LOOP_NUDGE)], nudgedSig: lastSig }
    }
    if (trailingErrorStreak(recentToolContents) >= ERROR_STREAK_LIMIT) {
      emitLoopSignal(ctx.emit.loopSignal, {
        type: 'loop.nudge',
        ...loopIds(ctx),
        reason: 'error_streak',
      })
      return { messages: [new SystemMessage(ERROR_STREAK_NUDGE)], nudgedSig: 'error-streak' }
    }
    // Fallback: doom-shaped nudge (route only sends us here for doom/streak).
    emitLoopSignal(ctx.emit.loopSignal, {
      type: 'loop.nudge',
      ...loopIds(ctx),
      reason: 'doom',
    })
    return { messages: [new SystemMessage(DOOM_LOOP_NUDGE)], nudgedSig: lastSig }
  }

  /**
   * Reactive replan (Track A): inject buildReplanPrompt once per turn.
   * Does NOT set nudgedSig — preserves error-streak machine for post-replan failures.
   */
  function replanNode(state: State, config: LangGraphRunnableConfig): Partial<State> {
    const ctx = ctxOf(config)
    const guard = getReplanGuard(ctx)
    const errors = harvestTrailingToolErrors(collectRecentToolContents(state))
    const decision = decideReplan(errors, guard)
    if (decision.replan && decision.prompt) {
      emitLoopSignal(ctx.emit.loopSignal, {
        type: 'loop.replan',
        ...loopIds(ctx),
        reason: decision.reason,
      })
      return { messages: [new SystemMessage(decision.prompt)] }
    }
    return {}
  }

  /** Stop the turn pending user input (Option Z: session.ts reads this and emits agent:interrupt). */
  function pause(state: State, config: LangGraphRunnableConfig): Partial<State> {
    const ctx = ctxOf(config)
    const question = PAUSE_QUESTION
    const lastSig = state.recentSigs[state.recentSigs.length - 1]
    const isDoomPause =
      lastSig !== undefined &&
      state.nudgedSig === lastSig &&
      trailingRepeatCount(state.recentSigs, lastSig) >= DOOM_LOOP_N
    emitLoopSignal(ctx.emit.loopSignal, {
      type: 'loop.pause',
      ...loopIds(ctx),
      question,
      ...(isDoomPause ? { kind: 'doom' as const } : {}),
    })
    return { status: 'awaiting_user', pendingQuestion: question }
  }

  function planPause(_state: State, config: LangGraphRunnableConfig): Partial<State> {
    const ctx = ctxOf(config)
    // Wire token only — FE sticky panel owns user-visible copy (D5 / KD-PA-3).
    const question = PLAN_APPROVAL_QUESTION_TOKEN
    emitLoopSignal(ctx.emit.loopSignal, {
      type: 'loop.pause',
      ...loopIds(ctx),
      question,
      kind: 'plan',
    })
    return { status: 'awaiting_user', pendingQuestion: question }
  }

  /**
   * Re-prompt when the model tries to finish while still drafting a plan.
   * Prevents forcePlan turns from answering immediately without write_todos / ExitPlanMode.
   */
  function planExitNudge(state: State, config: LangGraphRunnableConfig): Partial<State> {
    const ctx = ctxOf(config)
    emitLoopSignal(ctx.emit.loopSignal, {
      type: 'loop.nudge',
      ...loopIds(ctx),
      reason: 'plan_exit',
    })
    return {
      messages: [new SystemMessage(PLAN_EXIT_NUDGE)],
      planExitNudgeCount: (state.planExitNudgeCount ?? 0) + 1,
    }
  }

  /**
   * Agent forgot ExitPlanMode but already produced write_todos — submit for approval.
   */
  function planAutoReady(_state: State, _config: LangGraphRunnableConfig): Partial<State> {
    return { planStatus: 'ready' }
  }

  function routeAfterAgent(
    state: State,
    config: LangGraphRunnableConfig,
  ): 'tools' | 'planExitNudge' | 'planAutoReady' | typeof END {
    const last = state.messages[state.messages.length - 1] as AIMessage
    const wantsTools = (last.tool_calls?.length ?? 0) > 0
    const ctx = ctxOf(config)
    const stepCap = ctx.maxSteps ?? maxSteps
    if (wantsTools && state.steps < stepCap) return 'tools'

    // Plan drafting: refuse to complete until ExitPlanMode (or auto-submit if todos exist).
    if (state.planningMode === 'plan' && state.planStatus === 'generating') {
      const hasPlanItems = (state.plan?.length ?? 0) > 0
      if (hasPlanItems) {
        // Agent wrote todos but skipped ExitPlanMode — still gate on user approval.
        return 'planAutoReady'
      }
      if ((state.planExitNudgeCount ?? 0) < PLAN_EXIT_NUDGE_MAX) {
        return 'planExitNudge'
      }
      // After nudge still no plan: allow END to avoid infinite hang (soft fallback).
    }

    // Terminal (not via pause node). Skip if status already terminal — e.g. circuit breaker
    // emitted loop.end at trip time; pause/planPause emit loop.pause and end via their edges.
    if (state.status !== 'awaiting_user') {
      emitLoopSignal(ctx.emit.loopSignal, {
        type: 'loop.end',
        ...loopIds(ctx),
        reason: wantsTools ? 'max_steps' : 'completed',
      })
    }
    return END
  }

  /**
   * Decision table (Track A §A.2.2): priority doom > replan > error-streak.
   * Same tools→route cycle injects at most one corrective path.
   */
  function routeAfterTools(
    state: State,
    config: LangGraphRunnableConfig,
  ): 'replan' | 'nudge' | 'pause' | 'compact' | 'planPause' | typeof END {
    if (state.planStatus === 'ready') return 'planPause'

    // Only the most recent tool batch (after the last AIMessage). Historical
    // planning-phase Error:* results must not re-pause execution after approve.
    const recentToolContents = collectRecentToolContents(state)

    if (state.planningMode === 'plan' && state.planStatus === 'approved') {
      const hasToolFailure = recentToolContents.some((c) => isLoopToolError(c))
      if (hasToolFailure) {
        return 'pause'
      }
      const plan = state.plan ?? []
      const allCompleted = plan.length > 0 && plan.every((item) => item.status === 'completed')
      if (allCompleted) {
        const ctx = ctxOf(config)
        emitLoopSignal(ctx.emit.loopSignal, {
          type: 'loop.end',
          ...loopIds(ctx),
          reason: 'completed',
        })
        return END
      }
    }

    const trailingErrors = harvestTrailingToolErrors(recentToolContents)
    const lastSig = state.recentSigs[state.recentSigs.length - 1]
    const isDoom =
      lastSig !== undefined && trailingRepeatCount(state.recentSigs, lastSig) >= DOOM_LOOP_N
    const doomStrategy = resolveDoomLoopStrategy(ctxOf(config).doomLoopStrategy)

    // 1) Doom first (more specific than generic error replan).
    // Strategies: nudge_then_pause (default) | pause_immediately | auto_continue (fall through).
    if (isDoom) {
      if (doomStrategy === 'pause_immediately') return 'pause'
      if (doomStrategy === 'nudge_then_pause') {
        return state.nudgedSig === lastSig ? 'pause' : 'nudge'
      }
      // auto_continue: skip doom corrective path; replan / error-streak may still apply.
    }

    // 2) Replan once when trailing errors ≥ threshold and guard allows.
    const guard = getReplanGuard(ctxOf(config))
    if (trailingErrors.length >= REPLAN_ERROR_THRESHOLD && guard.canReplan()) {
      return 'replan'
    }

    // 3) After replan (or when replan unavailable): error-streak nudge then pause.
    if (trailingErrorStreak(recentToolContents) >= ERROR_STREAK_LIMIT) {
      const errSig = 'error-streak'
      return state.nudgedSig === errSig ? 'pause' : 'nudge'
    }

    return 'compact'
  }

  return new StateGraph(LoopState)
    .addNode('compact', compactNode)
    .addNode('agent', agent)
    .addNode('tools', toolsNode)
    .addNode('replan', replanNode)
    .addNode('nudge', nudge)
    .addNode('pause', pause)
    .addNode('planPause', planPause)
    .addNode('planExitNudge', planExitNudge)
    .addNode('planAutoReady', planAutoReady)
    .addEdge(START, 'compact')
    .addEdge('compact', 'agent')
    .addEdge('planPause', END)
    .addEdge('planExitNudge', 'agent')
    .addEdge('planAutoReady', 'planPause')
    .addConditionalEdges('agent', routeAfterAgent, {
      tools: 'tools',
      planExitNudge: 'planExitNudge',
      planAutoReady: 'planAutoReady',
      [END]: END,
    })
    .addConditionalEdges('tools', routeAfterTools, {
      replan: 'replan',
      nudge: 'nudge',
      pause: 'pause',
      compact: 'compact',
      planPause: 'planPause',
      [END]: END,
    })
    .addEdge('replan', 'agent')
    .addEdge('nudge', 'agent')
    .addEdge('pause', END)
    .compile()
}

function todoToPlanItem(item: unknown): PlanItem {
  if (typeof item === 'string') {
    return { content: item, status: 'pending' as const }
  }
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    const content = (item as Record<string, unknown>).content
    const status = (item as Record<string, unknown>).status
    return {
      content: typeof content === 'string' ? content : String(content ?? ''),
      status: status === 'in_progress' || status === 'completed' ? status : 'pending',
    }
  }
  return { content: String(item), status: 'pending' as const }
}

/** Extract PlanItems from a write_todos tool call, if present. */
function planFromWriteTodos(toolCalls: AIMessage['tool_calls']): PlanItem[] | undefined {
  for (const call of toolCalls ?? []) {
    if (call.name === 'write_todos' && call.args !== null && typeof call.args === 'object' && !Array.isArray(call.args)) {
      const todos = (call.args as Record<string, unknown>).todos
      if (Array.isArray(todos)) {
        return todos.map((item) => todoToPlanItem(item))
      }
    }
  }
  return undefined
}

/** Update the plan when the agent publishes a new todo list via write_todos.
 *  The tool replaces the whole plan, so we map its todos directly to PlanItems. */
function deriveUpdatedPlan(plan: PlanItem[] | undefined, toolCalls: AIMessage['tool_calls']): PlanItem[] | undefined {
  return planFromWriteTodos(toolCalls) ?? plan
}
