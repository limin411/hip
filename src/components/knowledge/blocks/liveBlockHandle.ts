/**
 * Path-A slash open helper + thin re-export of R5 gutter (R4 `+` handle evolved).
 */
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'

/**
 * Mutates doc: ensures empty paragraph context + '/' so existing slash UI opens.
 */
export function openSlashAtTopLevelBlock(
  view: EditorView,
  blockStartPos: number,
): boolean {
  if (view.composing) return false
  try {
    const $pos = view.state.doc.resolve(blockStartPos)
    // Top-level block: depth 1 under doc
    if ($pos.depth < 1) return false
    const blockDepth = 1
    const block = $pos.node(blockDepth)
    const blockFrom = $pos.before(blockDepth)
    const blockTo = $pos.after(blockDepth)

    let tr = view.state.tr
    const isEmptyPara =
      block.type.name === 'paragraph' && block.content.size === 0

    if (isEmptyPara) {
      const insertAt = blockFrom + 1
      tr = tr.insertText('/', insertAt)
      tr = tr.setSelection(TextSelection.create(tr.doc, insertAt + 1))
    } else {
      const para = view.state.schema.nodes.paragraph.create()
      tr = tr.insert(blockTo, para)
      // New empty para is at blockTo; content starts at blockTo+1
      const slashPos = blockTo + 1
      tr = tr.insertText('/', slashPos)
      tr = tr.setSelection(TextSelection.create(tr.doc, slashPos + 1))
    }
    view.dispatch(tr.scrollIntoView())
    view.focus()
    return true
  } catch {
    return false
  }
}
