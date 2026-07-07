import type {
  TeamConfig,
  TeamPipelineStep,
  TeamResult,
  TeamStepOutput,
  WorkflowDef,
  AgentNode,
  WorkflowEdge,
  NodeOutput,
} from '@hip/protocol'
import type { AgentRunner, OrchestratorPorts, OrchestratorEventSink, WorkflowStore } from '../../orchestrator/ports.js'
import { runWorkflow } from '../../orchestrator/executor.js'

// ──────────────────────────────────────────────────────────────────
// TeamDeps — external dependencies the TeamRunner needs to execute
// ──────────────────────────────────────────────────────────────────

export interface TeamDeps {
  /** An AgentRunner that dispatches each pipeline step. */
  agentRunner: AgentRunner
  /** Optional event sink for observing workflow events. */
  eventSink?: OrchestratorEventSink
  /** Optional workflow store for persistence. */
  store?: WorkflowStore
  /** Optional abort signal. When omitted the workflow runs without cancellation. */
  signal?: AbortSignal
}

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

const TEMPLATE_RE = /\{\{\s*(\S+)\s*\}\}/g

/**
 * Build a WorkflowDef from a TeamConfig and its pipeline.
 *
 * Each pipeline step becomes an AgentNode. Steps are linked sequentially
 * via edges. The first step is the workflow entry point.
 *
 * Template placeholders:
 *   - `{{input}}` — resolved to the team-level input
 *   - `{{<role>}}` — resolved to the output of the pipeline step assigned
 *     that role (first occurrence wins)
 */
function buildWorkflowDef(team: TeamConfig, pipeline: TeamPipelineStep[]): WorkflowDef {
  // Map roles to their step indices for template resolution
  const roleToNodeId = new Map<string, string>()
  for (let i = 0; i < pipeline.length; i++) {
    const step = pipeline[i]
    if (!roleToNodeId.has(step.role)) {
      roleToNodeId.set(step.role, `step-${i}`)
    }
  }

  // Build the agent node for each step, translating template references
  const nodes: AgentNode[] = pipeline.map((step, i) => {
    const nodeId = `step-${i}`
    // Resolve which agent runs this step: explicit agentId on the step, or
    // look up the team member whose role matches.
    const agentId =
      step.agentId ?? team.members.find((m) => m.role === step.role)?.agentId
    if (!agentId) {
      throw new Error(
        `No agent found for role "${step.role}" in team "${team.name}". ` +
          `Add a member with role "${step.role}" or set agentId on the pipeline step.`,
      )
    }

    // Translate role references to nodeId references
    const inputTemplate = step.inputTemplate.replace(
      TEMPLATE_RE,
      (_m: string, ref: string) => {
        if (ref === 'input') return '{{input}}'
        const targetNodeId = roleToNodeId.get(ref)
        if (targetNodeId) return `{{${targetNodeId}}}`
        // Keep unrecognised placeholders as-is (they may reference nodeIds
        // from a broader DAG or use custom templates).
        return `{{${ref}}}`
      },
    )

    return { id: nodeId, type: 'agent' as const, agentId, inputTemplate }
  })

  // Link steps sequentially
  const edges: WorkflowEdge[] = []
  for (let i = 0; i < pipeline.length - 1; i++) {
    edges.push({ from: `step-${i}`, to: `step-${i + 1}` })
  }

  return {
    id: team.id,
    name: team.name,
    nodes,
    edges,
    entry: nodes.length > 0 ? [nodes[0].id] : [],
  }
}

// ──────────────────────────────────────────────────────────────────
// TeamRunner
// ──────────────────────────────────────────────────────────────────

/**
 * Orchestrates execution of a configured agent team by converting the team's
 * pipeline into a WorkflowDef and dispatching it through the DAG orchestrator's
 * `runWorkflow`.
 *
 * Each pipeline step runs as an AgentNode. Steps execute in sequence, with each
 * step's `inputTemplate` resolved against the team-level input or the outputs
 * of earlier steps.
 *
 * Usage:
 * ```ts
 * const runner = new TeamRunner()
 * const result = await runner.run(myTeam, "Build a todo app", {
 *   agentRunner: myAgentRunner,
 * })
 * ```
 */
export class TeamRunner {
  /**
   * Execute a team's pipeline and return the aggregated result.
   *
   * @param team    The team definition (members + pipeline).
   * @param input   The team-level input string.
   * @param deps    External dependencies (at minimum an AgentRunner).
   */
  async run(team: TeamConfig, input: string, deps: TeamDeps): Promise<TeamResult> {
    const def = buildWorkflowDef(team, team.pipeline)
    const signal = deps.signal ?? new AbortController().signal
    const runInputs: NodeOutput = { text: input }

    const ports: OrchestratorPorts = {
      agentRunner: deps.agentRunner,
      store: deps.store,
      eventSink: deps.eventSink,
    }

    const runState = await runWorkflow(def, ports, {
      runId: `team-${team.id}-${Date.now()}`,
      runInputs,
      signal,
    })

    // Convert RunState to TeamResult
    const nodeIdOrder: string[] = team.pipeline.map((_, i) => `step-${i}`)
    const outputs: TeamStepOutput[] = nodeIdOrder.map((nodeId, i) => {
      const nodeState = runState.nodes[nodeId]
      const step = team.pipeline[i]
      const agentId = nodesById(def).get(nodeId)?.agentId ?? ''
      return {
        role: step?.role ?? nodeId,
        agentId,
        status: (nodeState?.status ?? 'pending') as TeamStepOutput['status'],
        output: nodeState?.output?.text ?? '',
        error: nodeState?.error,
      }
    })

    // finalOutput is the last succeeded step's output
    const succeeded = outputs.filter((o) => o.status === 'succeeded')
    return {
      success: runState.status === 'succeeded',
      outputs,
      finalOutput:
        succeeded.length > 0
          ? succeeded[succeeded.length - 1].output
          : '',
      stepCount: outputs.length,
    }
  }
}

function nodesById(def: WorkflowDef): Map<string, AgentNode> {
  const m = new Map<string, AgentNode>()
  for (const n of def.nodes) {
    if (n.type === 'agent') {
      m.set(n.id, n as AgentNode)
    }
  }
  return m
}
