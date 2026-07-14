import { useTranslation } from 'react-i18next'
import { FileText } from 'lucide-react'
import { MarkdownBody } from '@/components/chat/MarkdownBody'
import { EmptyState } from '@/components/ui/EmptyState'

interface DocReaderProps {
  content: string
}

export function DocReader({ content }: DocReaderProps) {
  const { t } = useTranslation()

  if (!content.trim()) {
    return (
      <div data-testid="knowledge-doc-empty">
        <EmptyState
          icon={FileText}
          title={t('knowledge.doc.emptyTitle')}
          description={t('knowledge.doc.emptyHint')}
          className="border-0 py-16"
        />
      </div>
    )
  }

  return (
    <div data-testid="knowledge-doc-reader">
      <MarkdownBody content={content} />
    </div>
  )
}
