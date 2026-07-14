import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete'
import type { Extension } from '@codemirror/state'
import type { KnowledgeNode } from './types'
import {
  listDocsInTreeOrder,
  rankWikiCandidates,
  wikiLinkQueryAt,
} from './wikiLink'

export type WikiDocsProvider = () => KnowledgeNode[]

/**
 * CodeMirror completion source for `[[title` wiki links (Source mode).
 * Inserts the chosen title and closes `]]` when missing.
 */
export function wikiLinkCompletionSource(getNodes: WikiDocsProvider) {
  return (context: CompletionContext): CompletionResult | null => {
    const pos = context.pos
    const text = context.state.doc.toString()
    const q = wikiLinkQueryAt(text, pos)
    if (!q) return null

    const ordered = listDocsInTreeOrder(getNodes())
    const ranked = rankWikiCandidates(q.query, ordered, 12)

    const options: Completion[] = ranked.map(({ node, score }) => ({
      label: node.title,
      type: 'text',
      boost: score,
      apply: (view, _completion, from, to) => {
        const insert = node.title
        const after = view.state.doc.sliceString(to, to + 2)
        const needsClose = after !== ']]'
        view.dispatch({
          changes: {
            from,
            to,
            insert: needsClose ? `${insert}]]` : insert,
          },
          selection: {
            anchor: from + insert.length + (needsClose ? 2 : 0),
          },
        })
      },
    }))

    return {
      from: q.from,
      to: q.to,
      options,
      filter: false,
    }
  }
}

/** Source-editor extension: wiki `[[` completions + CM autocomplete UI. */
export function wikiLinkAutocomplete(getNodes: WikiDocsProvider): Extension {
  return autocompletion({
    override: [wikiLinkCompletionSource(getNodes)],
    activateOnTyping: true,
    maxRenderedOptions: 12,
    defaultKeymap: true,
  })
}
