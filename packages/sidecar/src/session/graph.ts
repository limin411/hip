import { StateGraph, Annotation, START, END, messagesStateReducer } from '@langchain/langgraph'
import type { LangGraphRunnableConfig } from '@langchain/langgraph'
import { AIMessage, SystemMessage, ToolMessage, RemoveMessage, type BaseMessage } from '@langchain/core/messages'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { TurnUsage, PermissionMode } from '@hip/protocol'
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
}

const LoopState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: messagesStateReducer, default: () => [] }),
  steps: Annotation<number>({ reducer: (_prev, next) => next, default: () => 0 }),
  recentSigs: Annotation<string[]>({ reducer: (_prev, next) => next, default: () => [] }),
  nudgedSig: Annotation<string | undefined>({ reducer: (_prev, next) => next, default: () => undefined }),
  status: Annotation<'running' | 'awaiting_user'>({ reducer: (_prev, next) => next, default: () => 'running' }),
  pendingQuestion: Annotation<string | undefined>({ reducer: (_prev, next) => next, default: () => undefined }),
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
    const { runner, tools, emit } = ctxOf(config)
    const capped = state.steps >= maxSteps - 1 // last allowed step: no tools, force text
    const msg = await runner.run(state.messages, {
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
    const out: ToolMessage[] = []
    for (const call of last.tool_calls ?? []) {
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
    // The Nth identical batch is executed too (keeps tool_calls↔ToolMessage valid); doom-loop is
    // detected post-execution from the trailing signature run.
    const sig = sigOf(last.tool_calls ?? [])
    return { messages: out, recentSigs: [...state.recentSigs, sig].slice(-SIG_WINDOW) }
  }

  /** Corrective note after the Nth identical batch; recorded against the offending signature. */
  function nudge(state: State): Partial<State> {
    return { messages: [new SystemMessage(DOOM_LOOP_NUDGE)], nudgedSig: state.recentSigs[state.recentSigs.length - 1] }
  }

  /** Stop the turn pending user input (Option Z: session.ts reads this and emits agent:interrupt). */
  function pause(_state: State): Partial<State> {
    return { status: 'awaiting_user', pendingQuestion: PAUSE_QUESTION }
  }

  function routeAfterAgent(state: State): 'tools' | typeof END {
    const last = state.messages[state.messages.length - 1] as AIMessage
    const wantsTools = (last.tool_calls?.length ?? 0) > 0
    return wantsTools && state.steps < maxSteps ? 'tools' : END
  }

  function routeAfterTools(state: State): 'nudge' | 'pause' | 'compact' {
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
    .addEdge(START, 'compact')
    .addEdge('compact', 'agent')
    .addConditionalEdges('agent', routeAfterAgent, { tools: 'tools', [END]: END })
    .addConditionalEdges('tools', routeAfterTools, { nudge: 'nudge', pause: 'pause', compact: 'compact' })
    .addEdge('nudge', 'agent')
    .addEdge('pause', END)
    .compile()
}
