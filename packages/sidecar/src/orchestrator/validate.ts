import type { WorkflowDef, NodeId } from '@hip/protocol'
import type { AgentRegistry } from './registry.js'

export type ValidationCode = 'unknown-agent' | 'dangling-edge' | 'cycle' | 'unreachable' | 'bad-template-ref'
export interface ValidationError {
  code: ValidationCode
  detail: string
}

const TEMPLATE_RE = /\{\{\s*([^}\s]+)\s*\}\}/g

export function validateWorkflow(def: WorkflowDef, registry: AgentRegistry): ValidationError[] {
  const errors: ValidationError[] = []
  const ids = new Set(def.nodes.map((n) => n.id))

  // 1. unknown-agent (only check agent-type nodes)
  for (const n of def.nodes) {
    if ('agentId' in n && !registry.has(n.agentId)) errors.push({ code: 'unknown-agent', detail: `${n.id} → ${n.agentId}` })
  }

  // 2. dangling-edge
  for (const e of def.edges) {
    if (!ids.has(e.from)) errors.push({ code: 'dangling-edge', detail: `from ${e.from}` })
    if (!ids.has(e.to)) errors.push({ code: 'dangling-edge', detail: `to ${e.to}` })
  }

  // adjacency (仅用合法端点)
  const adj = new Map<NodeId, NodeId[]>()
  for (const id of ids) adj.set(id, [])
  for (const e of def.edges) if (ids.has(e.from) && ids.has(e.to)) adj.get(e.from)!.push(e.to)

  // 3. cycle (DFS 三色)
  const color = new Map<NodeId, 0 | 1 | 2>() // 0 white 1 grey 2 black
  for (const id of ids) color.set(id, 0)
  let hasCycle = false
  const dfs = (u: NodeId) => {
    color.set(u, 1)
    for (const v of adj.get(u) ?? []) {
      if (color.get(v) === 1) {
        hasCycle = true
        return
      }
      if (color.get(v) === 0) {
        dfs(v)
        if (hasCycle) return
      }
    }
    color.set(u, 2)
  }
  for (const id of ids)
    if (color.get(id) === 0) {
      dfs(id)
      if (hasCycle) break
    }
  if (hasCycle) errors.push({ code: 'cycle', detail: 'graph has a cycle' })

  // 4. entry 合法 + 可达 (有环时跳过可达判定避免误报)
  for (const en of def.entry) if (!ids.has(en)) errors.push({ code: 'dangling-edge', detail: `entry ${en}` })
  const indeg = new Map<NodeId, number>()
  for (const id of ids) indeg.set(id, 0)
  for (const e of def.edges) if (ids.has(e.to)) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1)
  for (const en of def.entry) if (ids.has(en) && (indeg.get(en) ?? 0) > 0) errors.push({ code: 'unreachable', detail: `entry ${en} has incoming edges` })
  if (!hasCycle) {
    const seen = new Set<NodeId>()
    const q = def.entry.filter((e) => ids.has(e))
    while (q.length) {
      const u = q.shift()!
      if (seen.has(u)) continue
      seen.add(u)
      for (const v of adj.get(u) ?? []) q.push(v)
    }
    for (const id of ids) if (!seen.has(id)) errors.push({ code: 'unreachable', detail: `${id} not reachable from entry` })
  }

  // 5. bad-template-ref:{{x}} 必须是 input / input.* / 当前节点的祖先
  // 祖先 = 反向可达。先建反图。
  const radj = new Map<NodeId, NodeId[]>()
  for (const id of ids) radj.set(id, [])
  for (const e of def.edges) if (ids.has(e.from) && ids.has(e.to)) radj.get(e.to)!.push(e.from)
  const ancestorsOf = (n: NodeId): Set<NodeId> => {
    const seen = new Set<NodeId>()
    const q = [...(radj.get(n) ?? [])]
    while (q.length) {
      const u = q.shift()!
      if (seen.has(u)) continue
      seen.add(u)
      for (const p of radj.get(u) ?? []) q.push(p)
    }
    return seen
  }
  for (const n of def.nodes) {
    if (!('inputTemplate' in n)) continue
    const anc = hasCycle ? null : ancestorsOf(n.id)
    for (const m of n.inputTemplate.matchAll(TEMPLATE_RE)) {
      const ref = m[1]
      if (ref === 'input' || ref.startsWith('input.')) continue
      if (!ids.has(ref)) {
        errors.push({ code: 'bad-template-ref', detail: `${n.id}: {{${ref}}} 不是节点也不是 input` })
        continue
      }
      if (anc && !anc.has(ref)) errors.push({ code: 'bad-template-ref', detail: `${n.id}: {{${ref}}} 不是上游` })
    }
  }
  return errors
}
