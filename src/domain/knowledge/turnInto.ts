/**
 * Narrow turn-into helpers for Live bubble (R4 Gate B).
 * Only paragraph ↔ heading ↔ blockquote — no list/fence.
 */
import { lift } from '@milkdown/kit/prose/commands'
import type { EditorState, Transaction } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'

export type TurnIntoTarget = 'paragraph' | 'h1' | 'h2' | 'h3' | 'quote'

/** True when selection is a single textblock not inside a list_item. */
export function canTurnIntoNarrow(state: EditorState): boolean {
  const { $from, $to, empty } = state.selection
  if (!empty && $from.parent !== $to.parent) return false
  for (let d = $from.depth; d > 0; d--) {
    const name = $from.node(d).type.name
    if (name === 'list_item') return false
    if (name === 'code_block') return false
  }
  const parent = $from.parent
  if (!parent.isTextblock) return false
  return true
}

function depthOfType($from: EditorState['selection']['$from'], typeName: string): number {
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === typeName) return d
  }
  return 0
}

/**
 * Dispatch turn-into. Caller supplies heading/quote wrap runners that call
 * Milkdown commands (wrapInHeadingCommand / wrapInBlockquoteCommand).
 */
export function applyTurnInto(
  view: EditorView,
  target: TurnIntoTarget,
  cmds: {
    wrapHeading: (level: number) => boolean
    wrapBlockquote: () => boolean
  },
): boolean {
  const { state, dispatch } = view
  if (!canTurnIntoNarrow(state)) return false
  const $from = state.selection.$from
  const parentName = $from.parent.type.name

  if (target === 'h1' || target === 'h2' || target === 'h3') {
    const level = target === 'h1' ? 1 : target === 'h2' ? 2 : 3
    return cmds.wrapHeading(level)
  }

  if (target === 'quote') {
    if (depthOfType($from, 'blockquote') > 0) return false
    return cmds.wrapBlockquote()
  }

  // → paragraph
  if (parentName === 'heading') {
    // kit: wrapInHeadingCommand(0) → setBlockType(paragraph)
    return cmds.wrapHeading(0)
  }
  if (depthOfType($from, 'blockquote') > 0) {
    return lift(state, dispatch)
  }
  // already paragraph (or other textblock without special parent)
  if (parentName === 'paragraph') return true
  return cmds.wrapHeading(0)
}

/** Test helper: apply lift when selection is inside blockquote. */
export function liftOutOfBlockquote(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
): boolean {
  const d = depthOfType(state.selection.$from, 'blockquote')
  if (d === 0) return false
  return lift(state, dispatch)
}
