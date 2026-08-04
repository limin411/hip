/**
 * Extra list keymap polish on top of Milkdown commonmark listItemKeymap (R5).
 * Milkdown already binds Tab/S-Tab/Enter-split/Backspace-at-start.
 * Here: empty list item + Enter → lift out of list (Notion/飞书 exit).
 */
import { liftListItem } from '@milkdown/kit/prose/schema-list'
import { keymap } from '@milkdown/kit/prose/keymap'
import type { EditorState, Transaction } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

function isEmptyListItemTextblock(state: EditorState): boolean {
  const { $from, empty } = state.selection
  if (!empty) return false
  let inListItem = false
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'list_item') {
      inListItem = true
      break
    }
  }
  if (!inListItem) return false
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

/** Milkdown $prose plugin — high priority Enter override for empty items. */
export function createListExitPlugin(): ReturnType<typeof $prose> {
  return $prose(() =>
    keymap({
      Enter: (state, dispatch, view) => exitEmptyListItem(state, dispatch, view),
    }),
  )
}
