import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, FileWarning } from 'lucide-react'
import { KnowledgeMarkdownBody } from './KnowledgeMarkdownBody'
import { knowledgeReadDoc } from '@/ipc/knowledge'
import { bodyForEmbed, EMBED_MAX_DEPTH } from '@/domain/knowledge/embedSplit'
import {
  listDocsInTreeOrder,
  resolveWikiTitle,
  rewriteWikiLinksForPreview,
  wikiPartsFromHref,
} from '@/domain/knowledge/wikiLink'
import type { KnowledgeNode } from '@/domain/knowledge/types'
import { knowledgeMarkdownComponents } from './knowledgeMarkdownComponents'
import { cn } from '@/lib/utils'
import { createElement, useCallback, type ComponentType } from 'react'
import type { Components, ExtraProps } from 'react-markdown'
import type { AnchorHTMLAttributes, ClassAttributes } from 'react'

export interface KnowledgeEmbedCardProps {
  spaceId: string
  docTitle: string
  fragment: string | null
  display: string | null
  raw: string
  nodes: KnowledgeNode[]
  /** Nesting depth; at EMBED_MAX_DEPTH we do not expand nested embeds. */
  depth: number
  onOpenDoc?: (docId: string, fragment?: string | null) => void
  className?: string
}

/**
 * Read-only embed of another knowledge doc (or section).
 * Nested `![[…]]` inside the target are left as raw text (depth cap).
 */
export function KnowledgeEmbedCard({
  spaceId,
  docTitle,
  fragment,
  display,
  raw,
  nodes,
  depth,
  onOpenDoc,
  className,
}: KnowledgeEmbedCardProps) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading')
  const [title, setTitle] = useState(docTitle)
  const [body, setBody] = useState('')
  const [truncated, setTruncated] = useState(false)
  const [docId, setDocId] = useState<string | null>(null)

  const docs = useMemo(() => listDocsInTreeOrder(nodes), [nodes])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (!docTitle.trim()) {
        setStatus('missing')
        return
      }
      const resolved = resolveWikiTitle(docTitle, docs)
      if (!resolved) {
        if (!cancelled) {
          setStatus('missing')
          setDocId(null)
        }
        return
      }
      setDocId(resolved.id)
      setTitle(resolved.title)
      try {
        const rawMd = await knowledgeReadDoc(spaceId, resolved.id)
        if (cancelled) return
        const { body: section, truncated: tr } = bodyForEmbed(rawMd, fragment)
        // Strip nested embeds to plain text note (depth policy)
        const safe =
          depth >= EMBED_MAX_DEPTH
            ? section.replace(/!\[\[([^\]]*)\]\]/g, (_m, inner: string) => `\`![[${inner}]]\``)
            : section
        setBody(safe)
        setTruncated(tr)
        setStatus('ready')
      } catch {
        if (!cancelled) setStatus('error')
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [spaceId, docTitle, fragment, docs, depth])

  const label = display?.trim() || title || docTitle || raw

  const components = useMemo((): Components => {
    const base = knowledgeMarkdownComponents({ spaceId })
    const baseA = base.a
    return {
      ...base,
      a: (props) => {
        const { href, children, className: aClass, node: _n, ...rest } = props
        const parts = wikiPartsFromHref(href)
        if (parts == null) {
          if (baseA && typeof baseA !== 'string') {
            return createElement(
              baseA as ComponentType<
                ClassAttributes<HTMLAnchorElement> &
                  AnchorHTMLAttributes<HTMLAnchorElement> &
                  ExtraProps
              >,
              props,
            )
          }
          return (
            <a href={href} className={cn('underline', aClass)} {...rest}>
              {children}
            </a>
          )
        }
        const resolved = resolveWikiTitle(parts.title, docs)
        return (
          <a
            href={href}
            className={cn(
              'cursor-pointer underline',
              resolved ? 'text-accent-strong' : 'text-danger',
              aClass,
            )}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (resolved) onOpenDoc?.(resolved.id, parts.fragment)
            }}
            {...rest}
          >
            {children}
          </a>
        )
      },
    }
  }, [docs, onOpenDoc, spaceId])

  const previewMd = useMemo(
    () => (body ? rewriteWikiLinksForPreview(body) : ''),
    [body],
  )

  const open = useCallback(() => {
    if (docId) onOpenDoc?.(docId, fragment)
  }, [docId, fragment, onOpenDoc])

  return (
    <aside
      className={cn(
        'my-3 overflow-hidden rounded-lg border border-border bg-surface-secondary/40',
        className,
      )}
      data-testid="knowledge-embed"
      data-embed-title={docTitle}
      data-embed-status={status}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <button
          type="button"
          className="min-w-0 truncate text-left text-meta font-medium text-accent-strong hover:underline"
          data-testid="knowledge-embed-open"
          onClick={open}
          disabled={!docId}
        >
          {label}
          {fragment ? (
            <span className="ml-1 font-normal text-ink-tertiary">#{fragment}</span>
          ) : null}
        </button>
        {docId ? (
          <button
            type="button"
            className="shrink-0 rounded p-1 text-ink-tertiary hover:bg-state-hover hover:text-ink"
            title={t('knowledge.embed.openSource')}
            onClick={open}
          >
            <ExternalLink size={14} />
          </button>
        ) : null}
      </div>
      <div className="px-3 py-2">
        {status === 'loading' ? (
          <p className="text-meta text-ink-tertiary">{t('knowledge.embed.loading')}</p>
        ) : status === 'missing' ? (
          <p
            className="flex items-center gap-1.5 text-meta text-danger"
            data-testid="knowledge-embed-missing"
          >
            <FileWarning size={14} />
            {t('knowledge.embed.missing', { title: docTitle || raw })}
          </p>
        ) : status === 'error' ? (
          <p className="text-meta text-danger">{t('knowledge.embed.error')}</p>
        ) : (
          <>
            {previewMd.trim() ? (
              <div className="knowledge-embed-body text-body text-ink" data-testid="knowledge-embed-body">
                <KnowledgeMarkdownBody content={previewMd} components={components} />
              </div>
            ) : (
              <p className="text-meta text-ink-tertiary">{t('knowledge.embed.empty')}</p>
            )}
            {truncated ? (
              <p className="mt-2 text-meta text-ink-tertiary">{t('knowledge.embed.truncated')}</p>
            ) : null}
          </>
        )}
      </div>
    </aside>
  )
}
