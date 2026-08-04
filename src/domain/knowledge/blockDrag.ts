/**
 * Top-level block drag drop-position helpers (R5 Gate A).
 */
import type { Node as PMNode } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'
import { topLevelBlockAt } from './blockOps'

export type DropTarget = {
  /** Absolute doc position to insert the moved node (before mapping). */
  insertPos: number
  /** Client Y for drop line (viewport). */
  clientY: number
  /** Index in doc.children after which we insert (-1 = before first). */
  afterIndex: number
}

/**
 * Given pointer Y, find a top-level gap to drop into.
 * Excludes the source block's interior.
 */
export function findDropTarget(
  view: EditorView,
  clientY: number,
  sourceFrom: number,
  sourceTo: number,
): DropTarget | null {
  const doc = view.state.doc
  if (doc.childCount === 0) return null

  const gaps: { insertPos: number; clientY: number; afterIndex: number }[] = []
  let pos = 0
  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i)
    const from = pos
    const to = pos + child.nodeSize
    // Gap before this child
    try {
      const coords = view.coordsAtPos(from)
      gaps.push({ insertPos: from, clientY: coords.top, afterIndex: i - 1 })
    } catch {
      // skip
    }
    pos = to
  }
  // Gap after last
  try {
    const endPos = doc.content.size
    const coords = view.coordsAtPos(Math.max(0, endPos))
    gaps.push({
      insertPos: endPos,
      clientY: coords.bottom,
      afterIndex: doc.childCount - 1,
    })
  } catch {
    // skip
  }

  if (gaps.length === 0) return null

  // Nearest gap by Y
  let best = gaps[0]
  let bestDist = Math.abs(clientY - best.clientY)
  for (let i = 1; i < gaps.length; i++) {
    const d = Math.abs(clientY - gaps[i].clientY)
    if (d < bestDist) {
      best = gaps[i]
      bestDist = d
    }
  }

  // Reject drops that land inside the source range (no-op / self)
  if (best.insertPos > sourceFrom && best.insertPos < sourceTo) {
    return null
  }
  // Drop immediately before source or after source is ok (may no-op later)

  return best
}

/**
 * Move top-level node [sourceFrom, sourceTo) to insertPos.
 * Returns false if no-op or invalid.
 */
export function moveTopLevelBlock(
  view: EditorView,
  sourceFrom: number,
  sourceTo: number,
  insertPos: number,
): boolean {
  const { state } = view
  const node = state.doc.nodeAt(sourceFrom)
  if (!node || sourceFrom + node.nodeSize !== sourceTo) {
    // Fallback: use topLevelBlockAt
    const b = topLevelBlockAt(state.doc, sourceFrom)
    if (!b) return false
    return moveTopLevelBlock(view, b.from, b.to, insertPos)
  }

  // No-op if same place
  if (insertPos === sourceFrom || insertPos === sourceTo) return false

  let tr = state.tr
  // Delete first when insert is after source (positions after delete shift)
  if (insertPos > sourceTo) {
    tr = tr.delete(sourceFrom, sourceTo)
    const mapped = insertPos - (sourceTo - sourceFrom)
    tr = tr.insert(mapped, node)
  } else {
    // insert before source
    tr = tr.insert(insertPos, node)
    const mappedFrom = sourceFrom + node.nodeSize
    const mappedTo = sourceTo + node.nodeSize
    tr = tr.delete(mappedFrom, mappedTo)
  }
  view.dispatch(tr.scrollIntoView())
  view.focus()
  return true
}

/** Resolve source block from grip mousedown pos. */
export function resolveSourceBlock(
  doc: PMNode,
  pos: number,
): { from: number; to: number; node: PMNode } | null {
  const b = topLevelBlockAt(doc, pos)
  if (!b) return null
  return { from: b.from, to: b.to, node: b.node }
}
