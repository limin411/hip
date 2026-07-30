/**
 * Pure helpers for Live selection bubble visibility (R4).
 */
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'

export type BubbleShouldShowOpts = {
  /** Slash or wiki picker is open — hide bubble so menus win. */
  menusOpen?: boolean
}

/**
 * Whether the knowledge Live selection bubble should show.
 * Does not inspect DOM menus — pass `menusOpen` from the host.
 */
export function knowledgeBubbleShouldShow(
  view: EditorView,
  opts?: BubbleShouldShowOpts,
): boolean {
  if (opts?.menusOpen) return false
  if (view.composing) return false
  if (!view.editable) return false
  const { selection } = view.state
  if (!(selection instanceof TextSelection) || selection.empty) return false
  const text = view.state.doc.textBetween(selection.from, selection.to, '')
  if (!text) return false
  // Hide when caret/selection is inside a code_block (incl. mermaid/svg fences).
  const $from = selection.$from
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'code_block') return false
  }
  return true
}
