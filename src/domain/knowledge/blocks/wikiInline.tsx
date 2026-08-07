/**
 * Wiki link inline content — chip UI; MD carrier [[title]] / [[t|a]].
 */
import { createReactInlineContentSpec } from '@blocknote/react'
import { createReactStyleSpec } from '@blocknote/react'
import { useKnowledgeEditorHost } from './knowledgeEditorHostContext'
import {
  listDocsInTreeOrder,
  resolveWikiTitle,
} from '../wikiLink'

export const wikiLinkInlineSpec = createReactInlineContentSpec(
  {
    type: 'wikiLink' as const,
    propSchema: {
      title: { default: '' },
      alias: { default: '' },
    },
    content: 'none' as const,
  },
  {
    parse: (el) => {
      if (el.getAttribute('data-hip-inline') !== 'wiki') return undefined
      return {
        title: el.getAttribute('data-title') ?? '',
        alias: el.getAttribute('data-alias') ?? '',
      }
    },
    toExternalHTML: ({ inlineContent }) => {
      const title = String(inlineContent.props.title ?? '')
      const alias = String(inlineContent.props.alias ?? '')
      const display = alias.trim() || title
      return (
        <span data-hip-inline="wiki" data-title={title} data-alias={alias}>
          {display}
        </span>
      )
    },
    render: ({ inlineContent }) => {
      return (
        <WikiChip
          title={String(inlineContent.props.title ?? '')}
          alias={String(inlineContent.props.alias ?? '')}
        />
      )
    },
  },
)

function WikiChip({ title, alias }: { title: string; alias: string }) {
  const host = useKnowledgeEditorHost()
  const docs = listDocsInTreeOrder(host.nodes)
  const resolved = title.trim() ? resolveWikiTitle(title, docs) : null
  const broken = !resolved
  const display = alias.trim() || title || '…'

  return (
    <span
      className={broken ? 'kb-wiki-chip kb-wiki-chip-broken' : 'kb-wiki-chip'}
      data-testid="knowledge-wiki-chip"
      data-wiki-title={title}
      data-broken={broken ? 'true' : 'false'}
      contentEditable={false}
      title={title}
      onClick={(e) => {
        // Mod/Ctrl+Click navigates; plain click focuses only (parent handles)
        if (!(e.metaKey || e.ctrlKey)) return
        e.preventDefault()
        e.stopPropagation()
        host.onWikiNavigate?.({
          title,
          nodeId: resolved?.id ?? null,
          broken,
        })
      }}
    >
      {display}
    </span>
  )
}

/** Obsidian-style ==highlight== via BN mark + postprocess. */
export const highlightStyleSpec = createReactStyleSpec(
  {
    type: 'highlight' as const,
    propSchema: 'boolean' as const,
  },
  {
    render: (props) => (
      <mark
        data-hip-mark="highlight"
        className="kb-highlight"
        ref={props.contentRef}
      />
    ),
  },
)
