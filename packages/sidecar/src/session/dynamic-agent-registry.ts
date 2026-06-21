/**
 * Dynamic agent registry + enhanced workflow runner.
 *
 * Provides a runtime registry of pre-compiled agents and a workflow executor
 * that can spawn agents dynamically. Static DAG support is preserved: nodes
 * without `dynamic: true` continue to delegate to a fallback AgentRunner by
 * `agentId`.
 */
import { AIMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages'
import type { AgentId, NodeId, NodeOutput, RunState, WorkflowDef } from '@hip/protocol'
import type { AgentRunner, AgentRunRequest } from '../orchestrator/ports.js'
import { runWorkflow } from '../orchestrator/executor.js'

/** A pre-compiled agent that can be invoked with messages. */
export interface CompiledAgent {
  name: string
  invoke(
    input: { messages: BaseMessage[] },
    config: { configurable: unknown; signal?: AbortSignal },
  ): Promise<{ messages: BaseMessage[] }>
}

/** Runtime registry of pre-compiled agents with a hard cap on registered agents. */
export class DynamicAgentRegistry {
  private readonly agents = new Map<string, CompiledAgent>()

  constructor(private readonly maxActive = 20) {}

  /** Register a compiled agent under a unique name. Throws if the registry is full. */
  register(name: string, agent: CompiledAgent): void {
    if (this.agents.size >= this.maxActive && !this.agents.has(name)) {
      throw new Error(`Dynamic agent registry is full (max ${this.maxActive})`)
    }
    this.agents.set(name, agent)
  }

  /** Remove a registered agent. */
  unregister(name: string): void {
    this.agents.delete(name)
  }

  /** Look up a registered agent by name. */
  lookup(name: string): CompiledAgent | undefined {
    return this.agents.get(name)
  }

  /** List all registered agent names. */
  list(): string[] {
    return [...this.agents.keys()]
  }

  /** Current number of registered agents (never exceeds maxActive). */
  get activeCount(): number {
    return this.agents.size
  }
}

/** Workflow node that can either dispatch to a static agentId or spawn a dynamic agent. */
export interface DynamicWorkflowNode {
  id: NodeId
  agentId?: AgentId
  dynamic?: boolean
  dynamicAgentName?: string
  inputTemplate: string
}

/** Workflow definition whose nodes may be dynamic. */
export interface DynamicWorkflowDef extends Omit<WorkflowDef, 'nodes'> {
  nodes: DynamicWorkflowNode[]
}

export interface DynamicRunWorkflowOpts {
  runId: string
  runInputs?: NodeOutput
  signal: AbortSignal
  maxConcurrency?: number
}

/** Extract the last assistant message's text content (string or text blocks). */
function lastAiText(messages: BaseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!(m instanceof AIMessage)) continue
    if (typeof m.content === 'string') return m.content
    if (Array.isArray(m.content)) {
      return m.content
        .filter(
          (b): b is { type: 'text'; text: string } =>
            typeof b === 'object' && b !== null && 'type' in b && b.type === 'text' && 'text' in b && typeof b.text === 'string',
        )
        .map((b) => b.text)
        .join('')
    }
  }
  return ''
}

/** AgentRunner that routes dynamic nodes through the registry and static nodes to a fallback. */
class DynamicAgentRunner implements AgentRunner {
  constructor(
    private readonly registry: DynamicAgentRegistry,
    private readonly fallback: AgentRunner,
    private readonly nodeById: ReadonlyMap<NodeId, DynamicWorkflowNode>,
  ) {}

  async run(req: AgentRunRequest, signal: AbortSignal): Promise<NodeOutput> {
    const node = this.nodeById.get(req.nodeId)
    if (!node) throw new Error(`node not found: ${req.nodeId}`)

    if (node.dynamic) {
      const name = node.dynamicAgentName
      if (!name) throw new Error('dynamic node missing dynamicAgentName')
      const agent = this.registry.lookup(name)
      if (!agent) throw new Error('agent not registered')
      const result = await agent.invoke({ messages: [new HumanMessage(req.input.text)] }, { configurable: {}, signal })
      return { text: lastAiText(result.messages) }
    }

    const agentId = node.agentId ?? req.agentId
    if (!agentId) throw new Error('static node missing agentId')
    return this.fallback.run({ ...req, agentId }, signal)
  }
}

/**
 * Run a workflow that supports both static agent nodes and dynamic agent spawning.
 *
 * - Static nodes (`dynamic` absent or false) delegate to `fallback` using `agentId`.
 * - Dynamic nodes look up `dynamicAgentName` in `registry` and invoke it.
 * - Unknown dynamic agents produce a graceful node failure with "agent not registered".
 */
export async function runDynamicWorkflow(
  def: DynamicWorkflowDef,
  registry: DynamicAgentRegistry,
  fallback: AgentRunner,
  opts: DynamicRunWorkflowOpts,
): Promise<RunState> {
  const nodeById = new Map(def.nodes.map((n) => [n.id, n]))
  const runner = new DynamicAgentRunner(registry, fallback, nodeById)

  const staticDef: WorkflowDef = {
    ...def,
    nodes: def.nodes.map((n) => ({
      id: n.id,
      type: 'agent' as const,
      agentId: n.agentId ?? '',
      inputTemplate: n.inputTemplate,
    })),
  }

  return runWorkflow(staticDef, { agentRunner: runner }, opts)
}
