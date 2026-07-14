import type { KnowledgeNode } from './types'

/**
 * Parent for toolbar / ⌘N / palette "new doc|folder".
 * Prefer tree keyboard focus: folder → under that folder; doc → sibling of that doc.
 * Else fall back to active doc's parent; else space root (null).
 */
export function resolveParentForNew(opts: {
  treeFocusId: string | null
  activeDocId: string | null
  nodes: KnowledgeNode[]
}): string | null {
  const focus = opts.treeFocusId
    ? opts.nodes.find((n) => n.id === opts.treeFocusId)
    : undefined
  if (focus?.kind === 'folder') return focus.id
  if (focus?.kind === 'doc') return focus.parentId
  const active = opts.activeDocId
    ? opts.nodes.find((n) => n.id === opts.activeDocId)
    : undefined
  return active?.parentId ?? null
}
