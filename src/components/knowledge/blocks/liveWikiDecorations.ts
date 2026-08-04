/**
 * Live wiki/embed decorations (Phase C).
 * Keeps [[…]] as plain text in PM; paints chips + handles click navigate.
 */
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import {
  findEmbedRangesInText,
  findWikiRangesInText,
  type WikiRange,
} from '@/domain/knowledge/wikiPm'
import {
  listDocsInTreeOrder,
  resolveWikiTitle,
} from '@/domain/knowledge/wikiLink'
import type { KnowledgeNode } from '@/domain/knowledge/types'

const key = new PluginKey('knowledge-live-wiki-deco')

export type WikiDecoOptions = {
  getNodes: () => KnowledgeNode[]
  /** Navigate to resolved doc id (or title for create). */
  onWikiNavigate?: (payload: {
    title: string
    nodeId: string | null
    broken: boolean
  }) => void
  onEmbedClick?: (title: string) => void
}

function collectRanges(doc: EditorView['state']['doc']): {
  wiki: WikiRange[]
  embed: ReturnType<typeof findEmbedRangesInText>
} {
  const wiki: WikiRange[] = []
  const embed: ReturnType<typeof findEmbedRangesInText> = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return
    if (node.type.name === 'code_block') return false
    const text = node.textContent
    if (!text.includes('[[')) return
    const base = pos + 1
    wiki.push(...findWikiRangesInText(text, base))
    embed.push(...findEmbedRangesInText(text, base))
  })
  return { wiki, embed }
}

function buildDecos(
  doc: EditorView['state']['doc'],
  nodes: KnowledgeNode[],
): DecorationSet {
  const docs = listDocsInTreeOrder(nodes)
  const { wiki, embed } = collectRanges(doc)
  const decos: Decoration[] = []

  for (const w of wiki) {
    const resolved = resolveWikiTitle(w.title, docs)
    const broken = resolved == null && w.title.length > 0
    const label = w.display ?? w.title
    decos.push(
      Decoration.inline(w.from, w.to, {
        class: 'knowledge-live-wiki-chip',
        'data-testid': broken
          ? 'knowledge-live-wiki-chip-broken'
          : 'knowledge-live-wiki-chip',
        'data-wiki-title': w.title,
        'data-broken': broken ? 'true' : 'false',
        title: label,
      }),
    )
  }

  for (const e of embed) {
    decos.push(
      Decoration.inline(e.from, e.to, {
        class: 'knowledge-live-wiki-chip',
        'data-testid': 'knowledge-live-embed-chip',
        'data-embed-title': e.title,
        title: `![[${e.title}]]`,
      }),
    )
  }

  return DecorationSet.create(doc, decos)
}

function rangeAtPos(
  doc: EditorView['state']['doc'],
  pos: number,
): { kind: 'wiki' | 'embed'; title: string } | null {
  const { wiki, embed } = collectRanges(doc)
  for (const w of wiki) {
    if (pos >= w.from && pos < w.to) return { kind: 'wiki', title: w.title }
  }
  for (const e of embed) {
    if (pos >= e.from && pos < e.to) return { kind: 'embed', title: e.title }
  }
  return null
}

export function createLiveWikiDecorationPlugin(
  opts: WikiDecoOptions,
): ReturnType<typeof $prose> {
  return $prose(() => {
    return new Plugin({
      key,
      state: {
        init: (_, state) => buildDecos(state.doc, opts.getNodes()),
        apply(tr, old, _oldState, newState) {
          if (!tr.docChanged && tr.getMeta(key) !== 'refresh') {
            return old
          }
          return buildDecos(newState.doc, opts.getNodes())
        },
      },
      props: {
        decorations(state) {
          return key.getState(state) as DecorationSet
        },
        handleClickOn(view, pos, _node, _nodePos, event, direct) {
          if (!direct) return false
          const hit = rangeAtPos(view.state.doc, pos)
          if (!hit) return false
          if (hit.kind === 'embed') {
            opts.onEmbedClick?.(hit.title)
          }
          const docs = listDocsInTreeOrder(opts.getNodes())
          const resolved = resolveWikiTitle(hit.title, docs)
          opts.onWikiNavigate?.({
            title: hit.title,
            nodeId: resolved?.id ?? null,
            broken: resolved == null,
          })
          event.preventDefault()
          return true
        },
      },
    })
  })
}

export function refreshWikiDecorations(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(key, 'refresh'))
}
