/**
 * Turn-into helpers for Live bubble + block menu (R4 narrow + R5 list/code).
 */
import { lift, setBlockType } from '@milkdown/kit/prose/commands'
import { wrapInList, liftListItem } from '@milkdown/kit/prose/schema-list'
import {
  TextSelection,
  type EditorState,
  type Transaction,
} from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'

export type TurnIntoTarget =
  | 'paragraph'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'quote'
  | 'bullet'
  | 'ordered'
  | 'task'
  | 'code'

/** True when selection is a single textblock suitable for narrow turn-into. */
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

/** Broader gate for list/code targets (still single textblock). */
export function canTurnInto(state: EditorState, target: TurnIntoTarget): boolean {
  if (target === 'bullet' || target === 'ordered' || target === 'task' || target === 'code') {
    const { $from, $to, empty } = state.selection
    if (!empty && $from.parent !== $to.parent) return false
    if (!$from.parent.isTextblock) return false
    // Allow from inside list for lift-to-paragraph path via other targets
    if (target === 'code') {
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.name === 'table') return false
      }
    }
    return true
  }
  return canTurnIntoNarrow(state)
}

function depthOfType($from: EditorState['selection']['$from'], typeName: string): number {
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === typeName) return d
  }
  return 0
}

function liftAllListItems(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const listItem = state.schema.nodes.list_item
  if (!listItem) return false
  let cur = state
  let any = false
  for (let i = 0; i < 8; i++) {
    if (depthOfType(cur.selection.$from, 'list_item') === 0) break
    const ok = liftListItem(listItem)(cur, (tr) => {
      any = true
      if (dispatch) dispatch(tr)
      cur = cur.apply(tr)
    })
    if (!ok) break
  }
  return any
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
  if (!canTurnInto(state, target)) return false
  const $from = state.selection.$from
  const parentName = $from.parent.type.name
  const schema = state.schema

  if (target === 'h1' || target === 'h2' || target === 'h3') {
    // Lift out of list first if needed
    if (depthOfType($from, 'list_item') > 0) {
      liftAllListItems(state, dispatch)
    }
    const level = target === 'h1' ? 1 : target === 'h2' ? 2 : 3
    return cmds.wrapHeading(level)
  }

  if (target === 'quote') {
    if (depthOfType(view.state.selection.$from, 'blockquote') > 0) return false
    if (depthOfType(view.state.selection.$from, 'list_item') > 0) {
      liftAllListItems(view.state, dispatch)
    }
    return cmds.wrapBlockquote()
  }

  if (target === 'bullet' || target === 'ordered' || target === 'task') {
    const typeName =
      target === 'ordered'
        ? 'ordered_list'
        : 'bullet_list'
    const listType = schema.nodes[typeName]
    if (!listType) return false
    // Already in list of same kind → ok no-op-ish wrap
    if (parentName === 'code_block') {
      // convert code → paragraph text first
      const text = $from.parent.textContent
      const para = schema.nodes.paragraph.create(
        null,
        text ? schema.text(text) : undefined,
      )
      const from = $from.before()
      const to = $from.after()
      let tr = state.tr.replaceWith(from, to, para)
      tr = tr.setSelection(TextSelection.create(tr.doc, from + 1))
      dispatch(tr)
    }
    return wrapInList(listType)(view.state, dispatch)
  }

  if (target === 'code') {
    const code = schema.nodes.code_block
    if (!code) return false
    if (depthOfType($from, 'list_item') > 0) {
      liftAllListItems(state, dispatch)
    }
    return setBlockType(code)(view.state, dispatch)
  }

  // → paragraph
  if (parentName === 'heading') {
    return cmds.wrapHeading(0)
  }
  if (parentName === 'code_block') {
    return setBlockType(schema.nodes.paragraph)(state, dispatch)
  }
  if (depthOfType($from, 'blockquote') > 0) {
    return lift(state, dispatch)
  }
  if (depthOfType($from, 'list_item') > 0) {
    return liftAllListItems(state, dispatch)
  }
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
