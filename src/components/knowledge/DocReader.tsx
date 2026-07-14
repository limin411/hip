import { useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText } from 'lucide-react'
import { MarkdownBody } from '@/components/chat/MarkdownBody'
import { EmptyState } from '@/components/ui/EmptyState'
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

  // Rebuild components every render so taskIndex / heading-id assigner reset.
  // Memoizing this object across re-renders causes index/id drift (#1, #2).
  const components = knowledgeMarkdownComponents({
    onTaskToggle,
    getScrollRoot: () => rootRef.current,
  })

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
