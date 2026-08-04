/**
 * Block ops for Live gutter menu.
 * Pure ProseMirror helpers — no Milkdown/DOM.
 */
import { Fragment, type Node as PMNode } from '@milkdown/kit/prose/model'
import { NodeSelection, TextSelection, type Transaction } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'

export type BlockRef = {
  from: number
  to: number
  node: PMNode
  /** Index among siblings of the resolved parent. */
  index: number
  /** Depth of the block node (1 = top-level). */
  depth: number
}

export type BlockAtOpts = {
  /**
   * `list_item` — prefer nearest list_item when inside a list.
   * `top` — always depth-1 top-level block (default / Phase A).
   */
  prefer?: 'list_item' | 'top'
}

/** Resolve depth-1 top-level block containing `pos`. */
export function topLevelBlockAt(
  doc: PMNode,
  pos: number,
): BlockRef | null {
  return blockAt(doc, pos, { prefer: 'top' })
}

/**
 * Resolve nearest operable block at `pos`.
 * Phase B: prefer list_item when nested; else depth-1.
 */
export function blockAt(
  doc: PMNode,
  pos: number,
  opts: BlockAtOpts = {},
): BlockRef | null {
  const prefer = opts.prefer ?? 'top'
  try {
    const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)))

    if (prefer === 'list_item') {
      for (let d = $pos.depth; d > 0; d--) {
        if ($pos.node(d).type.name === 'list_item') {
          return {
            from: $pos.before(d),
            to: $pos.after(d),
            node: $pos.node(d),
            index: $pos.index(d - 1),
            depth: d,
          }
        }
      }
    }

    if ($pos.depth < 1) {
      const idx = $pos.index(0)
      if (idx < 0 || idx >= doc.childCount) return null
      const node = doc.child(idx)
      let from = 0
      for (let i = 0; i < idx; i++) from += doc.child(i).nodeSize
      return { from, to: from + node.nodeSize, node, index: idx, depth: 1 }
    }
    const from = $pos.before(1)
    const to = $pos.after(1)
    const node = $pos.node(1)
    const index = $pos.index(0)
    return { from, to, node, index, depth: 1 }
  } catch {
    return null
  }
}

/** Select the entire block as NodeSelection when possible. */
export function selectBlock(
  view: EditorView,
  blockFrom: number,
  opts?: BlockAtOpts,
): boolean {
  const block = blockAt(view.state.doc, blockFrom, opts ?? { prefer: 'top' })
  if (!block) return false
  try {
    const sel = NodeSelection.create(view.state.doc, block.from)
    view.dispatch(view.state.tr.setSelection(sel).scrollIntoView())
    view.focus()
    return true
  } catch {
    try {
      const sel = TextSelection.create(view.state.doc, block.from + 1)
      view.dispatch(view.state.tr.setSelection(sel).scrollIntoView())
      view.focus()
      return true
    } catch {
      return false
    }
  }
}

/** @deprecated use selectBlock */
export function selectTopLevelBlock(view: EditorView, blockFrom: number): boolean {
  return selectBlock(view, blockFrom, { prefer: 'top' })
}

/**
 * Delete block at from. If doc would be empty, leave one empty paragraph.
 */
export function deleteBlock(
  view: EditorView,
  blockFrom: number,
  opts?: BlockAtOpts,
): boolean {
  const block = blockAt(view.state.doc, blockFrom, opts ?? { prefer: 'top' })
  if (!block) return false
  const { state } = view
  let tr: Transaction = state.tr.delete(block.from, block.to)
  if (tr.doc.childCount === 0) {
    const para = state.schema.nodes.paragraph.create()
    tr = tr.insert(0, para)
    tr = tr.setSelection(TextSelection.create(tr.doc, 1))
  } else {
    const pos = Math.min(block.from, tr.doc.content.size)
    try {
      tr = tr.setSelection(TextSelection.near(tr.doc.resolve(pos)))
    } catch {
      // ignore
    }
  }
  view.dispatch(tr.scrollIntoView())
  view.focus()
  return true
}

