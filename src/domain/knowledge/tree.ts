import type { KnowledgeNode } from './types'
import { isKnowledgeId } from './ids'

export type ParentKey = string | null

export function buildChildrenMap(nodes: KnowledgeNode[]): Map<ParentKey, KnowledgeNode[]> {
  const map = new Map<ParentKey, KnowledgeNode[]>()
  for (const n of nodes) {
    const key = n.parentId
    const list = map.get(key)
    if (list) list.push(n)
    else map.set(key, [n])
  }
  for (const list of map.values()) {
    list.sort(compareNodes)
  }
  return map
}

function compareNodes(a: KnowledgeNode, b: KnowledgeNode): number {
  if (a.order !== b.order) return a.order - b.order
  return a.title.localeCompare(b.title)
}

export function listChildren(nodes: KnowledgeNode[], parentId: string | null): KnowledgeNode[] {
  return nodes.filter((n) => n.parentId === parentId).sort(compareNodes)
}

/** Ancestor chain root → node (inclusive), by id — safe with duplicate titles. */
export function getPath(nodes: KnowledgeNode[], nodeId: string): KnowledgeNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const chain: KnowledgeNode[] = []
  let cur = byId.get(nodeId)
  const seen = new Set<string>()
  while (cur) {
    if (seen.has(cur.id)) break
    seen.add(cur.id)
    chain.unshift(cur)
    if (cur.parentId == null) break
    cur = byId.get(cur.parentId)
  }
  return chain
}

export function getPathTitles(nodes: KnowledgeNode[], nodeId: string): string[] {
  return getPath(nodes, nodeId).map((n) => n.title)
}

/**
 * Visible set for tree filter: title matches ∪ ancestors of matches.
 * Empty query returns null (caller shows full tree).
 */
export function filterTreeVisible(
  nodes: KnowledgeNode[],
  query: string,
): Set<string> | null {
  const q = query.trim().toLowerCase()
  if (!q) return null
  const matches = filterNodesByTitle(nodes, q)
  const visible = new Set<string>()
  const byId = new Map(nodes.map((n) => [n.id, n]))
  for (const m of matches) {
    let cur: KnowledgeNode | undefined = m
    const seen = new Set<string>()
    while (cur) {
      if (seen.has(cur.id)) break
      seen.add(cur.id)
      visible.add(cur.id)
      if (cur.parentId == null) break
      cur = byId.get(cur.parentId)
    }
  }
  return visible
}

export function insertNode(nodes: KnowledgeNode[], node: KnowledgeNode): KnowledgeNode[] {
  return [...nodes, node]
}

export function renameNode(
  nodes: KnowledgeNode[],
  id: string,
  title: string,
  updatedAt = Date.now(),
): KnowledgeNode[] {
  return nodes.map((n) => (n.id === id ? { ...n, title, updatedAt } : n))
}

export function removeNodeSubtree(
  nodes: KnowledgeNode[],
  id: string,
): { nodes: KnowledgeNode[]; removedDocIds: string[] } {
  const toRemove = new Set<string>()
  const walk = (target: string) => {
    toRemove.add(target)
    for (const n of nodes) {
      if (n.parentId === target) walk(n.id)
    }
  }
  walk(id)

  const removedDocIds = nodes
    .filter((n) => toRemove.has(n.id) && n.kind === 'doc')
    .map((n) => n.id)
  return {
    nodes: nodes.filter((n) => !toRemove.has(n.id)),
    removedDocIds,
  }
}

export function nextOrder(nodes: KnowledgeNode[], parentId: string | null): number {
  const children = nodes.filter((n) => n.parentId === parentId)
  if (children.length === 0) return 0
  return Math.max(...children.map((n) => n.order)) + 1
}

/** True if `maybeDescendantId` is `ancestorId` or under it. */
export function isUnderSubtree(
  nodes: KnowledgeNode[],
  ancestorId: string,
  maybeDescendantId: string,
): boolean {
  if (ancestorId === maybeDescendantId) return true
  const byId = new Map(nodes.map((n) => [n.id, n]))
  let cur: string | null | undefined = maybeDescendantId
  const seen = new Set<string>()
  while (cur) {
    if (cur === ancestorId) return true
    if (seen.has(cur)) break
    seen.add(cur)
    cur = byId.get(cur)?.parentId
  }
  return false
}

