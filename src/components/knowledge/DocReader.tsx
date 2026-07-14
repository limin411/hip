import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText } from 'lucide-react'
import { MarkdownBody } from '@/components/chat/MarkdownBody'
import { EmptyState } from '@/components/ui/EmptyState'
import { toggleTaskAt } from '@/domain/knowledge/mdTasks'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import { knowledgeMarkdownComponents } from './knowledgeMarkdownComponents'

interface DocReaderProps {
  content: string
  /** Optional CTA when body is empty (preview → edit). */
  onStartEdit?: () => void
}

export function DocReader({ content, onStartEdit }: DocReaderProps) {
  const { t } = useTranslation()
  const setDraftBody = useKnowledgeStore((s) => s.setDraftBody)

  const components = useMemo(
    () =>
      knowledgeMarkdownComponents({
        onTaskToggle: (taskIndex) => {
          // Prefer draftBody so rapid toggles before flush completes stay consistent.
          const { draftBody, docBody } = useKnowledgeStore.getState()
          const source = draftBody || docBody
          const next = toggleTaskAt(source, taskIndex)
          if (next !== source) {
            setDraftBody(next, { persist: 'now' })
          }
        },
      }),
    [setDraftBody],
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
    <div data-testid="knowledge-doc-reader">
      <MarkdownBody content={content} components={components} />
    </div>
  )
}