/** @deprecated use deleteBlock */
export function deleteTopLevelBlock(view: EditorView, blockFrom: number): boolean {
  return deleteBlock(view, blockFrom, { prefer: 'top' })
}

/** Insert a copy of the block immediately after it. */
export function duplicateBlock(
  view: EditorView,
  blockFrom: number,
  opts?: BlockAtOpts,
): boolean {
  const block = blockAt(view.state.doc, blockFrom, opts ?? { prefer: 'top' })
  if (!block) return false
  const copy = block.node.copy(block.node.content)
  const tr = view.state.tr.insert(block.to, copy)
  view.dispatch(tr.scrollIntoView())
  view.focus()
  return true
}

/** @deprecated use duplicateBlock */
export function duplicateTopLevelBlock(view: EditorView, blockFrom: number): boolean {
  return duplicateBlock(view, blockFrom, { prefer: 'top' })
}

/** Insert empty paragraph before (dir=-1) or after (dir=1) the block. Returns new para pos. */
export function insertEmptyParagraphNear(
  view: EditorView,
  blockFrom: number,
  dir: -1 | 1,
  opts?: BlockAtOpts,
): number | null {
  const block = blockAt(view.state.doc, blockFrom, opts ?? { prefer: 'top' })
  if (!block) return null
  const para = view.state.schema.nodes.paragraph.create()
  const insertAt = dir < 0 ? block.from : block.to
  let tr = view.state.tr.insert(insertAt, para)
  const caret = insertAt + 1
  tr = tr.setSelection(TextSelection.create(tr.doc, caret))
  view.dispatch(tr.scrollIntoView())
  view.focus()
  return insertAt
}

/**
 * Delete a contiguous range of top-level blocks [fromIndex, toIndex] inclusive.
 */
export function deleteTopLevelRange(
  view: EditorView,
  fromIndex: number,
  toIndex: number,
): boolean {
  const doc = view.state.doc
  if (fromIndex < 0 || toIndex >= doc.childCount || fromIndex > toIndex) return false
  let from = 0
  for (let i = 0; i < fromIndex; i++) from += doc.child(i).nodeSize
  let to = from
  for (let i = fromIndex; i <= toIndex; i++) to += doc.child(i).nodeSize
  let tr: Transaction = view.state.tr.delete(from, to)
  if (tr.doc.childCount === 0) {
    const para = view.state.schema.nodes.paragraph.create()
    tr = tr.insert(0, para)
    tr = tr.setSelection(TextSelection.create(tr.doc, 1))
  }
  view.dispatch(tr.scrollIntoView())
  view.focus()
  return true
}

/**
 * Continuous top-level indices covering [anchorFrom, headFrom] block starts.
 */
export function topLevelIndexRange(
  doc: PMNode,
  aFrom: number,
  bFrom: number,
): { fromIndex: number; toIndex: number } | null {
  const a = topLevelBlockAt(doc, aFrom)
  const b = topLevelBlockAt(doc, bFrom)
  if (!a || !b) return null
  return {
    fromIndex: Math.min(a.index, b.index),
    toIndex: Math.max(a.index, b.index),
  }
}

/** Plain-text clipboard payload for a block (MD-ish fallback). */
export function blockPlainText(node: PMNode): string {
  if (node.type.name === 'code_block') {
    return '```\n' + node.textContent + '\n```'
  }
  if (node.type.name === 'heading') {
    const level = Number(node.attrs.level) || 1
    return `${'#'.repeat(level)} ${node.textContent}`
  }
  if (node.type.name === 'horizontal_rule' || node.type.name === 'hr') {
    return '---'
  }
  return node.textBetween(0, node.content.size, '\n\n', '\n')
}

/** Whether selection is a NodeSelection on a top-level block. */
export function isTopLevelNodeSelection(view: EditorView): boolean {
  const { selection, doc } = view.state
  if (!(selection instanceof NodeSelection)) return false
  const $from = doc.resolve(selection.from)
  return $from.depth === 0 || ($from.depth === 1 && $from.before(1) === selection.from)
}

export function fragmentFromNode(node: PMNode): Fragment {
  return Fragment.from(node)
}