/**
 * Move node under newParentId at sibling index `toIndex` (0-based among new siblings).
 * Dropping onto a doc: caller passes that doc's parentId and toIndex after the doc.
 */
export function moveNode(
  nodes: KnowledgeNode[],
  id: string,
  newParentId: string | null,
  toIndex?: number,
  now = Date.now(),
): KnowledgeNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const node = byId.get(id)
  if (!node) throw new Error(`missing node ${id}`)
  if (newParentId === id) throw new Error('cannot parent to self')
  if (newParentId != null) {
    const parent = byId.get(newParentId)
    if (!parent || parent.kind !== 'folder') {
      throw new Error('newParentId must be a folder or null')
    }
    if (isUnderSubtree(nodes, id, newParentId)) {
      throw new Error('cannot move into own descendant')
    }
  }

  const oldParentId = node.parentId
  let next = nodes.map((n) =>
    n.id === id ? { ...n, parentId: newParentId, updatedAt: now } : { ...n },
  )

  const reindexSiblings = (
    parentId: string | null,
    insertId: string | null,
    insertAt: number | undefined,
  ) => {
    let kids = listChildren(next, parentId)
    if (insertId != null) {
      kids = kids.filter((k) => k.id !== insertId)
      const moved = next.find((n) => n.id === insertId)
      if (moved) {
        const idx =
          insertAt === undefined
            ? kids.length
            : Math.max(0, Math.min(insertAt, kids.length))
        kids = [...kids.slice(0, idx), moved, ...kids.slice(idx)]
      }
    }
    const orderById = new Map(kids.map((k, i) => [k.id, i] as const))
    next = next.map((n) => {
      if (n.parentId === parentId && orderById.has(n.id)) {
        return { ...n, order: orderById.get(n.id)! }
      }
      return n
    })
  }

  if (oldParentId !== newParentId) {
    reindexSiblings(oldParentId, null, undefined)
  }
  reindexSiblings(newParentId, id, toIndex)
  return next
}

/** Collect all doc ids under a node (including self if doc). */
export function collectDocIdsInSubtree(nodes: KnowledgeNode[], rootId: string): string[] {
  const ids: string[] = []
  const walk = (id: string) => {
    const n = nodes.find((x) => x.id === id)
    if (!n) return
    if (n.kind === 'doc') ids.push(n.id)
    for (const c of listChildren(nodes, id)) walk(c.id)
  }
  walk(rootId)
  return ids
}

export function filterNodesByTitle(nodes: KnowledgeNode[], query: string): KnowledgeNode[] {
  const q = query.trim().toLowerCase()
  if (!q) return nodes
  return nodes.filter((n) => n.title.toLowerCase().includes(q))
}

/** Unit-test / debug invariant checks. */
export function assertTreeInvariants(nodes: KnowledgeNode[]): void {
  const ids = new Set<string>()
  for (const n of nodes) {
    if (!isKnowledgeId(n.id)) throw new Error(`invalid id: ${n.id}`)
    if (ids.has(n.id)) throw new Error(`duplicate id: ${n.id}`)
    ids.add(n.id)
    if (n.kind !== 'folder' && n.kind !== 'doc') throw new Error(`invalid kind: ${n.kind}`)
  }
  for (const n of nodes) {
    if (n.parentId != null && !ids.has(n.parentId)) {
      throw new Error(`missing parent ${n.parentId} for ${n.id}`)
    }
  }
  // Cycle detection
  for (const n of nodes) {
    const seen = new Set<string>()
    let cur: string | null = n.id
    while (cur != null) {
      if (seen.has(cur)) throw new Error(`cycle at ${cur}`)
      seen.add(cur)
      const node = nodes.find((x) => x.id === cur)
      cur = node?.parentId ?? null
    }
  }
}
