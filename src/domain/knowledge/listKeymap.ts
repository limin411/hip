/**
 * Extra list keymap polish on top of Milkdown commonmark listItemKeymap.
 * - empty list item + Enter → lift (Notion/飞书 exit)
 * - Tab / Shift-Tab → sink / lift list item when inside list (Phase B)
 */
import { liftListItem, sinkListItem } from '@milkdown/kit/prose/schema-list'
import { keymap } from '@milkdown/kit/prose/keymap'
import type { EditorState, Transaction } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

function depthOfListItem(state: EditorState): number {
  const { $from } = state.selection
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'list_item') return d
  }
  return 0
}

function isEmptyListItemTextblock(state: EditorState): boolean {
  const { $from, empty } = state.selection
  if (!empty) return false
  if (depthOfListItem(state) === 0) return false
  const parent = $from.parent
  if (!parent.isTextblock) return false
  return parent.content.size === 0
}

/**
 * When caret is in an empty list item paragraph, Enter lifts the item
 * (exits list) instead of splitting another empty item.
 */
export function exitEmptyListItem(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
  view?: EditorView,
): boolean {
  if (!isEmptyListItemTextblock(state)) return false
  const listItem = state.schema.nodes.list_item
  if (!listItem) return false
  return liftListItem(listItem)(state, dispatch, view)
}

/** Tab: sink list item when inside a list. */
export function indentListItem(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
  view?: EditorView,
): boolean {
  if (depthOfListItem(state) === 0) return false
  const listItem = state.schema.nodes.list_item
  if (!listItem) return false
  return sinkListItem(listItem)(state, dispatch, view)
}

/** Shift-Tab: lift list item when inside a list. */
export function outdentListItem(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
  view?: EditorView,
): boolean {
  if (depthOfListItem(state) === 0) return false
  const listItem = state.schema.nodes.list_item
  if (!listItem) return false
  return liftListItem(listItem)(state, dispatch, view)
}

/** Milkdown $prose plugin — Enter exit + Tab/S-Tab indent. */
export function createListExitPlugin(): ReturnType<typeof $prose> {
  return $prose(() =>
    keymap({
      Enter: (state, dispatch, view) => exitEmptyListItem(state, dispatch, view),
      Tab: (state, dispatch, view) => indentListItem(state, dispatch, view),
      'Shift-Tab': (state, dispatch, view) => outdentListItem(state, dispatch, view),
    }),
  )
}
