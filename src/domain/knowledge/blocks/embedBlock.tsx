import { useEffect, useMemo, useState } from 'react'
import { createReactBlockSpec } from '@blocknote/react'
import { FileWarning, ExternalLink } from 'lucide-react'
import {
  listDocsInTreeOrder,
  resolveWikiTitle,
} from '../wikiLink'
import { useKnowledgeEditorHost } from './knowledgeEditorHostContext'

export const embedBlockSpec = createReactBlockSpec(
  {
    type: 'embed' as const,
    propSchema: {
      title: { default: '' },
      fragment: { default: '' },
    },
    content: 'none' as const,
  },
  {
    parse: (el) => {
      if (el.getAttribute('data-hip-block') !== 'embed') return undefined
      return {
        title: el.getAttribute('data-title') ?? '',
        fragment: el.getAttribute('data-fragment') ?? '',
      }
    },
    toExternalHTML: ({ block }) => (
      <div
        data-hip-block="embed"
        data-title={String(block.props.title ?? '')}
        data-fragment={String(block.props.fragment ?? '')}
      />
    ),
    render: ({ block }) => (
      <EmbedCardLite
        title={String(block.props.title ?? '')}
        fragment={String(block.props.fragment ?? '')}
      />
    ),
  },
)

function EmbedCardLite({
  title,
  fragment,
}: {
  title: string
  fragment: string
}) {
  const host = useKnowledgeEditorHost()
  const docs = useMemo(() => listDocsInTreeOrder(host.nodes), [host.nodes])
  const resolved = useMemo(
    () => (title.trim() ? resolveWikiTitle(title, docs) : null),
    [title, docs],
  )
  const [preview, setPreview] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    if (!host.spaceId || !resolved) {
      setPreview('')
      return
    }
    void import('@/ipc/knowledge')
      .then(({ knowledgeReadDoc }) => knowledgeReadDoc(host.spaceId!, resolved.id))
      .then((md) => {
        if (cancelled) return
        // Short preview: first non-empty lines of body
        const body = md.replace(/^---[\s\S]*?---\n?/, '')
        const lines = body.split('\n').filter((l) => l.trim()).slice(0, 4)
        setPreview(lines.join('\n').slice(0, 280))
      })
      .catch(() => {
        if (!cancelled) setPreview('')
      })
    return () => {
      cancelled = true
    }
  }, [host.spaceId, resolved])

  const broken = !resolved

  return (
    <div
      className={broken ? 'kb-embed kb-embed-broken' : 'kb-embed'}
      data-testid="knowledge-embed-block"
      contentEditable={false}
    >
      <button
        type="button"
        className="kb-embed-head"
        disabled={broken}
        onClick={() => {
          if (resolved) host.onOpenDoc?.(resolved.id, fragment || null)
        }}
      >
        {broken ? (
          <FileWarning size={14} className="shrink-0 text-danger" />
        ) : (
          <ExternalLink size={14} className="shrink-0 text-ink-tertiary" />
        )}
        <span className="kb-embed-title truncate">
          {(resolved?.title ?? title) || '…'}
          {fragment ? (
            <span className="text-ink-tertiary"> #{fragment}</span>
          ) : null}
        </span>
      </button>
      {preview ? (
        <pre className="kb-embed-preview">{preview}</pre>
      ) : broken ? (
        <p className="kb-embed-missing">Missing document</p>
      ) : null}
    </div>
  )
}
