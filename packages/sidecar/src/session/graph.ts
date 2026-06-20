import { StateGraph, Annotation, START, END, messagesStateReducer } from '@langchain/langgraph'
import type { LangGraphRunnableConfig } from '@langchain/langgraph'
import { AIMessage, SystemMessage, ToolMessage, RemoveMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { TurnUsage, PermissionMode, PlanItem } from '@hip/protocol'
import type { ModelRunner } from './model-runner.js'
import { MAX_STEPS } from './loop-control.js'
import type { ToolPolicy } from './tool-runner/tool-policy.js'
import { defaultToolPolicy } from './tool-runner/tool-policy.js'
import type { ApprovalCache } from './tool-runner/approval-cache.js'
import { SessionApprovalCache } from './tool-runner/approval-cache.js'
import { ToolRunner } from './tool-runner/tool-runner.js'
import type { ApprovalFn } from './tools.js'
import { SELF_GATED_TOOLS } from './tools.js'
import { sigOf, trailingRepeatCount, DOOM_LOOP_N, SIG_WINDOW, DOOM_LOOP_NUDGE, PAUSE_QUESTION } from './doom-loop.js'
import { estimateTokens, compactMessages, COMPACT_BUDGET_TOKENS, KEEP_RECENT_TURNS, type Summarizer } from './compaction.js'
import type { HookRegistry } from './hooks/registry.js'

/** Streaming sinks the graph emits through (wired to the WS layer in session.ts). */
export interface GraphEmit {
  token(delta: string): void
  reasoning(delta: string): void
  toolStarted(name: string, callId: string, input: unknown): void
  toolFinished(callId: string, status: 'finished' | 'error', output?: string, error?: string): void
  usage(u: TurnUsage): void
  planDelta(itemId: string, delta: string): void
}

/** Per-turn context passed via config.configurable.ctx (keeps the compiled graph reusable). */
export interface GraphCtx {
  runner: ModelRunner
  tools: StructuredToolInterface[]
  emit: GraphEmit
  summarizer: Summarizer
  hooks?: HookRegistry
  sessionId?: string
  toolRunner?: ToolRunner
  toolPolicy?: ToolPolicy
  approvalCache?: ApprovalCache
  requestApproval?: ApprovalFn
  permissionMode?: PermissionMode
  allowedTools?: string[]
  blockedTools?: string[]
  systemPrompt?: string
  activeProfileId?: string
}

const LoopState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: messagesStateReducer, default: () => [] }),
  steps: Annotation<number>({ reducer: (_prev, next) => next, default: () => 0 }),
  recentSigs: Annotation<string[]>({ reducer: (_prev, next) => next, default: () => [] }),
  nudgedSig: Annotation<string | undefined>({ reducer: (_prev, next) => next, default: () => undefined }),
  status: Annotation<'running' | 'awaiting_user'>({ reducer: (_prev, next) => next, default: () => 'running' }),
  pendingQuestion: Annotation<string | undefined>({ reducer: (_prev, next) => next, default: () => undefined }),
  planningMode: Annotation<'fast' | 'plan'>({ reducer: (_prev, next) => next, default: () => 'fast' }),
  planStatus: Annotation<'none' | 'generating' | 'ready' | 'approved' | 'rejected'>({ reducer: (_prev, next) => next, default: () => 'none' }),
  plan: Annotation<PlanItem[] | undefined>({ reducer: (_prev, next) => next, default: () => undefined }),
  verifyMemo: Annotation<string | undefined>({ reducer: (_prev, next) => next, default: () => undefined }),
})

type State = typeof LoopState.State

function ctxOf(config: LangGraphRunnableConfig): GraphCtx {
  const ctx = (config.configurable as { ctx?: GraphCtx } | undefined)?.ctx
  if (!ctx) throw new Error('graph invoked without configurable.ctx')
  return ctx
}

