import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import { useFsScope } from '@/store/useFsScope'
import { useFsStore } from '@/store/fsStore'
import { cn } from '@/lib/utils'
import { previewKind } from './previewKind'

const PROSE = `
  max-w-none text-[14px] leading-relaxed text-ink
  [&_h1]:mb-3 [&_h1]:mt-1 [&_h1]:text-[22px] [&_h1]:font-bold [&_h1]:tracking-tight
  [&_h2]:mb-2 [&_h2]:mt-6 [&_h2]:text-[16px] [&_h2]:font-bold [&_h2]:tracking-tight
  [&_p]:my-2.5
  [&_ul]:my-2.5 [&_ul]:list-disc [&_ul]:pl-5
  [&_pre]:my-3 [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:bg-surface-muted [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-[12.5px]
  [&_code]:font-mono
  [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-ink-secondary
  [&_table]:my-3 [&_table]:w-full [&_table]:border-collapse
  [&_th]:border [&_th]:border-border [&_th]:bg-surface-muted [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left
  [&_td]:border [&_td]:border-border [&_td]:px-2.5 [&_td]:py-1.5
`

function Centered({ text, testid }: { text: string; testid: string }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-ink-tertiary" data-testid={testid}>
      {text}
    </div>
  )
}

function TruncBanner({ text }: { text: string }) {
  return <div className="mb-2 rounded bg-surface-muted px-2 py-1 text-[12px] text-ink-tertiary">{text}</div>
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

  if (kind === 'html') {
    return <iframe data-testid="preview-html" title="preview" sandbox="" className="h-full w-full border-0 bg-white" srcDoc={preview.content} />
  }

  if (kind === 'markdown') {
    return (
      <article className={cn('h-full overflow-auto p-4', PROSE)} data-testid="preview-markdown">
        {preview.truncated && <TruncBanner text={t('artifact.previewTruncated')} />}
        <ReactMarkdown>{preview.content}</ReactMarkdown>
      </article>
    )
  }

  return (
    <div className="h-full overflow-auto p-4" data-testid="preview-text">
      {preview.truncated && <TruncBanner text={t('artifact.previewTruncated')} />}
      <pre className="whitespace-pre-wrap break-words font-mono text-[12.5px] text-ink">{preview.content}</pre>
    </div>
  )
}
