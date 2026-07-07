import type { WorkflowDef, RunState, NodeRunState, NodeId, NodeOutput, OrchestratorEvent, EdgeCondition, WorkflowNode, ParallelNode, MergeStrategy } from '@hip/protocol'

const TEMPLATE_RE = /\{\{\s*([^}\s]+)\s*\}\}/g

export function initRunState(def: WorkflowDef, runId: string): RunState {
  const nodes: Record<NodeId, NodeRunState> = {}
  const entry = new Set(def.entry)

  const initNode = (n: WorkflowNode) => {
    if (n.type === 'parallel') {
      for (const child of n.nodes) initNode(child)
    }
    nodes[n.id] = { status: entry.has(n.id) ? 'ready' : 'pending' }
  }

  for (const n of def.nodes) initNode(n)
  return { runId, workflowId: def.id, status: 'running', nodes }
}

export function readyNodes(state: RunState): NodeId[] {
  return Object.entries(state.nodes).filter(([, s]) => s.status === 'ready').map(([id]) => id)
}

function conditionHolds(when: EdgeCondition | undefined, out: NodeOutput | undefined): boolean {
  if (!when || when.kind === 'always') return true
  const text = out?.text ?? ''
  if (when.kind === 'contains') return text.includes(when.value ?? '')
  if (when.kind === 'equals') return text === (when.value ?? '')
  return false
}
type EdgeState = 'active' | 'dead' | 'unresolved'
function edgeState(def: WorkflowDef, state: RunState, from: NodeId, when: EdgeCondition | undefined): EdgeState {
  const s = state.nodes[from]
  if (s.status === 'succeeded') return conditionHolds(when, s.output) ? 'active' : 'dead'
  if (s.status === 'failed' || s.status === 'skipped' || s.status === 'cancelled') return 'dead'
  return 'unresolved'
}

/** 收集 ParallelNode 所有子孙节点的 id。 */
function collectChildIds(n: ParallelNode): NodeId[] {
  const ids: NodeId[] = []
  for (const child of n.nodes) {
    ids.push(child.id)
    if (child.type === 'parallel') ids.push(...collectChildIds(child))
  }
  return ids
}

/** 根据 merge 策略决定 ParallelNode 的终态。 */
function resolveParallelMerge(
  strategy: MergeStrategy,
  childStatuses: string[]
): NodeRunState {
  const succeeded = childStatuses.filter(s => s === 'succeeded').length
  const total = childStatuses.length

  switch (strategy) {
    case 'all':
      return succeeded === total
        ? { status: 'succeeded' }
        : { status: 'failed' }
    case 'any':
      return succeeded > 0
        ? { status: 'succeeded' }
        : { status: 'failed' }
    case 'vote':
      return succeeded > total / 2
        ? { status: 'succeeded' }
        : { status: 'failed' }
  }
}

/** 把所有 pending 节点按 join 语义推进到 ready/skipped,直到不动点(skip 会级联)。
 *  ParallelNode 通过收集子孙节点状态 + merge 策略独立于边图解析。 */
function propagate(def: WorkflowDef, state: RunState): RunState {
  let changed = true
  while (changed) {
    changed = false
    for (const n of def.nodes) {
      if (state.nodes[n.id].status !== 'pending') continue

      if (n.type === 'parallel') {
        const parNode = n as ParallelNode
        const childIds = collectChildIds(parNode)
        const statuses = childIds.map(id => state.nodes[id]?.status ?? 'pending')
        const allResolved = statuses.every(s =>
          ['succeeded', 'failed', 'skipped', 'cancelled'].includes(s))

        if (!allResolved) continue

        const next = resolveParallelMerge(parNode.mergeStrategy, statuses)
        state.nodes[n.id] = next
        changed = true
        continue
      }

      // 原有逻辑: 基于 incoming edges 的 join 语义
      const incoming = def.edges.filter((e) => e.to === n.id)
      if (incoming.length === 0) continue
      const states = incoming.map((e) => edgeState(def, state, e.from, e.when))
      if (states.some((s) => s === 'unresolved')) continue
      const next: NodeRunState = states.some((s) => s === 'active') ? { status: 'ready' } : { status: 'skipped' }
      state.nodes[n.id] = next
      changed = true
    }
  }
  return state
}

export function reduce(state: RunState, def: WorkflowDef, event: OrchestratorEvent): RunState {
  const s: RunState = { ...state, nodes: { ...state.nodes } }
  switch (event.type) {
    case 'run:started': s.status = 'running'; break
    case 'node:started': s.nodes[event.nodeId] = { ...s.nodes[event.nodeId], status: 'running' }; break
    case 'node:succeeded':
      s.nodes[event.nodeId] = { status: 'succeeded', output: event.output }
      propagate(def, s); break
    case 'node:failed':
      s.nodes[event.nodeId] = { status: 'failed', error: event.error }
      s.status = 'failed'; break // fail-fast
    case 'node:skipped':
      s.nodes[event.nodeId] = { status: 'skipped' }
      propagate(def, s); break
    case 'run:cancelled':
      s.status = 'cancelled'
      for (const id of Object.keys(s.nodes)) if (s.nodes[id].status === 'running') s.nodes[id] = { ...s.nodes[id], status: 'cancelled' }
      break
    case 'run:finished': s.status = event.status; break
  }
  return s
}

/** 用上游产物 + 运行输入渲染 inputTemplate。 */
export function resolveInput(node: WorkflowNode, state: RunState, runInputs?: NodeOutput): NodeOutput {
  const text = node.inputTemplate.replace(TEMPLATE_RE, (_m, ref: string) => {
    if (ref === 'input') return runInputs?.text ?? ''
    if (ref.startsWith('input.')) { const k = ref.slice('input.'.length); const d = runInputs?.data as Record<string, unknown> | undefined; return String(d?.[k] ?? '') }
    return state.nodes[ref]?.output?.text ?? ''
  })
  return { text }
}
