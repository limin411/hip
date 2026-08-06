/**
 * multi-agent-graph — manual StateGraph composition for multi-agent handoff.
 *
 * Optional / non-default product surface. Ordinary sessions use Supervisor ReAct
 * (`buildGraph`) plus agent-driven `task` / `dispatch_agent` / `task_batch`.
 * This handoff graph is for explicit multi-profile callers, not the default
 * session path and not entered via orchMode.
 *
 * Built WITHOUT `@langchain/langgraph-swarm`'s `createSwarm()` (immature on JS
 * — missing `createAgent`, pervasive `any` types). Instead we compose by hand:
 *
 *   - Shared `messages` channel (reducer via messagesStateReducer).
 *   - `activeAgent` channel (last-value-wins) selects which agent runs next.
 *   - One node per AgentProfile: filters tools by `allowedTools`, prepends the
 *     profile's `systemPrompt`, exposes handoff tools for every OTHER profile.
 *   - One shared `tools` node: executes normal tools; intercepts handoff tool
 *     calls by name prefix and emits `Command(goto=target, update={activeAgent})`.
 *   - Routers read `activeAgent` (falling back to `defaultProfileId`) to route.
 *
 * The tools node + handoff helpers live in `multi-agent-handoff.ts`.
 *
 * Single-profile fallback: when `profiles.length <= 1`, returns `buildGraph()`
 * unchanged — preserves the existing single-agent path.
 */
import {
  StateGraph,
  Annotation,
  START,
  END,
  Command,
  messagesStateReducer,
  type LangGraphRunnableConfig,
} from '@langchain/langgraph'
import { AIMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { AgentProfile } from './agent-profile.js'
import type { ModelRunner } from './model-runner.js'
import type { GraphEmit } from './graph.js'
import { buildGraph } from './graph.js'
import { MAX_STEPS } from './loop-control.js'
import { estimatePromptTokens } from './compaction.js'
import { usageFromModelMetadata } from './usage.js'
import { getActiveModel } from '../config/providers.js'
import {
  HANDOFF_TOOL_PREFIX,
  ctxOf,
  agentNodeName,
  buildHandoffTool,
  multiAgentToolsNode,
} from './multi-agent-handoff.js'

export { HANDOFF_TOOL_PREFIX } from './multi-agent-handoff.js'

/** Multi-agent state annotation. */
const MultiAgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: messagesStateReducer, default: () => [] }),
  activeAgent: Annotation<string>({ reducer: (_prev, next) => next ?? '', default: () => '' }),
  steps: Annotation<number>({ reducer: (_prev, next) => next ?? 0, default: () => 0 }),
})

export type MultiState = typeof MultiAgentState.State
export type MultiUpdate = typeof MultiAgentState.Update

/** Per-invoke context passed via `config.configurable.ctx` (keeps the compiled graph reusable). */
export interface MultiAgentCtx {
  runner: ModelRunner
  tools: StructuredToolInterface[]
  emit: GraphEmit
  /** All profiles in the multi-agent pool. Each becomes one node in the graph. */
  profiles: AgentProfile[]
  /** Profile id used when `state.activeAgent` is empty (initial routing). */
  defaultProfileId: string
  /** Per-agent step cap. Defaults to MAX_STEPS. */
  maxSteps?: number
}

/** Compiled multi-agent graph — the minimal shape callers depend on. */
export interface MultiAgentApp {
  invoke(
    input: { messages?: BaseMessage[]; activeAgent?: string; steps?: number },
    config?: LangGraphRunnableConfig,
  ): Promise<{ messages: BaseMessage[]; activeAgent: string; steps: number }>
}

/** Filter the shared tool pool by a profile's `allowedTools`/`blockedTools`. */
function filterToolsByProfile(tools: StructuredToolInterface[], profile: AgentProfile): StructuredToolInterface[] {
  let filtered = tools
  if (profile.allowedTools && profile.allowedTools.length > 0) {
    const allowed = new Set(profile.allowedTools)
    filtered = filtered.filter((t) => allowed.has(t.name))
  }
  if (profile.blockedTools && profile.blockedTools.length > 0) {
    const blocked = new Set(profile.blockedTools)
    filtered = filtered.filter((t) => !blocked.has(t.name))
  }
  return filtered
}

/** Prepend (or replace) a SystemMessage carrying the profile's system prompt. */
function applySystemPrompt(messages: BaseMessage[], systemPrompt: string | undefined): BaseMessage[] {
  if (!systemPrompt) return [...messages]
  const out = [...messages]
  if (out.length > 0 && out[0]._getType() === 'system') {
    out[0] = new SystemMessage(systemPrompt)
  } else {
    out.unshift(new SystemMessage(systemPrompt))
  }
  return out
}

