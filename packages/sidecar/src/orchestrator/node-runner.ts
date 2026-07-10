/**
 * Dispatch a single workflow node (agent or gate) for the orchestrator launch loop.
 */
import type { WorkflowDef, NodeId, NodeOutput } from '@hip/protocol'
import type { OrchestratorPorts } from './ports.js'
import { runGateNode } from './gate-runner.js'

export type NodeLaunchResult = {
  id: NodeId
  ok: boolean
  out?: NodeOutput
  err?: string
}

export interface NodeRunOpts {
  runId: string
  signal: AbortSignal
  /** Pre-resolved input (from resolveInput against live RunState). */
  input: NodeOutput
  /** Working directory for gate scripts (typecheck/lint/test). */
  cwd?: string
  sessionId?: string
}

/**
 * Launch helper used by executor loops that already resolved input from live RunState.
 * - `agent` → ports.agentRunner
 * - `gate` → registered VerificationGate via runGateNode
 * - other types → fail closed
 */
export function launchResolvedNode(
  node: WorkflowDef['nodes'][number],
  ports: OrchestratorPorts,
  opts: NodeRunOpts,
): Promise<NodeLaunchResult> {
  const id = node.id

  if (node.type === 'gate') {
    const ctx = {
      cwd: opts.cwd ?? process.cwd(),
      sessionId: opts.sessionId ?? opts.runId,
      runId: opts.runId,
    }
    return runGateNode(node, ctx)
      .then((result) => {
        if (result.passed) {
          return {
            id,
            ok: true as const,
            out: {
              text: `Gate "${node.gateKind}" passed`,
              data: result,
            },
          }
        }
        const detail =
          result.failures.map((f) => f.message).join('; ') || `Gate "${node.gateKind}" failed`
        return { id, ok: false as const, err: detail }
      })
      .catch((e) => ({
        id,
        ok: false as const,
        err: e instanceof Error ? e.message : String(e),
      }))
  }

  if (node.type === 'agent' && 'agentId' in node) {
    return ports.agentRunner
      .run(
        {
          runId: opts.runId,
          nodeId: id,
          agentId: node.agentId,
          input: opts.input,
        },
        opts.signal,
      )
      .then((out) => {
        // Empty text is not a successful deliverable — fail so the graph cannot
        // feed a blank plan into downstream nodes (e.g. planner → coder).
        if (!out?.text?.trim()) {
          return {
            id,
            ok: false as const,
            err: 'Agent produced empty output',
          }
        }
        return { id, ok: true as const, out }
      })
      .catch((e) => ({
        id,
        ok: false as const,
        err: e instanceof Error ? e.message : String(e),
      }))
  }

  return Promise.resolve({
    id,
    ok: false,
    err: `Unsupported workflow node type: ${(node as { type: string }).type}`,
  })
}
