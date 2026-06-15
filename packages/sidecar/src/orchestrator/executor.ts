import type { WorkflowDef, RunState, NodeOutput, NodeId } from '@hip/protocol'
import type { OrchestratorPorts } from './ports.js'
import { initRunState, reduce, readyNodes, resolveInput } from './reduce.js'

export interface RunWorkflowOpts { runId: string; runInputs?: NodeOutput; signal: AbortSignal }

export async function runWorkflow(def: WorkflowDef, ports: OrchestratorPorts, opts: RunWorkflowOpts): Promise<RunState> {
  const sink = ports.eventSink
  let state = initRunState(def, opts.runId)
  const apply = (e: Parameters<typeof reduce>[2]) => { sink?.emit(e); state = reduce(state, def, e) }
  apply({ type: 'run:started' })

  const nodeById = new Map<NodeId, WorkflowDef['nodes'][number]>(def.nodes.map((n) => [n.id, n]))
  const inFlight = new Map<NodeId, Promise<{ id: NodeId; ok: boolean; out?: NodeOutput; err?: string }>>()

  const launch = () => {
    if (opts.signal.aborted) return
    for (const id of readyNodes(state)) {
      if (inFlight.has(id)) continue
      const node = nodeById.get(id)!
      const input = resolveInput(node, state, opts.runInputs)
      apply({ type: 'node:started', nodeId: id })
      const p = ports.agentRunner
        .run({ runId: opts.runId, nodeId: id, agentId: node.agentId, input }, opts.signal)
        .then((out) => ({ id, ok: true as const, out }))
        .catch((e) => ({ id, ok: false as const, err: e instanceof Error ? e.message : String(e) }))
      inFlight.set(id, p)
    }
  }

  launch()
  while (inFlight.size > 0) {
    if (opts.signal.aborted && state.status === 'running') apply({ type: 'run:cancelled' })
    const settled = await Promise.race(inFlight.values())
    inFlight.delete(settled.id)
    // abort 优先:在飞节点在取消信号下的拒绝(AbortError)算取消而非 node:failed。
    if (opts.signal.aborted && state.status === 'running') apply({ type: 'run:cancelled' })
    if (settled.ok) apply({ type: 'node:succeeded', nodeId: settled.id, output: settled.out! })
    else if (state.status === 'running') apply({ type: 'node:failed', nodeId: settled.id, error: settled.err! })
    if (state.status === 'running') launch() // 终态(failed/cancelled)则停止派发,排空在飞
  }

  if (state.status === 'running') {
    const final = Object.values(state.nodes).some((n) => n.status === 'failed') ? 'failed' : 'succeeded'
    apply({ type: 'run:finished', status: final })
  } else {
    apply({ type: 'run:finished', status: state.status })
  }
  ports.store && (await ports.store.saveRun(state))
  return state
}
