/**
 * Shared HTML-preview chrome: rendered/source mode toggle, open-in-default-browser
 * button, and cwd-scoped absolute-path resolution.
 *
 * Used by HtmlPreviewBody's toolbar (code panel) and by the chat panel titlebar
 * (right of the artifact file dropdown), so both surfaces render identical controls.
 */
import { useTranslation } from 'react-i18next'
import { ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import { openWithDefaultApp } from '@/ipc/openPath'
import { resolvePathUnderCwd } from '@/lib/pathScope'

/**
 * Resolve an HTML deliverable path to an absolute path under the session cwd.
 * Root-relative forms (`/index.html`, the documented write_file style) are jailed
 * under cwd by the sidecar's path resolver, so resolve them the same way first.
 */
export function resolvePreviewAbsolutePath(
  path: string,
  cwd?: string | null,
): string | null {
  return (
    resolvePathUnderCwd(cwd, path) ??
    resolvePathUnderCwd(cwd, path.replace(/^[/\\]+/, '')) ??
    (path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) ? path : null)
  )
}

export function ModeToggle({
  modes,
  value,
  onChange,
  testidPrefix,
  className,
}: {
  modes: Array<{ id: string; label: string }>
  value: string
  onChange: (id: string) => void
  testidPrefix: string
  className?: string
}) {
  return (
    <div
      className={cn(
        'inline-flex shrink-0 rounded-md border border-border/80 bg-surface-muted/60 p-0.5',
        className,
      )}
      role="tablist"
      data-testid={`${testidPrefix}-mode`}
    >
      {modes.map((m) => (
        <button
          key={m.id}
          type="button"
          role="tab"
          aria-selected={value === m.id}
          data-testid={`${testidPrefix}-mode-${m.id}`}
          className={cn(
            'rounded px-2 py-0.5 text-caption transition-colors',
            value === m.id
              ? 'bg-surface text-ink'
              : 'text-ink-tertiary hover:text-ink',
          )}
          onClick={() => onChange(m.id)}
        >
          {m.label}
        </button>
      ))}
    </div>
  )
}

/** Open the HTML deliverable in the OS default browser (disabled outside cwd). */
export function HtmlOpenBrowserButton({
  absolutePath,
  canOpenBrowser,
  cwd,
}: {
  absolutePath: string | null
  canOpenBrowser: boolean
  cwd?: string | null
}) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      data-testid="preview-html-open-browser"
      disabled={!canOpenBrowser}
      title={
        canOpenBrowser
          ? t('artifact.previewHtmlOpenBrowser')
          : t('contextMenu.file.pathOutsideCwd')
      }
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-md border border-border/80 bg-surface px-2 py-0.5 text-caption text-ink',
        'hover:bg-surface-muted disabled:pointer-events-none disabled:opacity-40',
      )}
      onClick={() => {
        if (!canOpenBrowser || !absolutePath) return
        void openWithDefaultApp(absolutePath, { cwd: cwd ?? null })
      }}
    >
      <ExternalLink className="size-3 shrink-0" aria-hidden />
      <span className="max-w-[10rem] truncate sm:max-w-none">
        {t('artifact.previewHtmlOpenBrowser')}
      </span>
    </button>
  )
}
