import { StateGraph, Annotation, START, END, messagesStateReducer } from '@langchain/langgraph'
import type { LangGraphRunnableConfig } from '@langchain/langgraph'
import { AIMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { ModelRunner } from './model-runner.js'
import { MAX_STEPS } from './loop-control.js'

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
}

const LoopState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: messagesStateReducer, default: () => [] }),
  steps: Annotation<number>({ reducer: (_prev, next) => next, default: () => 0 }),
})

type State = typeof LoopState.State

function ctxOf(config: LangGraphRunnableConfig): GraphCtx {
  const ctx = (config.configurable as { ctx?: GraphCtx } | undefined)?.ctx
  if (!ctx) throw new Error('graph invoked without configurable.ctx')
  return ctx
}

/** Build the agent-loop graph. `maxSteps` is injectable for tests. */
export function buildGraph(maxSteps: number = MAX_STEPS) {
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
    return { messages: out }
  }

  function route(state: State): 'tools' | typeof END {
    const last = state.messages[state.messages.length - 1] as AIMessage
    const wantsTools = (last.tool_calls?.length ?? 0) > 0
    if (wantsTools && state.steps < maxSteps) return 'tools'
    return END
  }

  return new StateGraph(LoopState)
    .addNode('agent', agent)
    .addNode('tools', toolsNode)
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', route, { tools: 'tools', [END]: END })
    .addEdge('tools', 'agent')
    .compile()
}
