/**
 * Block drag drop-position helpers (Phase A top-level + Phase B into).
 */
import type { Node as PMNode } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'
import { blockAt, topLevelBlockAt } from './blockOps'

export type DropKind = 'before' | 'after' | 'into'

export type DropTarget = {
  /** Absolute doc position to insert the moved node (before mapping). */
  insertPos: number
  /** Client Y for drop line (viewport). */
  clientY: number
  /** Client X for into indicator (optional). */
  clientX?: number
  /** Index in doc.children after which we insert (-1 = before first). Top-level only. */
  afterIndex: number
  kind: DropKind
  /** Height hint for into bar (px). */
  intoHeight?: number
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
  return findDropTargetV2(view, clientY, sourceFrom, sourceTo, { allowInto: false })
}

export type FindDropOpts = {
  /** Enable drop-into list / blockquote (Phase B). */
  allowInto?: boolean
  clientX?: number
}

/**
 * Drop target v2: before/after top-level gaps; optional into list/blockquote.
 */
export function findDropTargetV2(
  view: EditorView,
  clientY: number,
  sourceFrom: number,
  sourceTo: number,
  opts: FindDropOpts = {},
): DropTarget | null {
  const doc = view.state.doc
  if (doc.childCount === 0) return null

  const gaps: DropTarget[] = []
  let pos = 0
  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i)
    const from = pos
    const to = pos + child.nodeSize
    try {
      const coords = view.coordsAtPos(from)
      gaps.push({
        insertPos: from,
        clientY: coords.top,
        afterIndex: i - 1,
        kind: 'before',
      })
    } catch {
      // skip
    }

    // Into: mid-band of list / blockquote (not source)
    if (
      opts.allowInto &&
      !(from >= sourceFrom && to <= sourceTo) &&
      (child.type.name === 'bullet_list' ||
        child.type.name === 'ordered_list' ||
        child.type.name === 'blockquote')
    ) {
      try {
        const top = view.coordsAtPos(from)
        const bot = view.coordsAtPos(Math.max(from, to - 1))
        const midY = (top.top + bot.bottom) / 2
        const height = Math.max(16, bot.bottom - top.top)
        // Insert at end of container content
        const intoPos = to - 1
        gaps.push({
          insertPos: intoPos,
          clientY: midY,
          clientX: top.left + 12,
          afterIndex: i,
          kind: 'into',
          intoHeight: height,
        })
      } catch {
        // skip
      }
    }

    pos = to
  }
  try {
    const endPos = doc.content.size
    const coords = view.coordsAtPos(Math.max(0, endPos))
    gaps.push({
      insertPos: endPos,
      clientY: coords.bottom,
      afterIndex: doc.childCount - 1,
      kind: 'after',
    })
  } catch {
    // skip
  }

  if (gaps.length === 0) return null

  // Prefer non-into when distances are close (bias 8px against into)
  let best = gaps[0]
  let bestScore = Math.abs(clientY - best.clientY) + (best.kind === 'into' ? 8 : 0)
  for (let i = 1; i < gaps.length; i++) {
    const g = gaps[i]
    const score = Math.abs(clientY - g.clientY) + (g.kind === 'into' ? 8 : 0)
    if (score < bestScore) {
      best = g
      bestScore = score
    }
  }

  if (best.insertPos > sourceFrom && best.insertPos < sourceTo) {
    return null
  }

  return best
}

/**
 * Move node [sourceFrom, sourceTo) to insertPos (single transaction).
 */
export function moveBlock(
  view: EditorView,
  sourceFrom: number,
  sourceTo: number,
  insertPos: number,
): boolean {
  const { state } = view
  const node = state.doc.nodeAt(sourceFrom)
  if (!node || sourceFrom + node.nodeSize !== sourceTo) {
    const b = blockAt(state.doc, sourceFrom, { prefer: 'top' })
    if (!b) return false
    return moveBlock(view, b.from, b.to, insertPos)
  }

  if (insertPos === sourceFrom || insertPos === sourceTo) return false
  // Cannot insert inside self
  if (insertPos > sourceFrom && insertPos < sourceTo) return false

  let tr = state.tr
  if (insertPos > sourceTo) {
    tr = tr.delete(sourceFrom, sourceTo)
    const mapped = insertPos - (sourceTo - sourceFrom)
    tr = tr.insert(mapped, node)
  } else {
    tr = tr.insert(insertPos, node)
    const mappedFrom = sourceFrom + node.nodeSize
    const mappedTo = sourceTo + node.nodeSize
    tr = tr.delete(mappedFrom, mappedTo)
  }
  view.dispatch(tr.scrollIntoView())
  view.focus()
  return true
}

/** Alias for top-level move (Phase A API). */
export function moveTopLevelBlock(
  view: EditorView,
  sourceFrom: number,
  sourceTo: number,
  insertPos: number,
): boolean {
  return moveBlock(view, sourceFrom, sourceTo, insertPos)
}

/**
 * Move a contiguous top-level range [fromIndex, toIndex] to insertPos
 * (position before any delete mapping; must be outside the range).
 */
export function moveTopLevelRange(
  view: EditorView,
  fromIndex: number,
  toIndex: number,
  insertPos: number,
): boolean {
  const doc = view.state.doc
  if (fromIndex < 0 || toIndex >= doc.childCount || fromIndex > toIndex) return false
  let from = 0
  for (let i = 0; i < fromIndex; i++) from += doc.child(i).nodeSize
  let to = from
  const nodes: PMNode[] = []
  for (let i = fromIndex; i <= toIndex; i++) {
    const child = doc.child(i)
    nodes.push(child)
    to += child.nodeSize
  }
  if (insertPos > from && insertPos < to) return false
  if (insertPos === from || insertPos === to) return false

  let tr = view.state.tr
  const sliceSize = to - from
  if (insertPos > to) {
    tr = tr.delete(from, to)
    let mapped = insertPos - sliceSize
    for (const n of nodes) {
      tr = tr.insert(mapped, n)
      mapped += n.nodeSize
    }
  } else {
    let at = insertPos
    for (const n of nodes) {
      tr = tr.insert(at, n)
      at += n.nodeSize
    }
    const mappedFrom = from + (at - insertPos)
    const mappedTo = to + (at - insertPos)
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
  prefer: 'list_item' | 'top' = 'top',
): { from: number; to: number; node: PMNode } | null {
  const b = blockAt(doc, pos, { prefer })
  if (!b) return null
  return { from: b.from, to: b.to, node: b.node }
}

/** Resolve top-level only (tests / Phase A). */
export function resolveTopLevelSource(
  doc: PMNode,
  pos: number,
): { from: number; to: number; node: PMNode } | null {
  const b = topLevelBlockAt(doc, pos)
  if (!b) return null
  return { from: b.from, to: b.to, node: b.node }
}
