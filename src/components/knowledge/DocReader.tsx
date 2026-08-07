/**
 * Read-only Markdown body (preview / embed / export paths).
 * Not a writing surface — Live (BlockNote) and Source (CodeMirror) own editing.
 */
import { createElement, useCallback, useMemo, useRef, type ComponentType } from 'react'
import type { Components, ExtraProps } from 'react-markdown'
import type { AnchorHTMLAttributes, ClassAttributes } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText } from 'lucide-react'
import { KnowledgeMarkdownBody } from './KnowledgeMarkdownBody'
import { EmptyState } from '@/components/ui/EmptyState'
import { headingIdsBySourceLine } from '@/domain/knowledge/mdPreview'
import { toggleTaskAt } from '@/domain/knowledge/mdTasks'
import type { KnowledgeNode } from '@/domain/knowledge/types'
import {
  listDocsInTreeOrder,
  resolveWikiTitle,
  rewriteWikiLinksForPreview,
  wikiPartsFromHref,
} from '@/domain/knowledge/wikiLink'
import { extractDocOutline, slugifyHeading } from '@/domain/knowledge/mdPreview'
import { splitByEmbeds } from '@/domain/knowledge/embedSplit'
import { cn } from '@/lib/utils'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import { knowledgeMarkdownComponents } from './knowledgeMarkdownComponents'
import { KnowledgeEmbedCard } from './KnowledgeEmbedCard'

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
  /** Navigate to a resolved wiki target (optional heading fragment text). */
  onWikiNavigate?: (docId: string, fragment?: string | null) => void
  /** Broken wiki click → parent shows confirm-create modal. */
  onWikiBroken?: (title: string) => void
  /** Same-doc heading jump (e.g. `[[#Intro]]`). */
  onWikiHeadingJump?: (fragment: string) => void
}

export function DocReader({
  content,
  onStartEdit,
  nodes,
  onWikiNavigate,
  onWikiBroken,
  onWikiHeadingJump,
}: DocReaderProps) {
  const { t } = useTranslation()
  const setDraftBody = useKnowledgeStore((s) => s.setDraftBody)
  const activeSpaceId = useKnowledgeStore((s) => s.activeSpaceId)
  const activeDocId = useKnowledgeStore((s) => s.activeDocId)
  const requestOutlineJump = useKnowledgeStore((s) => s.requestOutlineJump)
  const rootRef = useRef<HTMLDivElement>(null)

  const jumpToFragment = useCallback(
    (fragment: string) => {
      if (onWikiHeadingJump) {
        onWikiHeadingJump(fragment)
        return
      }
      const outline = extractDocOutline(content)
      const hit =
        outline.find((o) => o.text === fragment) ||
        outline.find((o) => o.text.toLowerCase() === fragment.toLowerCase()) ||
        outline.find((o) => slugifyHeading(o.text) === slugifyHeading(fragment)) ||
        outline.find((o) => o.id === slugifyHeading(fragment))
      if (hit) requestOutlineJump(hit)
    },
    [content, onWikiHeadingJump, requestOutlineJump],
  )

  const onTaskToggle = useCallback(
    (taskIndex: number) => {
      const { draftBody, docBody } = useKnowledgeStore.getState()
      const source = draftBody || docBody
      const next = toggleTaskAt(source, taskIndex)
      if (next !== source) {
        setDraftBody(next, { persist: 'now' })
      }
    },
    [setDraftBody],
  )

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

  const segments = useMemo(() => splitByEmbeds(content), [content])

  const wikiComponents = useMemo((): Components => {
    if (!nodes && !onWikiNavigate && !onWikiBroken) return baseComponents
    const docs = listDocsInTreeOrder(nodes ?? [])
    const baseA = baseComponents.a
    return {
      ...baseComponents,
      a: (props) => {
        const { href, children, className, node: _node, ...rest } = props
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
            <a
              href={href}
              className={cn('cursor-pointer underline hover:opacity-80', className)}
              {...rest}
            >
              {children}
            </a>
          )
        }

        const docTitle = parts.title
        const fragment = parts.fragment

        if (!docTitle && fragment) {
          return (
            <a
              href={href}
              data-testid="knowledge-wiki-link"
              data-wiki-title={`#${fragment}`}
              data-wiki-doc-id={activeDocId ?? undefined}
              title={t('knowledge.wiki.openHint', { title: `#${fragment}` })}
              className={cn(
                'cursor-pointer underline text-accent-strong hover:opacity-80',
                className,
              )}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                jumpToFragment(fragment)
              }}
              {...rest}
            >
              {children}
            </a>
          )
        }

        const resolved = resolveWikiTitle(docTitle, docs)
        const broken = resolved == null
        const displayTitle = docTitle || parts.title
        return (
          <a
            href={href}
            data-testid={broken ? 'knowledge-wiki-link-broken' : 'knowledge-wiki-link'}
            data-wiki-title={displayTitle}
            data-wiki-fragment={fragment ?? undefined}
            data-wiki-doc-id={resolved?.id}
            title={
              broken
                ? t('knowledge.wiki.brokenHint', { title: displayTitle })
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
                onWikiNavigate?.(resolved.id, fragment)
              } else {
                onWikiBroken?.(displayTitle)
              }
            }}
            {...rest}
          >
            {children}
          </a>
        )
      },
    }
  }, [
    activeDocId,
    baseComponents,
    jumpToFragment,
    nodes,
    onWikiBroken,
    onWikiNavigate,
    t,
  ])

  if (!content.trim()) {
    return (
      <div data-testid="knowledge-doc-empty">
        <EmptyState
          tier="professional"
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

  const tree = nodes ?? []

  return (
    <div
      ref={rootRef}
      data-testid="knowledge-doc-reader"
      className="knowledge-doc-measure w-full"
    >
      {segments.map((seg, i) => {
        if (seg.type === 'md') {
          const text = seg.text
          if (!text.trim()) return null
          const previewMd = rewriteWikiLinksForPreview(text)
          return (
            <KnowledgeMarkdownBody
              key={`md-${i}`}
              content={previewMd}
              components={wikiComponents}
            />
          )
        }
        if (!activeSpaceId) {
          return (
            <p key={`emb-${i}`} className="my-2 text-meta text-ink-tertiary font-mono">
              {seg.raw}
            </p>
          )
        }
        return (
          <KnowledgeEmbedCard
            key={`emb-${i}-${seg.raw}`}
            spaceId={activeSpaceId}
            docTitle={seg.docTitle}
            fragment={seg.fragment}
            display={seg.display}
            raw={seg.raw}
            nodes={tree}
            depth={1}
            onOpenDoc={(docId, frag) => onWikiNavigate?.(docId, frag)}
          />
        )
      })}
    </div>
  )
}
