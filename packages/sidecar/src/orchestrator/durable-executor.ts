import type {
  WorkflowDef,
  RunState,
  NodeId,
  NodeOutput,
  OrchestratorEvent,
} from '@hip/protocol'
import type { OrchestratorPorts } from './ports.js'
import { initRunState, reduce, readyNodes, resolveInput } from './reduce.js'
import type { SqliteWorkflowStore } from '../persistence/workflow-store.js'
import type { Blackboard } from './blackboard.js'
import { launchResolvedNode } from './node-runner.js'

export interface DurableRunOpts {
  runId: string
  runInputs?: NodeOutput
  signal: AbortSignal
  maxConcurrency?: number
  /** Shared per-workflow key-value store; agents access their run's namespace. */
  blackboard?: Blackboard
  /** Working directory for verification gates. */
  cwd?: string
  sessionId?: string
}

export class DurableExecutor {
  constructor(private store: SqliteWorkflowStore) {}

  async runWorkflow(
    def: WorkflowDef,
    ports: OrchestratorPorts,
    opts: DurableRunOpts,
  ): Promise<RunState> {
    // Attempt to recover an existing run
    const existing = await this.store.loadRun(opts.runId)
    let state: RunState

    if (existing && existing.status === 'running') {
      // Resume execution: already-completed nodes are skipped
      state = existing
    } else if (existing) {
      return existing // Already terminal, return as-is
    } else {
      state = initRunState(def, opts.runId)
      await this.store.saveDef(def)
    }

    const sink = ports.eventSink

    const apply = (event: OrchestratorEvent) => {
      sink?.emit(event)
      state = reduce(state, def, event)
      // Persist run state first so the workflow_runs row exists
      // before appendEvent references it via FK.
      this.store.saveRun(state)
      this.store.appendEvent(opts.runId, event)
    }

    // Only emit run:started on a fresh launch
    if (!existing) apply({ type: 'run:started' })

    const nodeById = new Map(def.nodes.map((n) => [n.id, n]))
    const inFlight = new Map<
      NodeId,
      Promise<{
        id: NodeId
        ok: boolean
        out?: NodeOutput
        err?: string
      }>
    >()

    const launch = () => {
      if (opts.signal.aborted) return
      const maxCon = opts.maxConcurrency ?? 5
      for (const id of readyNodes(state)) {
        // Skip nodes already completed (resume scenario)
        const currentStatus = state.nodes[id]?.status
        if (
          currentStatus === 'succeeded' ||
          currentStatus === 'failed'
        )
          continue
        if (inFlight.size >= maxCon) break
        if (inFlight.has(id)) continue

        const node = nodeById.get(id)!
        if (node.type !== 'agent' && node.type !== 'gate') continue
        const input = resolveInput(node, state, opts.runInputs)
        apply({ type: 'node:started', nodeId: id })

        const p = launchResolvedNode(node, ports, {
          runId: opts.runId,
          signal: opts.signal,
          input,
          cwd: opts.cwd,
          sessionId: opts.sessionId,
        })

        inFlight.set(id, p)
      }
    }

    launch()

    while (inFlight.size > 0) {
      if (opts.signal.aborted && state.status === 'running')
        apply({ type: 'run:cancelled' })

      const settled = await Promise.race(inFlight.values())
      inFlight.delete(settled.id)

      if (opts.signal.aborted && state.status === 'running')
        apply({ type: 'run:cancelled' })

      if (settled.ok) {
        const before = { ...state }
        apply({
          type: 'node:succeeded',
          nodeId: settled.id,
          output: settled.out!,
        })
        // Emit cascaded skip events
        for (const nid of Object.keys(state.nodes)) {
          if (
            state.nodes[nid].status === 'skipped' &&
            before.nodes[nid]?.status !== 'skipped'
          ) {
            apply({ type: 'node:skipped', nodeId: nid })
          }
        }
      } else if (state.status !== 'cancelled') {
        apply({
          type: 'node:failed',
          nodeId: settled.id,
          error: settled.err!,
        })
      }

      if (state.status === 'running') launch()
    }

    if (opts.signal.aborted && state.status === 'running')
      apply({ type: 'run:cancelled' })

    const finalStatus: 'succeeded' | 'failed' = Object.values(
      state.nodes,
    ).some((n) => n.status === 'failed')
      ? 'failed'
      : 'succeeded'

    if (state.status === 'running') {
      apply({ type: 'run:finished', status: finalStatus })
    } else {
      apply({ type: 'run:finished', status: state.status })
    }

    return state
  }

  async resumeWorkflow(
    runId: string,
    ports: OrchestratorPorts,
    signal: AbortSignal,
  ): Promise<RunState> {
    const saved = await this.store.loadRun(runId)
    if (!saved) throw new Error(`Run ${runId} not found`)
    if (saved.status !== 'running') return saved

    const def = await this.store.loadDef(saved.workflowId)
    if (!def) throw new Error(`Workflow def ${saved.workflowId} not found`)

    return this.runWorkflow(def, ports, { runId, signal })
  }
}
