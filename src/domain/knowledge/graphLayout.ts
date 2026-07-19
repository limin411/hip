/**
 * Lightweight layout for knowledge graph (no force-sim dependency).
 * Neighborhood: center + 1-hop ring. Full: multi-ring by BFS distance.
 */

export type GraphNodeIn = { id: string; title: string }
export type GraphEdgeIn = { from: string; to: string; kind: string }

export type LaidOutNode = GraphNodeIn & { x: number; y: number }
export type LaidOutEdge = GraphEdgeIn & { id: string }

export const GRAPH_FULL_CONFIRM_THRESHOLD = 500

/** 1-hop neighborhood around focus (undirected for layout). */
export function neighborhoodSubgraph(
  focusId: string,
  nodes: GraphNodeIn[],
  edges: GraphEdgeIn[],
): { nodes: GraphNodeIn[]; edges: GraphEdgeIn[] } {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  if (!byId.has(focusId)) {
    return { nodes: nodes.slice(0, 1), edges: [] }
  }
  const keep = new Set<string>([focusId])
  const subEdges: GraphEdgeIn[] = []
  for (const e of edges) {
    if (e.from === focusId || e.to === focusId) {
      keep.add(e.from)
      keep.add(e.to)
      subEdges.push(e)
    }
  }
  return {
    nodes: [...keep].map((id) => byId.get(id)!).filter(Boolean),
    edges: subEdges,
  }
}

/**
 * Place focus at origin; others on concentric circles by BFS distance.
 */
export function layoutGraph(
  nodes: GraphNodeIn[],
  edges: GraphEdgeIn[],
  focusId: string | null,
  opts?: { radius?: number },
): { nodes: LaidOutNode[]; edges: LaidOutEdge[] } {
  const radius = opts?.radius ?? 180
  if (nodes.length === 0) return { nodes: [], edges: [] }

  const focus = focusId && nodes.some((n) => n.id === focusId) ? focusId : nodes[0]!.id

  // Undirected adjacency for distance
  const adj = new Map<string, Set<string>>()
  for (const n of nodes) adj.set(n.id, new Set())
  for (const e of edges) {
    if (!adj.has(e.from) || !adj.has(e.to)) continue
    adj.get(e.from)!.add(e.to)
    adj.get(e.to)!.add(e.from)
  }

  const dist = new Map<string, number>()
  const q: string[] = [focus]
  dist.set(focus, 0)
  while (q.length) {
    const cur = q.shift()!
    const d = dist.get(cur) ?? 0
    for (const nb of adj.get(cur) ?? []) {
      if (dist.has(nb)) continue
      dist.set(nb, d + 1)
      q.push(nb)
    }
  }

  // Group by distance
  const rings = new Map<number, string[]>()
  for (const n of nodes) {
    const d = dist.get(n.id) ?? 99
    const list = rings.get(d) ?? []
    list.push(n.id)
    rings.set(d, list)
  }

  const pos = new Map<string, { x: number; y: number }>()
  pos.set(focus, { x: 0, y: 0 })

  for (const [d, ids] of [...rings.entries()].sort((a, b) => a[0] - b[0])) {
    if (d === 0) continue
    const r = radius * d
    const n = ids.length
    ids.forEach((id, i) => {
      const angle = (2 * Math.PI * i) / n - Math.PI / 2
      pos.set(id, { x: Math.cos(angle) * r, y: Math.sin(angle) * r })
    })
  }

  // Unreachable: place to the side
  let orphan = 0
  for (const n of nodes) {
    if (pos.has(n.id)) continue
    pos.set(n.id, { x: radius * 2 + (orphan % 5) * 120, y: Math.floor(orphan / 5) * 80 })
    orphan += 1
  }

  const laid: LaidOutNode[] = nodes.map((n) => ({
    ...n,
    x: pos.get(n.id)?.x ?? 0,
    y: pos.get(n.id)?.y ?? 0,
  }))

  const laidEdges: LaidOutEdge[] = edges.map((e, i) => ({
    ...e,
    id: `e-${e.from}-${e.to}-${e.kind}-${i}`,
  }))

  return { nodes: laid, edges: laidEdges }
}
