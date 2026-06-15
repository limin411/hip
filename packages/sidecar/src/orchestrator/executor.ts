import type { WorkflowDef, RunState, NodeOutput, NodeId } from '@hip/protocol'
import type { OrchestratorPorts } from './ports.js'
import { initRunState, reduce, readyNodes, resolveInput } from './reduce.js'

export interface RunWorkflowOpts { runId: string; runInputs?: NodeOutput; signal: AbortSignal }

export async function runWorkflow(def: WorkflowDef, ports: OrchestratorPorts, opts: RunWorkflowOpts): Promise<RunState> {
  const sink = ports.eventSink
  let state = initRunState(def, opts.runId)
  const apply = (e: Parameters<typeof reduce>[2]) => { sink?.emit(e); state = reduce(state, def, e) }
  // reduce 的 propagate() 会在 node:succeeded 里把级联的下游节点直接置为 skipped,
  // 这些转移不经过 apply,因此不入 eventSink。为让『仅凭事件流重建状态』的下游(WS 透传)
  // 与权威 RunState 一致(设计文档:每个转移都喂 eventSink),这里在 succeeded 落定后,
  // 为新近变为 skipped 的节点补发 node:skipped 事件。node:skipped 的 reduce 是幂等的
  // (再置 skipped + 再 propagate 到不动点),不会引入额外副作用。
  const emitNewlySkipped = (before: RunState) => {
    for (const id of Object.keys(state.nodes)) {
      if (state.nodes[id].status === 'skipped' && before.nodes[id]?.status !== 'skipped') {
        apply({ type: 'node:skipped', nodeId: id })
      }
    }
  }
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
    if (settled.ok) {
      const before = state
      apply({ type: 'node:succeeded', nodeId: settled.id, output: settled.out! })
      emitNewlySkipped(before) // propagate 级联出的 skip 也要进事件流
    } else if (state.status === 'running') apply({ type: 'node:failed', nodeId: settled.id, error: settled.err! })
    if (state.status === 'running') launch() // 终态(failed/cancelled)则停止派发,排空在飞
  }

  // 取消竞态归一:若 signal 在任何节点入飞之前(或 launch 早返回后)就已 aborted,
  // while 循环整体不进入,上面两处 run:cancelled 发射点都跑不到。此处兜底:仍为 running
  // 且已 abort,则统一报告为 cancelled,而非误判为 succeeded。
  if (opts.signal.aborted && state.status === 'running') apply({ type: 'run:cancelled' })

  if (state.status === 'running') {
    const final = Object.values(state.nodes).some((n) => n.status === 'failed') ? 'failed' : 'succeeded'
    apply({ type: 'run:finished', status: final })
  } else {
    apply({ type: 'run:finished', status: state.status })
  }
  ports.store && (await ports.store.saveRun(state))
  return state
}
