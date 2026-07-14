import { createElement, useCallback, useMemo, useRef, type ComponentType } from 'react'
import type { Components, ExtraProps } from 'react-markdown'
import type { AnchorHTMLAttributes, ClassAttributes } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText } from 'lucide-react'
import { MarkdownBody } from '@/components/chat/MarkdownBody'
import { EmptyState } from '@/components/ui/EmptyState'
import { headingIdsBySourceLine } from '@/domain/knowledge/mdPreview'
import { toggleTaskAt } from '@/domain/knowledge/mdTasks'
import type { KnowledgeNode } from '@/domain/knowledge/types'
import {
  listDocsInTreeOrder,
  resolveWikiTitle,
  rewriteWikiLinksForPreview,
  titleFromWikiHref,
} from '@/domain/knowledge/wikiLink'
import { cn } from '@/lib/utils'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import { knowledgeMarkdownComponents } from './knowledgeMarkdownComponents'

interface DocReaderProps {
  /**
   * Markdown to render. Preview callers should pass `draftBody` (or
   * `draftBody || docBody`) so task write-back is optimistic before flush.
   */
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
  const setDraftBody = useKnowledgeStore((s) => s.setDraftBody)
  const activeSpaceId = useKnowledgeStore((s) => s.activeSpaceId)
  const rootRef = useRef<HTMLDivElement>(null)

  const onTaskToggle = useCallback(
    (taskIndex: number) => {
      // Prefer draftBody so rapid toggles before flush completes stay consistent.
      const { draftBody, docBody } = useKnowledgeStore.getState()
      const source = draftBody || docBody
      const next = toggleTaskAt(source, taskIndex)
      if (next !== source) {
        setDraftBody(next, { persist: 'now' })
      }
    },
    [setDraftBody],
  )

  // Pure precompute from content — stable under StrictMode (no render counters).
  const headingIdsByLine = useMemo(() => headingIdsBySourceLine(content), [content])

  const baseComponents = useMemo(
    () =>
      knowledgeMarkdownComponents({
        onTaskToggle,
        getScrollRoot: () => rootRef.current,
        headingIdsByLine,
        spaceId: activeSpaceId,
      }),
    [onTaskToggle, headingIdsByLine, activeSpaceId],
  )

  const previewMd = useMemo(
    () => (content.trim() ? rewriteWikiLinksForPreview(content) : content),
    [content],
  )

  const components = useMemo((): Components => {
    if (!nodes && !onWikiNavigate && !onWikiBroken) return baseComponents
    const docs = listDocsInTreeOrder(nodes ?? [])
    const baseA = baseComponents.a
    return {
      ...baseComponents,
      a: (props) => {
        const { href, children, className, node: _node, ...rest } = props
        const wikiTitle = titleFromWikiHref(href)
        if (wikiTitle == null) {
          // Fall back to knowledge base link handler (anchors / external / #heading).
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
            <a
              href={href}
              className={cn('cursor-pointer underline hover:opacity-80', className)}
              {...rest}
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
            data-testid={broken ? 'knowledge-wiki-link-broken' : 'knowledge-wiki-link'}
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
            {...rest}
          >
            {children}
          </a>
        )
      },
    }
  }, [baseComponents, nodes, onWikiBroken, onWikiNavigate, t])

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
    <div ref={rootRef} data-testid="knowledge-doc-reader">
      <MarkdownBody content={previewMd} components={components} />
    </div>
  )
}
