import { StateGraph, Annotation, START, END, messagesStateReducer } from '@langchain/langgraph'
import type { LangGraphRunnableConfig } from '@langchain/langgraph'
import { AIMessage, SystemMessage, ToolMessage, RemoveMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { TurnUsage, PermissionMode, PlanItem } from '@hip/protocol'
import type { ModelRunner } from './model-runner.js'
import { MAX_STEPS } from './loop-control.js'
import { READ_TOOLS, defaultToolPolicy } from './tool-runner/tool-policy.js'
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
  ERROR_STREAK_LIMIT,
  ERROR_STREAK_NUDGE,
} from './doom-loop.js'
import { estimateTokens, compactMessages, COMPACT_BUDGET_TOKENS, KEEP_RECENT_TURNS, isOverflowError, type Summarizer, type CompactResult } from './compaction.js'
import { applySlidingWindow } from './context/sliding-window.js'
import { isMicroCompactionEnabled, MicroCompaction } from './micro-compaction.js'
import type { HookRegistry } from './hooks/registry.js'
import type { ToolOutputStore } from './tool-output-store.js'
import type { GuardianReviewer } from './guardian.js'
import type { PlanMode } from './plan-mode.js'
import type { CircuitBreaker } from '../orchestrator/circuit-breaker.js'

