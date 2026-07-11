import { useTranslation } from 'react-i18next'
import { useFsScope } from '@/store/useFsScope'
import { useFsStore } from '@/store/fsStore'
import { MarkdownBody } from '@/components/chat/MarkdownBody'
import { previewKind } from './previewKind'

function Centered({ text, testid }: { text: string; testid: string }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-body text-ink-tertiary" data-testid={testid}>
      {text}
    </div>
  )
}

function TruncBanner({ text }: { text: string }) {
  return <div className="mb-2 rounded bg-surface-muted px-2 py-1 text-meta text-ink-tertiary">{text}</div>
}

export function FilePreview() {
  const { t } = useTranslation()
  const scopeId = useFsScope().scopeId
  const preview = useFsStore((s) => (scopeId ? s.bySession[scopeId]?.preview : undefined))

  if (!preview || preview.status === 'idle') return <Centered text={t('artifact.selectFileToPreview')} testid="preview-empty" />
  if (preview.status === 'loading') return <Centered text={t('artifact.loading')} testid="preview-loading" />

  if (preview.error || preview.content == null) {
    const text = preview.error === 'too_large' ? t('artifact.fileTooLarge') : t('artifact.cannotPreview')
    return <Centered text={text} testid="preview-error" />
  }

  const kind = previewKind(preview.path, preview.mimeType)

  if (kind === 'image' && preview.encoding === 'base64') {
    return (
      <div className="h-full overflow-auto p-4" data-testid="preview-image">
        <img alt={preview.path} src={`data:${preview.mimeType};base64,${preview.content}`} className="max-w-full" />
      </div>
    )
  }

  if (kind === 'pdf' && preview.encoding === 'base64') {
    return <iframe data-testid="preview-pdf" title="preview" className="h-full w-full border-0 bg-white" src={`data:${preview.mimeType};base64,${preview.content}`} />
  }

  if (kind === 'html') {
    return <iframe data-testid="preview-html" title="preview" sandbox="" className="h-full w-full border-0 bg-white" srcDoc={preview.content} />
  }

  if (kind === 'markdown') {
    return (
      <article className="h-full overflow-auto p-4" data-testid="preview-markdown">
        {preview.truncated && <TruncBanner text={t('artifact.previewTruncated')} />}
        <MarkdownBody content={preview.content} />
      </article>
    )
  }

  return (
    <div className="h-full overflow-auto p-4" data-testid="preview-text">
      {preview.truncated && <TruncBanner text={t('artifact.previewTruncated')} />}
      <pre className="whitespace-pre-wrap break-words font-mono text-meta text-ink">{preview.content}</pre>
    </div>
  )
}
