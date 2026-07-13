import { MarkdownBody } from '@/components/chat/MarkdownBody'

interface DocReaderProps {
  content: string
}

export function DocReader({ content }: DocReaderProps) {
  if (!content.trim()) {
    return (
      <p className="text-body text-ink-tertiary" data-testid="knowledge-doc-empty">
        —
      </p>
    )
  }
  return (
    <div data-testid="knowledge-doc-reader" className="max-w-3xl">
      <MarkdownBody content={content} />
    </div>
  )
}
