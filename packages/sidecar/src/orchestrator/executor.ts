import type { WorkflowDef, RunState, NodeOutput, NodeId, OrchestratorEvent } from '@hip/protocol'
import type { OrchestratorPorts } from './ports.js'
import { initRunState, reduce, readyNodes, resolveInput } from './reduce.js'
import { launchResolvedNode } from './node-runner.js'
import { assertSupportedWorkflowNodes } from './validate.js'

export interface RunWorkflowOpts {
  runId: string
  runInputs?: NodeOutput
  signal: AbortSignal
  maxConcurrency?: number
  /** Working directory for verification gates (typecheck/lint/test/script). */
  cwd?: string
  sessionId?: string
}

export async function runWorkflow(def: WorkflowDef, ports: OrchestratorPorts, opts: RunWorkflowOpts): Promise<RunState> {
  // C-validate: hard-reject tool/human before init (closes skip→ready→succeeded stranding).
  // Registry-free — does not run unknown-agent checks (session agentIds are dynamic).
  assertSupportedWorkflowNodes(def)

  const sink = ports.eventSink
  let state = initRunState(def, opts.runId)
  const apply = async (e: OrchestratorEvent) => {
    sink?.emit(e)
    state = reduce(state, def, e)
    // Auto-persist after every reduce when a store is configured
    await ports.store?.saveRun(state, { sessionId: opts.sessionId })
    ports.store?.appendEvent?.(opts.runId, e)
  }
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
    const maxCon = opts.maxConcurrency ?? 5
    for (const id of readyNodes(state)) {
      if (inFlight.size >= maxCon) break
      if (inFlight.has(id)) continue
      const node = nodeById.get(id)!
      // Agent + gate nodes are executable; other types fail closed inside launchResolvedNode.
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
    if (opts.signal.aborted && state.status === 'running') apply({ type: 'run:cancelled' })
    const settled = await Promise.race(inFlight.values())
    inFlight.delete(settled.id)
    // abort 优先:在飞节点在取消信号下的拒绝(AbortError)算取消而非 node:failed。
    if (opts.signal.aborted && state.status === 'running') apply({ type: 'run:cancelled' })
    if (settled.ok) {
      const before = state
      apply({ type: 'node:succeeded', nodeId: settled.id, output: settled.out! })
      emitNewlySkipped(before) // propagate 级联出的 skip 也要进事件流
    } else if (state.status !== 'cancelled') {
      // 该节点的拒绝必须落定为 node:failed,使其 NodeRunState 离开 'running'。
      // 关键的并发 fail-fast:扇出 a→b,a→c 且 b、c 都抛错时,b 的 node:failed 已把
      // run.status 置 'failed';若此处仍只在 status==='running' 时发射,c 的拒绝会被吞,
      // c 的节点态永久停在 'running' —— 终态快照自相矛盾(status='failed' 却有节点仍 running)。
      // node:failed 的 reduce 幂等地把节点置 failed + run.status 置 failed,重复无害。
      // 仅在已 'cancelled' 时跳过:run:cancelled 已把在飞节点归一为 'cancelled',
      // 取消下的拒绝(AbortError)不应被改写成 failed。
      apply({ type: 'node:failed', nodeId: settled.id, error: settled.err! })
    }
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
  return state
}
