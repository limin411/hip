import type { AgentConfig } from '@hip/protocol'
import type { GraphEmit } from '../graph.js'
import { runManagedAgent } from '../internal-runner.js'
import { CHILD_MAX_STEPS } from '../loop-control.js'
import { createAgentProvider } from './index.js'
import { readAgentsConfig, resolveAgentModel, type ResolvedModel } from './registry.js'
import type { AgentProvider, ExternalAgentHooks } from './types.js'

/** Run one configured external agent's turn and return its final text.
 *  Shaped like the orchestrator's AgentRunner (agentId + task → text), but it also
 *  takes a live `emit` sink. A later orchestrator adapter is NOT trivial: it must
 *  bridge this `Promise<string>` to AgentRunner's `Promise<NodeOutput>` and supply a
 *  no-op `emit` (the DAG path has no streaming card to feed). */
export interface AgentInvoker {
  invoke(agentId: string, task: string, emit: GraphEmit, signal: AbortSignal, hooks?: ExternalAgentHooks): Promise<string>
}

/** Args handed to the internal-loop runner (a seam so tests can stub the loop). */
export interface RunInternalArgs {
  agentId: string
  resolved: ResolvedModel | null
  cwd: string
  prompt: string
  allowedTools?: string[]
  task: string
  emit: GraphEmit
  signal: AbortSignal
}

export interface InvokerDeps {
  readAgents?: () => AgentConfig[]
  createProvider?: (agent: AgentConfig, cwd: string, model: ResolvedModel | null) => AgentProvider
  resolveModel?: (agent: AgentConfig) => ResolvedModel | null
  runInternal?: (args: RunInternalArgs) => Promise<string>
}

export function createAgentInvoker(cwd: string, deps: InvokerDeps = {}): AgentInvoker {
  const readAgents = deps.readAgents ?? readAgentsConfig
  const createProvider = deps.createProvider ?? createAgentProvider
  const resolveModel = deps.resolveModel ?? resolveAgentModel
  const runInternal = deps.runInternal ?? ((a: RunInternalArgs) =>
    runManagedAgent({ resolved: a.resolved, cwd: a.cwd, prompt: a.prompt, allowedTools: a.allowedTools, task: a.task, emit: a.emit, signal: a.signal, childMaxSteps: CHILD_MAX_STEPS }))
  return {
    async invoke(agentId, task, emit, signal, hooks) {
      const agent = readAgents().find((a) => a.id === agentId && a.enabled)
      if (!agent) throw new Error(`unknown or disabled agent: ${agentId}`)

      if (agent.kind === 'internal') {
        // hip's own loop — no external provider, no token-teeing (runManagedAgent returns the final text).
        return runInternal({ agentId, resolved: resolveModel(agent), cwd, prompt: agent.prompt ?? '', allowedTools: agent.allowedTools, task, emit, signal })
      }

      const model = agent.acceptsModelConfig ? resolveModel(agent) : null
      const provider = createProvider(agent, cwd, model)
      let text = ''
      // Tee token deltas so we can return the final text while still forwarding
      // every event to the caller's sink (the dispatch tool-card).
      const teed: GraphEmit = {
        token: (d) => { text += d; emit.token(d) },
        reasoning: emit.reasoning,
        toolStarted: emit.toolStarted,
        toolFinished: emit.toolFinished,
        usage: emit.usage,
      }
      try {
        await provider.runTurn(task, teed, signal, hooks)
        return text
      } finally {
        provider.dispose()
      }
    },
  }
}
