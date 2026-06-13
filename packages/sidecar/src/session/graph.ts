import { StateGraph, Annotation, START, END, messagesStateReducer } from '@langchain/langgraph'
import type { LangGraphRunnableConfig } from '@langchain/langgraph'
import { AIMessage, SystemMessage, ToolMessage, RemoveMessage, type BaseMessage } from '@langchain/core/messages'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { ModelRunner } from './model-runner.js'
import { MAX_STEPS } from './loop-control.js'
import { sigOf, trailingRepeatCount, DOOM_LOOP_N, SIG_WINDOW, DOOM_LOOP_NUDGE, PAUSE_QUESTION } from './doom-loop.js'
import { estimateTokens, compactMessages, COMPACT_BUDGET_TOKENS, KEEP_RECENT_TURNS, type Summarizer } from './compaction.js'

/** Streaming sinks the graph emits through (wired to the WS layer in session.ts). */
export interface GraphEmit {
  token(delta: string): void
  reasoning(delta: string): void
  toolStarted(name: string, callId: string, input: unknown): void
  toolFinished(callId: string, status: 'finished' | 'error', output?: string, error?: string): void
}

/** Per-turn context passed via config.configurable.ctx (keeps the compiled graph reusable). */
export interface GraphCtx {
  runner: ModelRunner
  tools: StructuredToolInterface[]
  emit: GraphEmit
  summarizer: Summarizer
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
    return { messages: [msg], steps: state.steps + 1 }
  }

  async function toolsNode(state: State, config: LangGraphRunnableConfig): Promise<Partial<State>> {
    const { tools, emit } = ctxOf(config)
    const byName = new Map(tools.map((t) => [t.name, t]))
    const last = state.messages[state.messages.length - 1] as AIMessage
    const out: ToolMessage[] = []
    for (const call of last.tool_calls ?? []) {
      const id = call.id ?? call.name
      emit.toolStarted(call.name, id, call.args)
      const t = byName.get(call.name)
      if (!t) {
        emit.toolFinished(id, 'error', undefined, `unknown tool: ${call.name}`)
        out.push(new ToolMessage({ content: `Error: unknown tool ${call.name}`, tool_call_id: id, name: call.name }))
        continue
      }
      try {
        const result = String(await t.invoke(call.args))
        emit.toolFinished(id, 'finished', result)
        out.push(new ToolMessage({ content: result, tool_call_id: id, name: call.name }))
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e)
        emit.toolFinished(id, 'error', undefined, error)
        out.push(new ToolMessage({ content: `Error: ${error}`, tool_call_id: id, name: call.name }))
      }
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
