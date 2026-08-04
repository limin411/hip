/**
 * Top-level block ops for Live gutter menu (R5 Gate A).
 * Pure ProseMirror helpers — no Milkdown/DOM.
 */
import { Fragment, type Node as PMNode } from '@milkdown/kit/prose/model'
import { NodeSelection, TextSelection, type Transaction } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'

/** Resolve depth-1 top-level block containing `pos`. */
export function topLevelBlockAt(
  doc: PMNode,
  pos: number,
): { from: number; to: number; node: PMNode; index: number } | null {
  try {
    const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)))
    if ($pos.depth < 1) {
      // Between blocks at depth 0 — use nearest child
      const idx = $pos.index(0)
      if (idx < 0 || idx >= doc.childCount) return null
      const node = doc.child(idx)
      let from = 0
      for (let i = 0; i < idx; i++) from += doc.child(i).nodeSize
      return { from, to: from + node.nodeSize, node, index: idx }
    }
    const from = $pos.before(1)
    const to = $pos.after(1)
    const node = $pos.node(1)
    const index = $pos.index(0)
    return { from, to, node, index }
  } catch {
    return null
  }
}

/** Select the entire top-level block as NodeSelection when possible. */
export function selectTopLevelBlock(view: EditorView, blockFrom: number): boolean {
  const block = topLevelBlockAt(view.state.doc, blockFrom)
  if (!block) return false
  try {
    const sel = NodeSelection.create(view.state.doc, block.from)
    view.dispatch(view.state.tr.setSelection(sel).scrollIntoView())
    view.focus()
    return true
  } catch {
    // Non-atom blocks: TextSelection at start
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

/**
 * Delete top-level block. If doc would be empty, leave one empty paragraph.
 * Returns true when dispatched.
 */
export function deleteTopLevelBlock(view: EditorView, blockFrom: number): boolean {
  const block = topLevelBlockAt(view.state.doc, blockFrom)
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

/** Insert a copy of the block immediately after it. */
export function duplicateTopLevelBlock(view: EditorView, blockFrom: number): boolean {
  const block = topLevelBlockAt(view.state.doc, blockFrom)
  if (!block) return false
  const copy = block.node.copy(block.node.content)
  const tr = view.state.tr.insert(block.to, copy)
  view.dispatch(tr.scrollIntoView())
  view.focus()
  return true
}

/** Insert empty paragraph before (dir=-1) or after (dir=1) the block. Returns new para pos. */
export function insertEmptyParagraphNear(
  view: EditorView,
  blockFrom: number,
  dir: -1 | 1,
): number | null {
  const block = topLevelBlockAt(view.state.doc, blockFrom)
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