function fullPlanReminder(planFilePath: string): string {
  return `Plan mode is active. You MUST NOT make any edits (with the exception of the current plan file) or otherwise make changes to the system unless a tool request is explicitly approved. Prefer read-only tools. Use Bash only for read operations — do not write/modify files via shell commands. This supersedes any other instructions you have received.

Workflow:
1. Understand — explore the codebase with Glob, Grep, Read.
2. Design — converge on the best approach.
3. Write Plan — modify the plan file with Write or Edit.
4. Call write_todos — with structured plan items.
5. Exit — call ExitPlanMode for user approval.

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

/** Streaming sinks the graph emits through (wired to the WS layer in session.ts). */
export interface GraphEmit {
  token(delta: string): void
  reasoning(delta: string): void
  toolStarted(name: string, callId: string, input: unknown): void
  toolFinished(callId: string, status: 'finished' | 'error', output?: string, error?: string): void
  usage(u: TurnUsage): void
  planDelta(itemId: string, delta: string): void
  compaction(summary: string): void
}

/** Per-turn context passed via config.configurable.ctx (keeps the compiled graph reusable). */
export interface GraphCtx {
  runner: ModelRunner
  tools: StructuredToolInterface[]
  emit: GraphEmit
  summarizer: Summarizer
  hooks?: HookRegistry
  sessionId: string
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
  planMode?: PlanMode
  /** Optional circuit breaker that detects stalled agent loops and budget exhaustion. */
  circuitBreaker?: CircuitBreaker
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
})

type State = typeof LoopState.State
export type LoopState = State

function ctxOf(config: LangGraphRunnableConfig): GraphCtx {
  const ctx = (config.configurable as { ctx?: GraphCtx } | undefined)?.ctx
  if (!ctx) throw new Error('graph invoked without configurable.ctx')
  return ctx
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
  const removeSet = new Set(result.removeIds)
  return stateMessages
    .filter((m) => !m.id || !removeSet.has(m.id))
    .map((m) => (m.id === result.summary.id ? result.summary : m))
}

/** Build the agent-loop graph. `maxSteps` and `compactBudget` are injectable for tests. */
export function buildGraph(maxSteps: number = MAX_STEPS, compactBudget: number = COMPACT_BUDGET_TOKENS) {
/** Pre-turn compaction: shrink the middle when over budget (≤ once per invoke). */
  async function compactNode(state: State, config: LangGraphRunnableConfig): Promise<Partial<State>> {
    const deferredResolved = resolveDeferred(state)

    if (isMicroCompactionEnabled() && !state.compacted) {
      const mc = new MicroCompaction()
      const { messages: mcMessages, truncated } = mc.compact(state.messages)
      if (truncated > 0) {
        const out: BaseMessage[] = [...(deferredResolved.messages ?? [])]
        for (let i = 0; i < state.messages.length; i++) {
          if (mcMessages[i] !== state.messages[i]) {
            const orig = state.messages[i]
            if (orig.id) out.push(new RemoveMessage({ id: orig.id }))
            out.push(mcMessages[i])
          }
        }
        return { messages: out, deferredMessages: deferredResolved.deferredMessages }
      }
    }

    if (state.compacted) return deferredResolved
    const ctx = ctxOf(config)

    // Apply sliding window first: when the message count exceeds the threshold,
    // keep the first task message + last N turns and summarize the middle span.
    // This runs BEFORE token-budget summarization to reduce context pressure early.
    const windowResult = applySlidingWindow(state.messages)
    if (windowResult.removed.length > 0) {
      const summary = await ctx.summarizer.summarize(windowResult.removed)
      const summaryMsg = new SystemMessage(`[Earlier conversation summary]\n${summary}`)
      ctx.emit.compaction(`Sliding window: ${windowResult.removed.length} messages summarized`)
      return {
        messages: [...(deferredResolved.messages ?? []), summaryMsg, ...windowResult.kept],
        compacted: true,
        deferredMessages: deferredResolved.deferredMessages,
      }
    }

    const overBudget = estimateTokens(state.messages) > compactBudget
    if (!overBudget) return deferredResolved
    const result = await compactMessages(state.messages, { keepRecentTurns: KEEP_RECENT_TURNS, summarizer: ctx.summarizer })
    if (!result) return deferredResolved
    const summaryText = typeof result.summary.content === 'string' ? result.summary.content : ''
    ctx.emit.compaction(summaryText)
    return {
      messages: [...(deferredResolved.messages ?? []), result.summary, ...result.removeIds.map((id) => new RemoveMessage({ id }))],
      compacted: true,
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
        onText: (d) => emit.token(d),
        onReasoning: (d) => emit.reasoning(d),
      })
    }

    async function execute(input: BaseMessage[]): Promise<Partial<State>> {
      const msg = await runModel(input)
      const u = msg.usage_metadata
      if (u) emit.usage({ inputTokens: u.input_tokens, outputTokens: u.output_tokens, totalTokens: u.total_tokens })
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
      const result = await compactMessages(messages, { keepRecentTurns: KEEP_RECENT_TURNS, summarizer: ctx.summarizer, overflowRecovery: true })
      if (!result) throw err
      const summaryText = typeof result.summary.content === 'string' ? result.summary.content : ''
      emit.compaction(summaryText)
      const compactedMessages = [result.summary, ...result.removeIds.map((id) => new RemoveMessage({ id }))]
      const compactedState = applyCompaction(state.messages, result)
      const retryMessages = prepareMessages(compactedState)
      const msgResult = await execute(retryMessages)
      return { ...msgResult, messages: [...(deferredResolved.messages ?? []), ...compactedMessages, ...(msgResult.messages ?? [])], compacted: true, deferredMessages: deferredResolved.deferredMessages, planStepsSinceInjection }
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
      toolOutputStore: ctx.toolOutputStore,
      guardianReviewer: ctx.guardianReviewer,
      onToolStarted: (name, callId, input) => ctx.emit.toolStarted(name, callId, input),
      onToolFinished: (callId, status, output, error) => ctx.emit.toolFinished(callId, status, output, error),
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
    const parallelIndices: number[] = []
    const sequentialIndices: number[] = []
    for (let i = 0; i < calls.length; i++) {
      if (READ_TOOLS.has(calls[i].name)) {
        parallelIndices.push(i)
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
      })
    }

    await runWithConcurrency(parallelIndices, parallelism, runOne)

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

    const sig = sigOf(last.tool_calls ?? [])

    const planOverride = {
      ...(planStatus !== undefined ? { planStatus } : {}),
      ...(planningMode !== undefined ? { planningMode } : {}),
    }

    const pathHitState = { pathHits: pathHits.slice(-50) }

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

  /** Corrective note after the Nth identical batch or error streak. */
  function nudge(state: State): Partial<State> {
    const recentToolContents: string[] = []
    for (let i = state.messages.length - 1; i >= 0 && recentToolContents.length < ERROR_STREAK_LIMIT; i--) {
      const m = state.messages[i]
      if (m instanceof ToolMessage) recentToolContents.unshift(String(m.content))
      else if (m instanceof AIMessage) break
    }
    if (trailingErrorStreak(recentToolContents) >= ERROR_STREAK_LIMIT) {
      return { messages: [new SystemMessage(ERROR_STREAK_NUDGE)], nudgedSig: 'error-streak' }
    }
    return { messages: [new SystemMessage(DOOM_LOOP_NUDGE)], nudgedSig: state.recentSigs[state.recentSigs.length - 1] }
  }

  /** Stop the turn pending user input (Option Z: session.ts reads this and emits agent:interrupt). */
  function pause(_state: State): Partial<State> {
    return { status: 'awaiting_user', pendingQuestion: PAUSE_QUESTION }
  }

  function planPause(state: State): Partial<State> {
    return { status: 'awaiting_user', pendingQuestion: 'Review the plan above. Approve, reject, or suggest changes.' }
  }

  function routeAfterAgent(state: State, config: LangGraphRunnableConfig): 'tools' | typeof END {
    const last = state.messages[state.messages.length - 1] as AIMessage
    const wantsTools = (last.tool_calls?.length ?? 0) > 0
    const stepCap = ctxOf(config).maxSteps ?? maxSteps
    return wantsTools && state.steps < stepCap ? 'tools' : END
  }

  function routeAfterTools(state: State): 'nudge' | 'pause' | 'compact' | 'planPause' | typeof END {
    if (state.planStatus === 'ready') return 'planPause'
    if (state.planningMode === 'plan' && state.planStatus === 'approved') {
      const hasToolFailure = state.messages.some((m) => m instanceof ToolMessage && m.content.toString().startsWith('Error'))
      if (hasToolFailure) {
        return 'pause'
      }
      const plan = state.plan ?? []
      const allCompleted = plan.length > 0 && plan.every((item) => item.status === 'completed')
      if (allCompleted) {
        return END
      }
    }
    // LoopGuard v2: consecutive tool errors → nudge (text-only wrap-up).
    const recentToolContents: string[] = []
    for (let i = state.messages.length - 1; i >= 0 && recentToolContents.length < ERROR_STREAK_LIMIT; i--) {
      const m = state.messages[i]
      if (m instanceof ToolMessage) recentToolContents.unshift(String(m.content))
      else if (m instanceof AIMessage) break
    }
    if (trailingErrorStreak(recentToolContents) >= ERROR_STREAK_LIMIT) {
      const errSig = 'error-streak'
      return state.nudgedSig === errSig ? 'pause' : 'nudge'
    }
    const lastSig = state.recentSigs[state.recentSigs.length - 1]
    if (lastSig !== undefined && trailingRepeatCount(state.recentSigs, lastSig) >= DOOM_LOOP_N) {
      return state.nudgedSig === lastSig ? 'pause' : 'nudge'
    }
    return 'compact'
  }

  return new StateGraph(LoopState)
    .addNode('compact', compactNode)
    .addNode('agent', agent)
    .addNode('tools', toolsNode)
    .addNode('nudge', nudge)
    .addNode('pause', pause)
    .addNode('planPause', planPause)
    .addEdge(START, 'compact')
    .addEdge('compact', 'agent')
    .addEdge('planPause', END)
    .addConditionalEdges('agent', routeAfterAgent, { tools: 'tools', [END]: END })
    .addConditionalEdges('tools', routeAfterTools, { nudge: 'nudge', pause: 'pause', compact: 'compact', planPause: 'planPause', [END]: END })
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

/** Update the plan when the agent publishes a new todo list via write_todos.
 *  The tool replaces the whole plan, so we map its todos directly to PlanItems. */
function deriveUpdatedPlan(plan: PlanItem[] | undefined, toolCalls: AIMessage['tool_calls']): PlanItem[] | undefined {
  for (const call of toolCalls ?? []) {
    if (call.name === 'write_todos' && call.args !== null && typeof call.args === 'object' && !Array.isArray(call.args)) {
      const todos = (call.args as Record<string, unknown>).todos
      if (Array.isArray(todos)) {
        return todos.map((item) => todoToPlanItem(item))
      }
    }
  }
  return plan
}
