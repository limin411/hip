/**
 * Empty paragraph slash-hint decorations for Live (R4).
 * Contract: CSS var --knowledge-pm-placeholder + class knowledge-pm-empty.
 */
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

const key = new PluginKey('knowledge-live-placeholder')

function buildDecos(doc: import('@milkdown/kit/prose/model').Node, cursorPos: number | null) {
  const decos: Decoration[] = []
  const topCount = doc.childCount
  doc.forEach((node, offset) => {
    if (node.type.name !== 'paragraph') return
    if (node.content.size > 0) return
    const from = offset
    const to = offset + node.nodeSize
    const isOnlyBlock = topCount === 1
    const caretInside =
      cursorPos != null && cursorPos >= from && cursorPos <= to
    if (!isOnlyBlock && !caretInside) return
    decos.push(
      Decoration.node(from, to, { class: 'knowledge-pm-empty' }),
    )
  })
  return DecorationSet.create(doc, decos)
}

export const livePlaceholderPlugin = $prose(
  () =>
    new Plugin({
      key,
      state: {
        init: (_, state) => {
          const sel = state.selection
          return buildDecos(state.doc, sel.from)
        },
        apply: (tr, set, _old, state) => {
          if (!tr.docChanged && !tr.selectionSet) return set
          return buildDecos(state.doc, state.selection.from)
        },
      },
      props: {
        decorations(state) {
          return key.getState(state) as DecorationSet
        },
      },
    }),
)

export const livePlaceholderPlugins = [livePlaceholderPlugin]
