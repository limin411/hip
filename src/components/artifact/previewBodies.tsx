/**
 * Rich file-preview bodies for code (Shiki), JSON tree, and CSV/TSV tables.
 * Used only by FilePreview — keep side-effect free pure helpers in sibling modules.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import { openWithDefaultApp } from '@/ipc/openPath'
import { resolvePathUnderCwd } from '@/lib/pathScope'
import { highlightLangFromPath } from './previewLang'
import {
  CSV_PREVIEW_MAX_ROWS,
  delimiterForPath,
  parseDelimited,
} from './parseDelimited'
import {
  htmlForIframe,
  shouldAutoRenderHtml,
} from './htmlPreviewPolicy'

function TruncBanner({ text }: { text: string }) {
  return (
    <div className="mb-2 rounded-md bg-surface-muted/80 px-2.5 py-1 text-meta text-ink-tertiary">
      {text}
    </div>
  )
}

/** Theme observer for Shiki light/dark. */
function useIsDark(enabled: boolean): boolean {
  const [dark, setDark] = useState(() =>
    typeof document !== 'undefined'
      ? document.documentElement.classList.contains('dark')
      : false,
  )
  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return
    const root = document.documentElement
    const sync = () => setDark(root.classList.contains('dark'))
    sync()
    const obs = new MutationObserver(sync)
    obs.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [enabled])
  return dark
}

