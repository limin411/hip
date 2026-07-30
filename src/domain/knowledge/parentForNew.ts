import type { KnowledgeNode } from './types'

/**
 * Parent for toolbar / ⌘N / palette "new doc|folder|board".
 * Prefer tree keyboard focus: folder → under that folder; doc|board → sibling.
 * Else fall back to active leaf's parent; else space root (null).
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
  if (focus?.kind === 'doc' || focus?.kind === 'board') return focus.parentId
  const active = opts.activeDocId
    ? opts.nodes.find((n) => n.id === opts.activeDocId)
    : undefined
  return active?.parentId ?? null
}
