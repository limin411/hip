import { useMemo } from 'react'
import type { Components } from 'react-markdown'
import { useTranslation } from 'react-i18next'
import { FileText } from 'lucide-react'
import { MarkdownBody } from '@/components/chat/MarkdownBody'
import { EmptyState } from '@/components/ui/EmptyState'
import type { KnowledgeNode } from '@/domain/knowledge/types'
import {
  listDocsInTreeOrder,
  resolveWikiTitle,
  rewriteWikiLinksForPreview,
  titleFromWikiHref,
} from '@/domain/knowledge/wikiLink'
import { cn } from '@/lib/utils'

interface DocReaderProps {
  content: string
  /** Optional CTA when body is empty (preview → edit). */
  onStartEdit?: () => void
  /** Current space tree — enables `[[title]]` resolution (same space only). */
  nodes?: KnowledgeNode[]
  /** Navigate to a resolved wiki target. */
  onWikiNavigate?: (docId: string) => void
  /** Broken wiki click → parent shows confirm-create modal. */
  onWikiBroken?: (title: string) => void
}

export function DocReader({
  content,
  onStartEdit,
  nodes,
  onWikiNavigate,
  onWikiBroken,
}: DocReaderProps) {
  const { t } = useTranslation()

  const previewMd = useMemo(
    () => (content.trim() ? rewriteWikiLinksForPreview(content) : content),
    [content],
  )

  const components = useMemo((): Components | undefined => {
    if (!nodes && !onWikiNavigate && !onWikiBroken) return undefined
    const docs = listDocsInTreeOrder(nodes ?? [])
    return {
      a: ({ href, children, className, node: _node, ...props }) => {
        const wikiTitle = titleFromWikiHref(href)
        if (wikiTitle == null) {
          // Match MarkdownBody default: shell-open external links.
          return (
            <a
              href={href}
              className={cn(
                'cursor-pointer underline hover:opacity-80',
                className,
              )}
              onClick={async (e) => {
                e.preventDefault()
                if (!href) return
                try {
                  const { open } = await import('@tauri-apps/plugin-shell')
                  await open(href)
                } catch {
                  window.open(href, '_blank', 'noopener,noreferrer')
                }
              }}
              {...props}
            >
              {children}
            </a>
          )
        }

        const resolved = resolveWikiTitle(wikiTitle, docs)
        const broken = resolved == null
        return (
          <a
            href={href}
            data-testid={
              broken ? 'knowledge-wiki-link-broken' : 'knowledge-wiki-link'
            }
            data-wiki-title={wikiTitle}
            data-wiki-doc-id={resolved?.id}
            title={
              broken
                ? t('knowledge.wiki.brokenHint', { title: wikiTitle })
                : t('knowledge.wiki.openHint', { title: resolved.title })
            }
            className={cn(
              'cursor-pointer underline',
              broken
                ? 'text-danger decoration-danger/70 decoration-wavy underline-offset-2 hover:opacity-90'
                : 'text-accent-strong hover:opacity-80',
              className,
            )}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (resolved) {
                onWikiNavigate?.(resolved.id)
              } else {
                onWikiBroken?.(wikiTitle)
              }
            }}
            {...props}
          >
            {children}
          </a>
        )
      },
    }
  }, [nodes, onWikiBroken, onWikiNavigate, t])

  if (!content.trim()) {
    return (
      <div data-testid="knowledge-doc-empty">
        <EmptyState
          icon={FileText}
          title={t('knowledge.doc.emptyTitle')}
          description={t('knowledge.doc.emptyHint')}
          className="border-0 py-20"
          action={
            onStartEdit
              ? { label: t('knowledge.doc.edit'), onClick: onStartEdit }
              : undefined
          }
        />
      </div>
    )
  }

  return (
    <div data-testid="knowledge-doc-reader">
      <MarkdownBody content={previewMd} components={components} />
    </div>
  )
}
