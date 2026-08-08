/**
 * Wiki link inline content — chip UI; MD carrier [[title#frag|alias]] (V2-E1 块引用).
 */
import { useEffect, useRef, useState } from 'react'
import { createReactInlineContentSpec } from '@blocknote/react'
import { createReactStyleSpec } from '@blocknote/react'
import { useKnowledgeEditorHost } from './knowledgeEditorHostContext'
import { listDocsInTreeOrder, resolveWikiTitle } from '../wikiLink'
import { BlockHoverCard } from '@/components/knowledge/BlockHoverCard'

export const wikiLinkInlineSpec = createReactInlineContentSpec(
  {
    type: 'wikiLink' as const,
    propSchema: {
      title: { default: '' },
      alias: { default: '' },
      /** Block anchor: `[[title#fragment]]` — BN block id or heading text (V2-E1). */
      fragment: { default: '' },
    },
    content: 'none' as const,
  },
  {
    parse: (el) => {
      if (el.getAttribute('data-hip-inline') !== 'wiki') return undefined
      return {
        title: el.getAttribute('data-title') ?? '',
        alias: el.getAttribute('data-alias') ?? '',
        fragment: el.getAttribute('data-fragment') ?? '',
      }
    },
    toExternalHTML: ({ inlineContent }) => {
      const title = String(inlineContent.props.title ?? '')
      const alias = String(inlineContent.props.alias ?? '')
      const fragment = String(inlineContent.props.fragment ?? '')
      const display = alias.trim() || title
      return (
        <span
          data-hip-inline="wiki"
          data-title={title}
          data-alias={alias}
          data-fragment={fragment}
        >
          {display}
        </span>
      )
    },
    render: ({ inlineContent }) => {
      return (
        <WikiChip
          title={String(inlineContent.props.title ?? '')}
          alias={String(inlineContent.props.alias ?? '')}
          fragment={String(inlineContent.props.fragment ?? '')}
        />
      )
    },
  },
)

function WikiChip({
  title,
  alias,
  fragment,
}: {
  title: string
  alias: string
  fragment: string
}) {
  const host = useKnowledgeEditorHost()
  const docs = listDocsInTreeOrder(host.nodes)
  const resolved = title.trim() ? resolveWikiTitle(title, docs) : null
  const broken = !resolved
  const display = alias.trim() || title || '…'
  const [hover, setHover] = useState(false)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [cardAnchor, setCardAnchor] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    return () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current)
    }
  }, [])

  const showCard = (e: { clientX: number; clientY: number }) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    hoverTimer.current = setTimeout(() => {
      setHover(true)
      setCardAnchor({ x: e.clientX, y: e.clientY })
    }, 150)
  }
  const hideCard = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    hoverTimer.current = setTimeout(() => {
      setHover(false)
      setCardAnchor(null)
    }, 200)
  }

  return (
    <>
      <span
        className={broken ? 'kb-wiki-chip kb-wiki-chip-broken' : 'kb-wiki-chip'}
        data-testid="knowledge-wiki-chip"
        data-wiki-title={title}
        data-fragment={fragment}
        data-broken={broken ? 'true' : 'false'}
        contentEditable={false}
        title={title}
        onMouseEnter={showCard}
        onMouseLeave={hideCard}
        onClick={(e) => {
          // Mod/Ctrl+Click (or any click with fragment) navigates; plain click focuses.
          if (!(e.metaKey || e.ctrlKey) && !fragment) return
          e.preventDefault()
          e.stopPropagation()
          host.onWikiNavigate?.({
            title,
            nodeId: resolved?.id ?? null,
            broken,
            fragment: fragment || null,
          })
        }}
      >
        {display}
      </span>
      {hover && cardAnchor && resolved && !broken ? (
        <BlockHoverCard
          spaceId={host.spaceId ?? ''}
          nodeId={resolved.id}
          title={resolved.title}
          fragment={fragment || null}
          anchor={cardAnchor}
          onClose={hideCard}
        />
      ) : null}
    </>
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
