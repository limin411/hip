import { useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText } from 'lucide-react'
import { MarkdownBody } from '@/components/chat/MarkdownBody'
import { EmptyState } from '@/components/ui/EmptyState'
import { headingIdsBySourceLine } from '@/domain/knowledge/mdPreview'
import { toggleTaskAt } from '@/domain/knowledge/mdTasks'
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
}

export function DocReader({ content, onStartEdit }: DocReaderProps) {
  const { t } = useTranslation()
  const setDraftBody = useKnowledgeStore((s) => s.setDraftBody)
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

  const components = useMemo(
    () =>
      knowledgeMarkdownComponents({
        onTaskToggle,
        getScrollRoot: () => rootRef.current,
        headingIdsByLine,
      }),
    [onTaskToggle, headingIdsByLine],
  )

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
      <MarkdownBody content={content} components={components} />
    </div>
  )
}
