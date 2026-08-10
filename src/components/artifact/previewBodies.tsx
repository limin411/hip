/**
 * Rich file-preview bodies for code (Shiki), JSON tree, and CSV/TSV tables.
 * Used only by FilePreview — keep side-effect free pure helpers in sibling modules.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { sessionService } from '@/domain'
import { useFsScope } from '@/store/useFsScope'
import { useFsStore } from '@/store/fsStore'
import { useUiStore } from '@/store/uiStore'
import { useHipConfigStore } from '@/store/hipConfigStore'
import {
  CODE_BLOCK_CHROME,
  normalizeCodeBlockThemeId,
} from '@/domain/knowledge/codeBlockTheme'
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
import {
  parseHipReportOpenFile,
  prepareHtmlReportForPreview,
  resolveSiblingHtmlFile,
} from './htmlReportNav'
import {
  HtmlOpenBrowserButton,
  ModeToggle,
  resolvePreviewAbsolutePath,
} from './htmlPreviewToolbar'

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

function PlainPre({
  content,
  testid,
  color,
}: {
  content: string
  testid?: string
  color?: string
}) {
  return (
    <pre
      style={color ? { color } : undefined}
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
  const codeBlockTheme = useHipConfigStore((s) =>
    normalizeCodeBlockThemeId(s.config.codeBlock?.colorTheme),
  )
  const chrome = codeBlockTheme !== 'follow' ? CODE_BLOCK_CHROME[codeBlockTheme] : null
  const [html, setHtml] = useState<string | null>(null)

  useEffect(() => {
    if (!lang || !content) {
      setHtml(null)
      return
    }
    let cancelled = false
    void import('@/lib/shikiLazy')
      .then(({ highlightCode }) => highlightCode(content, lang, codeBlockTheme, isDark))
      .then((h) => {
        if (!cancelled) setHtml(h)
      })
      .catch(() => {
        if (!cancelled) setHtml(null)
      })
    return () => {
      cancelled = true
    }
  }, [content, lang, isDark, codeBlockTheme])

  return (
    <div
      className="h-full overflow-auto p-4"
      data-testid="preview-code"
      style={
        chrome
          ? { backgroundColor: chrome.background, borderColor: chrome.border, color: chrome.text }
          : undefined
      }
    >
      {truncated && <TruncBanner text={truncatedLabel} />}
      {html ? (
        <pre
          style={chrome ? { color: chrome.text } : undefined}
          className="whitespace-pre-wrap break-words font-mono text-meta text-ink [&_.line]:whitespace-pre-wrap"
          data-testid="preview-code-highlighted"
          // Shiki token HTML only (same trust model as knowledge CodeBlock).
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <PlainPre content={content} testid="preview-code-plain" color={chrome?.text} />
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
  surface = 'code',
  mode: controlledMode,
  onModeChange,
}: {
  path: string
  content: string
  cwd?: string | null
  truncated?: boolean
  truncatedLabel: string
  /** 'chat' lifts the mode toggle + open-browser button into the chat titlebar. */
  surface?: 'code' | 'chat'
  /** Controlled mode for the chat surface (owned by the titlebar toggle). */
  mode?: 'render' | 'source'
  onModeChange?: (mode: 'render' | 'source') => void
}) {
  const { t } = useTranslation()
  const { scopeId, isDraft } = useFsScope()
  const large = !shouldAutoRenderHtml(content)
  const [localMode, setLocalMode] = useState<'render' | 'source'>(() =>
    large ? 'source' : 'render',
  )
  const controlled = onModeChange != null
  const mode = controlled && controlledMode != null ? controlledMode : localMode
  const [iframeReady, setIframeReady] = useState(false)
  const absolutePath = resolvePreviewAbsolutePath(path, cwd)
  const canOpenBrowser = Boolean(cwd && absolutePath)

  // Reset mode when the selected file changes (code: local state; chat: titlebar owner).
  useEffect(() => {
    const next = shouldAutoRenderHtml(content) ? 'render' : 'source'
    if (controlled) onModeChange(next)
    else setLocalMode(next)
  }, [path, content, controlled, onModeChange])

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

  // Roundtable (and similar) multi-file HTML: sibling links postMessage instead of
  // navigating srcDoc (relative href → blank iframe).
  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const file = parseHipReportOpenFile(ev.data)
      if (!file || !scopeId) return
      const target = resolveSiblingHtmlFile(path, file, cwd)
      if (!target) return
      useFsStore.getState().setActive(scopeId, target)
      if (isDraft) sessionService.readDraftFile(scopeId, target)
      else sessionService.readFile(scopeId, target)
      useUiStore.getState().setSelectedArtifactPath(target)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [path, cwd, scopeId, isDraft])

  const { srcDoc, hardTruncated } = useMemo(
    () => htmlForIframe(prepareHtmlReportForPreview(content)),
    [content],
  )

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="preview-html-shell">
      {/* Compact toolbar: path + mode + open browser on one row (chat surface
          keeps only the path — mode + open-browser live in the titlebar). */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border/80 bg-surface-subtle px-2 py-1">
        <div
          className="min-w-0 flex-1 truncate font-mono text-caption text-ink-tertiary"
          data-testid="preview-chrome"
          title={absolutePath ?? path}
        >
          {path}
        </div>
        {surface !== 'chat' && (
          <>
            <ModeToggle
              testidPrefix="preview-html"
              modes={[
                { id: 'render', label: t('artifact.previewViewRendered') },
                { id: 'source', label: t('artifact.previewViewSource') },
              ]}
              value={mode}
              onChange={(id) => setLocalMode(id as 'render' | 'source')}
            />
            <HtmlOpenBrowserButton
              absolutePath={absolutePath}
              canOpenBrowser={canOpenBrowser}
              cwd={cwd}
            />
          </>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {(truncated || large || (hardTruncated && mode === 'render')) && (
          <div className="shrink-0 space-y-2 px-3 pt-3 pb-2">
            {truncated && <TruncBanner text={truncatedLabel} />}
            {large && (
              <div
                className="rounded-md bg-amber-500/10 px-2.5 py-1.5 text-meta text-amber-900 dark:text-amber-100"
                data-testid="preview-html-large-warn"
              >
                {t('artifact.previewHtmlLarge')}
              </div>
            )}
            {hardTruncated && mode === 'render' && (
              <div className="rounded-md bg-surface-muted/80 px-2.5 py-1 text-meta text-ink-tertiary">
                {t('artifact.previewHtmlHardTruncated')}
              </div>
            )}
          </div>
        )}
        {/*
          Outer must NOT scroll — a full-height iframe inside overflow-auto leaves a
          dead outer scrollbar. Give the iframe a bounded box and let its document scroll.
        */}
        <div className="relative min-h-0 flex-1 overflow-hidden bg-white dark:bg-surface">
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
              // allow-scripts: in-page TOC jump (srcDoc hash nav blanks WebView).
              // No allow-same-origin → script cannot touch parent app.
              sandbox="allow-scripts"
              // Transparent: parent supplies page bg; avoids white gutter beside dark srcDoc scrollbars.
              className="absolute inset-0 h-full w-full border-0 bg-transparent"
              style={{ colorScheme: 'light dark' }}
              srcDoc={srcDoc}
            />
          )}
        </div>
      </div>
    </div>
  )
}