/** Node factory: returns the per-profile agent node function. */
function makeAgentNode(profile: AgentProfile) {
  return async function agentNode(
    state: MultiState,
    config: LangGraphRunnableConfig,
  ): Promise<Partial<MultiUpdate>> {
    const ctx = ctxOf(config)
    const maxSteps = ctx.maxSteps ?? MAX_STEPS

    const ownTools = filterToolsByProfile(ctx.tools, profile)
    const otherProfiles = ctx.profiles.filter((p) => p.id !== profile.id)
    const handoffTools = otherProfiles.map(buildHandoffTool)
    const toolsForAgent = [...ownTools, ...handoffTools]

    const messages = applySystemPrompt(state.messages, profile.systemPrompt)

    // On the last allowed step, disable tools so the model is forced to answer in text.
    const bindTools = state.steps < maxSteps - 1
    const msg = await ctx.runner.run(messages, {
      tools: toolsForAgent,
      bindTools,
      signal: config.signal,
      onText: (d) => ctx.emit.token(d),
      onReasoning: (d) => ctx.emit.reasoning(d),
      onActivity: () => ctx.emit.activity?.(),
    })

    const estimated = estimatePromptTokens({
      messages,
      tools: toolsForAgent.map((t) => ({ name: t.name, description: t.description })),
    })
    const binding = profile.modelBinding
    const active = getActiveModel()
    const turnUsage = usageFromModelMetadata(msg.usage_metadata, estimated, {
      modelId: binding?.modelID ?? active.modelID,
      providerId: binding?.providerID ?? active.providerID,
    })
    if (turnUsage) ctx.emit.usage(turnUsage)

    // Re-assert this profile as the active agent so the post-tool router
    // recovers even when the initial state had activeAgent = ''.
    return { messages: [msg], steps: state.steps + 1, activeAgent: profile.id }
  }
}

/** Resolve the next agent id, falling back to the default when state has none. */
function resolveActiveAgent(state: MultiState, config: LangGraphRunnableConfig): string {
  return state.activeAgent || ctxOf(config).defaultProfileId
}

function routeToActiveAgent(state: MultiState, config: LangGraphRunnableConfig): string {
  return agentNodeName(resolveActiveAgent(state, config))
}

function routeAfterAgent(state: MultiState): 'tools' | typeof END {
  const last = state.messages[state.messages.length - 1] as AIMessage
  return (last.tool_calls?.length ?? 0) > 0 ? 'tools' : END
}

/**
 * Minimal structural view of a StateGraph builder after dynamically adding
 * agent nodes. TS cannot infer the post-`addNode` type through a `for` loop
 * (each `addNode` call widens the node-name union, but the variable's type is
 * fixed at declaration), so we narrow to this interface for the remaining
 * edge/compile calls. This is a type-level narrowing to a specific shape —
 * NOT `as any` — the runtime graph is fully constructed by `addNode`.
 */
interface MultiAgentBuilder {
  addNode(
    name: string,
    fn: (state: MultiState, config: LangGraphRunnableConfig) => Promise<Partial<MultiUpdate> | Command<unknown, MultiUpdate, string>>,
  ): this
  addConditionalEdges(
    source: typeof START | string,
    router: (state: MultiState, config: LangGraphRunnableConfig) => string,
    pathMap?: Record<string, string>,
  ): this
  addConditionalEdges(
    source: string,
    router: (state: MultiState) => 'tools' | typeof END,
    pathMap: { tools: 'tools'; __end__: typeof END },
  ): this
  compile(): MultiAgentApp
}

/** Build the multi-agent-only topology (always profiles.length >= 2). */
function buildMultiAgentOnly(opts: {
  profiles: AgentProfile[]
  defaultProfileId: string
}): MultiAgentApp {
  const graph = new StateGraph(MultiAgentState) as unknown as MultiAgentBuilder
  graph.addNode('tools', multiAgentToolsNode)
  for (const profile of opts.profiles) {
    graph.addNode(agentNodeName(profile.id), makeAgentNode(profile))
  }

  const agentPathMap: Record<string, string> = {}
  for (const profile of opts.profiles) {
    const name = agentNodeName(profile.id)
    agentPathMap[name] = name
  }

  graph.addConditionalEdges(START, routeToActiveAgent, agentPathMap)
  for (const profile of opts.profiles) {
    graph.addConditionalEdges(agentNodeName(profile.id), routeAfterAgent, { tools: 'tools', __end__: END })
  }
  // When the tools node returns a Command (handoff), LangGraph uses the
  // Command's `goto` and this conditional edge is bypassed.
  graph.addConditionalEdges('tools', routeToActiveAgent, agentPathMap)

  return graph.compile()
}

/** Build opts for `buildMultiAgentGraph`. */
export interface BuildMultiAgentGraphOpts {
  /** Resolved agent profiles. <=1 falls back to single-agent `buildGraph()`. */
  profiles: AgentProfile[]
  runner: ModelRunner
  tools: StructuredToolInterface[]
  emit: GraphEmit
  /** Profile id to route to when state.activeAgent is empty. Defaults to profiles[0].id. */
  defaultProfileId?: string
  /** Per-agent step cap. Defaults to MAX_STEPS (800). */
  maxSteps?: number
}

/**
 * Build a multi-agent StateGraph with handoff tools.
 *
 * - `profiles.length <= 1` → returns single-agent `buildGraph()`.
 * - `profiles.length >= 2` → returns a compiled multi-agent StateGraph where
 *   each profile is a node, handoff tools route via `Command(goto)`, and a
 *   shared tools node executes non-handoff tools.
 *
 * The returned graph accepts `.invoke({ messages, activeAgent?, steps? },
 * { configurable: { ctx } })` — compatible with the existing Session.invoke
 * pattern.
 */
export function buildMultiAgentGraph(opts: BuildMultiAgentGraphOpts) {
  if (opts.profiles.length <= 1) {
    return buildGraph()
  }
  return buildMultiAgentOnly({
    profiles: opts.profiles,
    defaultProfileId: opts.defaultProfileId ?? opts.profiles[0]?.id ?? '',
  })
}