/** Build the agent-loop graph. `maxSteps` and `compactBudget` are injectable for tests. */
export function buildGraph(maxSteps: number = MAX_STEPS, compactBudget: number = COMPACT_BUDGET_TOKENS) {
  /** Pre-turn + mid-loop context shrink: summarize the middle when over budget (≤ once per visit). */
  async function compact(state: State, config: LangGraphRunnableConfig): Promise<Partial<State>> {
    if (estimateTokens(state.messages) <= compactBudget) return {}
    const result = await compactMessages(state.messages, { keepRecentTurns: KEEP_RECENT_TURNS, summarizer: ctxOf(config).summarizer })
    if (!result) return {}
    return { messages: [result.summary, ...result.removeIds.map((id) => new RemoveMessage({ id }))] }
  }

  async function agent(state: State, config: LangGraphRunnableConfig): Promise<Partial<State>> {
    const { runner, tools, emit, systemPrompt } = ctxOf(config)
    const messages: BaseMessage[] = systemPrompt !== undefined && !(state.messages[0] instanceof SystemMessage && state.messages[0].content === systemPrompt)
      ? [new SystemMessage(systemPrompt), ...state.messages]
      : state.messages
    const capped = state.steps >= maxSteps - 1 // last allowed step: no tools, force text
    const msg = await runner.run(messages, {
      tools,
      bindTools: !capped,
      signal: config.signal,
      onText: (d) => emit.token(d),
      onReasoning: (d) => emit.reasoning(d),
    })
    const u = msg.usage_metadata
    if (u) emit.usage({ inputTokens: u.input_tokens, outputTokens: u.output_tokens, totalTokens: u.total_tokens })
    return { messages: [msg], steps: state.steps + 1 }
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
      sessionId: ctx.sessionId ?? '',
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
      const isMcp = call.name.startsWith('mcp__')
      if (ctx.allowedTools && ctx.allowedTools.length > 0 && !isMcp && !ctx.allowedTools.includes(call.name)) {
        console.warn(`Blocked tool call "${call.name}" by allowedTools profile filter`)
        blockedCalls.push(new ToolMessage({
          content: `Error: Tool "${call.name}" is not available in the current agent profile.`,
          tool_call_id: call.id ?? call.name,
          name: call.name,
        }))
        continue
      }
      if (ctx.blockedTools && ctx.blockedTools.length > 0 && ctx.blockedTools.includes(call.name)) {
        console.warn(`Blocked tool call "${call.name}" by blockedTools profile filter`)
        blockedCalls.push(new ToolMessage({
          content: `Error: Tool "${call.name}" is blocked in the current agent profile.`,
          tool_call_id: call.id ?? call.name,
          name: call.name,
        }))
        continue
      }
      calls.push(call)
    }
    const out: ToolMessage[] = []
    for (const call of calls) {
      const id = call.id ?? call.name
      const result = await runner.runToolCall({
        name: call.name,
        callId: id,
        args: (call.args as Record<string, unknown>) ?? {},
      })
      out.push(new ToolMessage({
        content: result.content,
        tool_call_id: result.tool_call_id,
        name: result.name,
      }))
    }
    const sig = sigOf(calls)
    return { messages: [...blockedCalls, ...out], recentSigs: [...state.recentSigs, sig].slice(-SIG_WINDOW) }
  }

  /** Corrective note after the Nth identical batch; recorded against the offending signature. */
  function nudge(state: State): Partial<State> {
    return { messages: [new SystemMessage(DOOM_LOOP_NUDGE)], nudgedSig: state.recentSigs[state.recentSigs.length - 1] }
  }

  /** Stop the turn pending user input (Option Z: session.ts reads this and emits agent:interrupt). */
  function pause(_state: State): Partial<State> {
    return { status: 'awaiting_user', pendingQuestion: PAUSE_QUESTION }
  }

  const PLANNING_SYSTEM_PROMPT = `You are a planning assistant. Analyze the user's request and break it into concrete, ordered steps. Call the write_todos tool with the plan, then output a one-sentence summary of the plan.`

  async function planNode(state: State, config: LangGraphRunnableConfig): Promise<Partial<State>> {
    const { runner, tools, emit, systemPrompt } = ctxOf(config)
    const messages: BaseMessage[] = [...state.messages]
    const planPrompt = systemPrompt ? `${PLANNING_SYSTEM_PROMPT}\n\n${systemPrompt}` : PLANNING_SYSTEM_PROMPT
    if (messages[0] instanceof SystemMessage) {
      messages[0] = new SystemMessage(planPrompt)
    } else {
      messages.unshift(new SystemMessage(planPrompt))
    }
    const itemId = `plan-${config.runId ?? Date.now()}`
    const msg = await runner.run(messages, {
      tools,
      bindTools: true,
      signal: config.signal,
      onText: (d) => {
        emit.token(d)
        emit.planDelta(itemId, d)
      },
      onReasoning: (d) => emit.reasoning(d),
    })
    const u = msg.usage_metadata
    if (u) emit.usage({ inputTokens: u.input_tokens, outputTokens: u.output_tokens, totalTokens: u.total_tokens })
    const plan = extractPlanFromMessages([...messages, msg])
    return { messages: [msg], steps: state.steps + 1, planningMode: 'plan', planStatus: 'ready', plan }
  }

  function planPause(state: State): Partial<State> {
    return { status: 'awaiting_user', pendingQuestion: 'Review the plan above. Approve, reject, or suggest changes.' }
  }

  function routeAfterCompact(state: State, _config: LangGraphRunnableConfig): 'plan' | 'agent' {
    if (state.planningMode === 'plan' && state.planStatus !== 'approved') return 'plan'
    return 'agent'
  }

  function routeAfterAgent(state: State): 'tools' | typeof END {
    const last = state.messages[state.messages.length - 1] as AIMessage
    const wantsTools = (last.tool_calls?.length ?? 0) > 0
    return wantsTools && state.steps < maxSteps ? 'tools' : END
  }

  function routeAfterTools(state: State): 'nudge' | 'pause' | 'compact' | typeof END {
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
    const lastSig = state.recentSigs[state.recentSigs.length - 1]
    if (lastSig !== undefined && trailingRepeatCount(state.recentSigs, lastSig) >= DOOM_LOOP_N) {
      return state.nudgedSig === lastSig ? 'pause' : 'nudge'
    }
    return 'compact'
  }

  return new StateGraph(LoopState)
    .addNode('compact', compact)
    .addNode('agent', agent)
    .addNode('tools', toolsNode)
    .addNode('nudge', nudge)
    .addNode('pause', pause)
    .addNode('planner', planNode)
    .addNode('planPause', planPause)
    .addEdge(START, 'compact')
    .addConditionalEdges('compact', routeAfterCompact, { plan: 'planner', agent: 'agent' })
    .addEdge('planner', 'planPause')
    .addEdge('planPause', END)
    .addConditionalEdges('agent', routeAfterAgent, { tools: 'tools', [END]: END })
    .addConditionalEdges('tools', routeAfterTools, { nudge: 'nudge', pause: 'pause', compact: 'compact', [END]: END })
    .addEdge('nudge', 'agent')
    .addEdge('pause', END)
    .compile()
}

function extractPlanFromMessages(messages: BaseMessage[]): PlanItem[] | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg instanceof AIMessage) {
      const calls = msg.tool_calls ?? []
      for (const call of calls) {
        if (call.name === 'write_todos' && call.args && typeof call.args === 'object') {
          const todos = (call.args as Record<string, unknown>).todos
          if (Array.isArray(todos)) {
            return todos.map((item) => {
              if (typeof item === 'string') {
                return { content: item, status: 'pending' as const }
              }
              if (item && typeof item === 'object') {
                const content = (item as Record<string, unknown>).content
                return { content: typeof content === 'string' ? content : String(content), status: 'pending' as const }
              }
              return { content: String(item), status: 'pending' as const }
            })
          }
        }
      }
    }
  }
  return undefined
}
