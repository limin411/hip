import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useFsScope } from '@/store/useFsScope'
import { useFsStore } from '@/store/fsStore'
import { DeclarativeContextMenu } from '@/components/context-menu'
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
  return <div className="mb-2 rounded-md bg-surface-muted/80 px-2.5 py-1 text-meta text-ink-tertiary">{text}</div>
}

/**
 * Path chrome above full-bleed iframes so right-click reaches the host ContextMenuTrigger.
 * iframe documents swallow contextmenu; design: "Menu on chrome".
 */
function IframePreviewChrome({
  path,
  testid,
  children,
}: {
  path: string
  testid: string
  children: ReactNode
}) {
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid={testid}>
      <div
        className="shrink-0 truncate border-b border-border/80 bg-surface-subtle px-2.5 py-1.5 font-mono text-caption text-ink-tertiary"
        data-testid="preview-chrome"
        title={path}
      >
        {path}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  )
}

/** Layout lives on children so CONTEXT_MENUS=false (bare fragment) does not collapse h-full. */
function withPreviewMenu(
  path: string,
  cwd: string | null | undefined,
  content: string | undefined,
  mimeType: string | undefined,
  child: ReactNode,
) {
  return (
    <DeclarativeContextMenu
      kind="filePreview"
      payload={{
        path,
        content,
        mimeType,
        cwd: cwd ?? null,
      }}
      className="h-full min-h-0"
    >
      {child}
    </DeclarativeContextMenu>
  )
}

export function FilePreview() {
  const { t } = useTranslation()
  const { scopeId, cwd } = useFsScope()
  const preview = useFsStore((s) => (scopeId ? s.bySession[scopeId]?.preview : undefined))

  if (!preview || preview.status === 'idle') return <Centered text={t('artifact.selectFileToPreview')} testid="preview-empty" />

  if (preview.status === 'loading') {
    return withPreviewMenu(
      preview.path,
      cwd,
      undefined,
      undefined,
      <Centered text={t('artifact.loading')} testid="preview-loading" />,
    )
  }

  if (preview.error || preview.content == null) {
    const text = preview.error === 'too_large' ? t('artifact.fileTooLarge') : t('artifact.cannotPreview')
    // Ready-with-error may still carry a path for copy/open/refresh.
    if (preview.path) {
      return withPreviewMenu(
        preview.path,
        cwd,
        undefined,
        preview.mimeType,
        <Centered text={text} testid="preview-error" />,
      )
    }
    return <Centered text={text} testid="preview-error" />
  }

  const kind = previewKind(preview.path, preview.mimeType)
  // Only pass utf8 text content for copy; base64 images/pdf stay out of the clipboard action.
  const textContent =
    preview.encoding === 'base64' ? undefined : preview.content

  if (kind === 'image' && preview.encoding === 'base64') {
    return withPreviewMenu(
      preview.path,
      cwd,
      undefined,
      preview.mimeType,
      <div className="h-full overflow-auto p-4" data-testid="preview-image">
        <img alt={preview.path} src={`data:${preview.mimeType};base64,${preview.content}`} className="max-w-full" />
      </div>,
    )
  }

  if (kind === 'pdf' && preview.encoding === 'base64') {
    return withPreviewMenu(
      preview.path,
      cwd,
      undefined,
      preview.mimeType,
      <IframePreviewChrome path={preview.path} testid="preview-pdf-shell">
        <iframe data-testid="preview-pdf" title="preview" className="h-full w-full border-0 bg-white" src={`data:${preview.mimeType};base64,${preview.content}`} />
      </IframePreviewChrome>,
    )
  }

  if (kind === 'html') {
    return withPreviewMenu(
      preview.path,
      cwd,
      textContent,
      preview.mimeType,
      <IframePreviewChrome path={preview.path} testid="preview-html-shell">
        <iframe data-testid="preview-html" title="preview" sandbox="" className="h-full w-full border-0 bg-white" srcDoc={preview.content} />
      </IframePreviewChrome>,
    )
  }

  if (kind === 'markdown') {
    return withPreviewMenu(
      preview.path,
      cwd,
      textContent,
      preview.mimeType,
      <article className="h-full overflow-auto p-4" data-testid="preview-markdown">
        {preview.truncated && <TruncBanner text={t('artifact.previewTruncated')} />}
        <MarkdownBody content={preview.content} />
      </article>,
    )
  }

  return withPreviewMenu(
    preview.path,
    cwd,
    textContent,
    preview.mimeType,
    <div className="h-full overflow-auto p-4" data-testid="preview-text">
      {preview.truncated && <TruncBanner text={t('artifact.previewTruncated')} />}
      <pre className="whitespace-pre-wrap break-words font-mono text-meta text-ink">{preview.content}</pre>
    </div>,
  )
}