function ModeToggle({
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
              ? 'bg-surface text-ink shadow-sm'
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

function PlainPre({ content, testid }: { content: string; testid?: string }) {
  return (
    <pre
      className="whitespace-pre-wrap break-words font-mono text-meta text-ink"
      data-testid={testid}
    >
      {content}
    </pre>
  )
}

// ── Code (Shiki) ────────────────────────────────────────────────────────────

export function CodePreviewBody({
  path,
  content,
  truncated,
  truncatedLabel,
}: {
  path: string
  content: string
  truncated?: boolean
  truncatedLabel: string
}) {
  const lang = highlightLangFromPath(path)
  const isDark = useIsDark(true)
  const [html, setHtml] = useState<string | null>(null)

  useEffect(() => {
    if (!lang || !content) {
      setHtml(null)
      return
    }
    let cancelled = false
    void import('@/lib/shikiLazy')
      .then(({ highlightCode }) => highlightCode(content, lang, isDark))
      .then((h) => {
        if (!cancelled) setHtml(h)
      })
      .catch(() => {
        if (!cancelled) setHtml(null)
      })
    return () => {
      cancelled = true
    }
  }, [content, lang, isDark])

  return (
    <div className="h-full overflow-auto p-4" data-testid="preview-code">
      {truncated && <TruncBanner text={truncatedLabel} />}
      {html ? (
        <pre
          className="whitespace-pre-wrap break-words font-mono text-meta text-ink [&_.line]:whitespace-pre-wrap"
          data-testid="preview-code-highlighted"
          // Shiki token HTML only (same trust model as knowledge CodeBlock).
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <PlainPre content={content} testid="preview-code-plain" />
      )}
    </div>
  )
}

// ── JSON tree ───────────────────────────────────────────────────────────────

function jsonTypeLabel(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return `array[${value.length}]`
  return typeof value
}

function JsonScalar({ value }: { value: unknown }) {
  if (value === null) {
    return <span className="text-ink-tertiary">null</span>
  }
  if (typeof value === 'string') {
    return <span className="text-emerald-700 dark:text-emerald-400">"{value}"</span>
  }
  if (typeof value === 'number') {
    return <span className="text-sky-700 dark:text-sky-400">{String(value)}</span>
  }
  if (typeof value === 'boolean') {
    return <span className="text-amber-700 dark:text-amber-400">{String(value)}</span>
  }
  return <span className="text-ink-tertiary">{String(value)}</span>
}

function JsonNode({
  name,
  value,
  depth,
  defaultOpen,
}: {
  name?: string
  value: unknown
  depth: number
  defaultOpen: boolean
}) {
  const isContainer = value !== null && typeof value === 'object'
  const [open, setOpen] = useState(defaultOpen)

  if (!isContainer) {
    return (
      <div className="flex flex-wrap gap-x-1.5 font-mono text-meta leading-relaxed">
        {name != null && (
          <span className="text-violet-700 dark:text-violet-300">{name}:</span>
        )}
        <JsonScalar value={value} />
      </div>
    )
  }

  const entries = Array.isArray(value)
    ? value.map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>)

  return (
    <div className="font-mono text-meta">
      <button
        type="button"
        className="inline-flex max-w-full items-center gap-0.5 rounded px-0.5 text-left hover:bg-surface-muted/60"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="size-3.5 shrink-0 text-ink-tertiary" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-ink-tertiary" />
        )}
        {name != null && (
          <span className="text-violet-700 dark:text-violet-300">{name}:</span>
        )}
        <span className="text-ink-tertiary">{jsonTypeLabel(value)}</span>
      </button>
      {open && (
        <div className="ml-3 border-l border-border/70 pl-2">
          {entries.length === 0 ? (
            <div className="text-ink-tertiary">{Array.isArray(value) ? '[]' : '{}'}</div>
          ) : (
            entries.map(([k, v]) => (
              <JsonNode
                key={k}
                name={k}
                value={v}
                depth={depth + 1}
                defaultOpen={depth + 1 < 2}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

export function JsonPreviewBody({
  content,
  truncated,
  truncatedLabel,
}: {
  content: string
  truncated?: boolean
  truncatedLabel: string
}) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'tree' | 'source'>('tree')

  const parsed = useMemo(() => {
    try {
      return { ok: true as const, value: JSON.parse(content) as unknown }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { ok: false as const, error: msg }
    }
  }, [content])

  // Invalid JSON → force source; still allow toggle after user sees the error.
  useEffect(() => {
    if (!parsed.ok) setMode('source')
  }, [parsed.ok])

  return (
    <div className="flex h-full min-h-0 flex-col p-4" data-testid="preview-json">
      {truncated && <TruncBanner text={truncatedLabel} />}
      {!parsed.ok && (
        <div
          className="mb-2 rounded-md bg-amber-500/10 px-2.5 py-1 text-meta text-amber-800 dark:text-amber-200"
          data-testid="preview-json-error"
        >
          {t('artifact.previewJsonInvalid')}: {parsed.error}
        </div>
      )}
      <ModeToggle
        testidPrefix="preview-json"
        className="mb-2"
        modes={[
          { id: 'tree', label: t('artifact.previewViewTree') },
          { id: 'source', label: t('artifact.previewViewSource') },
        ]}
        value={mode}
        onChange={(id) => setMode(id as 'tree' | 'source')}
      />
      <div className="min-h-0 flex-1 overflow-auto">
        {mode === 'tree' && parsed.ok ? (
          <div data-testid="preview-json-tree">
            <JsonNode value={parsed.value} depth={0} defaultOpen />
          </div>
        ) : (
          <PlainPre content={content} testid="preview-json-source" />
        )}
      </div>
    </div>
  )
}

// ── CSV / TSV table ─────────────────────────────────────────────────────────

export function CsvPreviewBody({
  path,
  content,
  truncated,
  truncatedLabel,
}: {
  path: string
  content: string
  truncated?: boolean
  truncatedLabel: string
}) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'table' | 'source'>('table')
  const delimiter = delimiterForPath(path)

  const allRows = useMemo(
    () => parseDelimited(content, delimiter),
    [content, delimiter],
  )
  const totalRows = allRows.length
  const shownRows = allRows.slice(0, CSV_PREVIEW_MAX_ROWS)
  const header = shownRows[0]
  const body = shownRows.slice(1)
  const rowCapped = totalRows > CSV_PREVIEW_MAX_ROWS

  return (
    <div className="flex h-full min-h-0 flex-col p-4" data-testid="preview-csv">
      {truncated && <TruncBanner text={truncatedLabel} />}
      {rowCapped && (
        <div className="mb-2 rounded-md bg-surface-muted/80 px-2.5 py-1 text-meta text-ink-tertiary">
          {t('artifact.previewCsvTruncated', {
            shown: CSV_PREVIEW_MAX_ROWS,
            total: totalRows,
          })}
        </div>
      )}
      <ModeToggle
        testidPrefix="preview-csv"
        className="mb-2"
        modes={[
          { id: 'table', label: t('artifact.previewViewTable') },
          { id: 'source', label: t('artifact.previewViewSource') },
        ]}
        value={mode}
        onChange={(id) => setMode(id as 'table' | 'source')}
      />
      <div className="min-h-0 flex-1 overflow-auto">
        {mode === 'source' ? (
          <PlainPre content={content} testid="preview-csv-source" />
        ) : totalRows === 0 ? (
          <div className="text-meta text-ink-tertiary" data-testid="preview-csv-empty">
            {t('artifact.previewCsvEmpty')}
          </div>
        ) : (
          <table
            className="w-max min-w-full border-collapse text-left font-mono text-meta"
            data-testid="preview-csv-table"
          >
            {header && (
              <thead>
                <tr className="border-b border-border bg-surface-subtle">
                  {header.map((cell, i) => (
                    <th
                      key={i}
                      className="whitespace-pre-wrap break-words px-2 py-1.5 font-medium text-ink"
                    >
                      {cell}
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {body.map((row, ri) => (
                <tr key={ri} className="border-b border-border/60 odd:bg-surface-muted/30">
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className="max-w-[24rem] whitespace-pre-wrap break-words px-2 py-1 text-ink"
                    >
                      {cell}
                    </td>
                  ))}
                  {/* Pad short rows to header width */}
                  {header &&
                    row.length < header.length &&
                    Array.from({ length: header.length - row.length }).map((_, i) => (
                      <td key={`pad-${i}`} className="px-2 py-1" />
                    ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

/** Shared shell for plain text (non-code) preview. */
export function TextPreviewBody({
  content,
  truncated,
  truncatedLabel,
}: {
  content: string
  truncated?: boolean
  truncatedLabel: string
}): ReactNode {
  return (
    <div className="h-full overflow-auto p-4" data-testid="preview-text">
      {truncated && <TruncBanner text={truncatedLabel} />}
      <PlainPre content={content} />
    </div>
  )
}

// ── HTML (iframe, size-gated + deferred mount) ──────────────────────────────

/**
 * Large HTML via srcDoc freezes the WebView (sync DOM parse). Policy:
 * - small docs: auto-render after a deferred tick
 * - large docs: default to source; user must click "Render"
 * - hard cap on srcDoc payload even after opt-in
 */
export function HtmlPreviewBody({
  path,
  content,
  cwd,
  truncated,
  truncatedLabel,
}: {
  path: string
  content: string
  cwd?: string | null
  truncated?: boolean
  truncatedLabel: string
}) {
  const { t } = useTranslation()
  const large = !shouldAutoRenderHtml(content)
  const [mode, setMode] = useState<'render' | 'source'>(() => (large ? 'source' : 'render'))
  const [iframeReady, setIframeReady] = useState(false)
  // Resolve relative deliverables (e.g. roundtable-report.html) against session cwd.
  const absolutePath = resolvePathUnderCwd(cwd, path) ?? (path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) ? path : null)
  const canOpenBrowser = Boolean(cwd && absolutePath)

  // Reset mode when the selected file changes.
  useEffect(() => {
    setMode(shouldAutoRenderHtml(content) ? 'render' : 'source')
  }, [path, content])

  // Defer iframe mount so chrome / toggle paint before the browser parses HTML.
  useEffect(() => {
    if (mode !== 'render') {
      setIframeReady(false)
      return
    }
    setIframeReady(false)
    let cancelled = false
    const timer = window.setTimeout(() => {
      if (!cancelled) setIframeReady(true)
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [mode, content])

  const { srcDoc, hardTruncated } = useMemo(() => htmlForIframe(content), [content])

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="preview-html-shell">
      {/* Compact toolbar: path + mode + open browser on one row */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border/80 bg-surface-subtle px-2 py-1">
        <div
          className="min-w-0 flex-1 truncate font-mono text-caption text-ink-tertiary"
          data-testid="preview-chrome"
          title={absolutePath ?? path}
        >
          {path}
        </div>
        <ModeToggle
          testidPrefix="preview-html"
          modes={[
            { id: 'render', label: t('artifact.previewViewRendered') },
            { id: 'source', label: t('artifact.previewViewSource') },
          ]}
          value={mode}
          onChange={(id) => setMode(id as 'render' | 'source')}
        />
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
      </div>
      <div className="flex min-h-0 flex-1 flex-col p-3">
        {truncated && <TruncBanner text={truncatedLabel} />}
        {large && (
          <div
            className="mb-2 shrink-0 rounded-md bg-amber-500/10 px-2.5 py-1.5 text-meta text-amber-900 dark:text-amber-100"
            data-testid="preview-html-large-warn"
          >
            {t('artifact.previewHtmlLarge')}
          </div>
        )}
        {hardTruncated && mode === 'render' && (
          <div className="mb-2 shrink-0 rounded-md bg-surface-muted/80 px-2.5 py-1 text-meta text-ink-tertiary">
            {t('artifact.previewHtmlHardTruncated')}
          </div>
        )}
        {/*
          Outer must NOT scroll — a full-height iframe inside overflow-auto leaves a
          dead outer scrollbar. Give the iframe a bounded box and let its document scroll.
        */}
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-md border border-border/50 bg-white dark:bg-surface">
          {mode === 'source' ? (
            <div className="h-full overflow-auto">
              <PlainPre content={content} testid="preview-html-source" />
            </div>
          ) : !iframeReady ? (
            <div
              className="flex h-full items-center justify-center text-meta text-ink-tertiary"
              data-testid="preview-html-pending"
            >
              {t('artifact.loading')}
            </div>
          ) : (
            <iframe
              data-testid="preview-html"
              title="preview"
              sandbox=""
              className="absolute inset-0 h-full w-full border-0 bg-white"
              srcDoc={srcDoc}
            />
          )}
        </div>
      </div>
    </div>
  )
}
