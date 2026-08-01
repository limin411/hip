import {
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactElement,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Check } from 'lucide-react'
import { DeclarativeContextMenu } from '@/components/context-menu'
import { copyText } from '@/ipc/clipboard'
import { cn } from '@/lib/utils'
import { normalizeHighlightLang } from '@/domain/knowledge/codeHighlight'
import {
  CODEBLOCK_LAZY_HIGHLIGHT,
  CODEBLOCK_STRUCTURE_CRAFT,
} from './craftFeature'

const FOLD_LINE_THRESHOLD = 24
const FOLD_PREVIEW_LINES = 12
const MAX_HIGHLIGHT_CODE_UNITS = 50_000

/** Extract the raw code text from react-markdown's <pre> children (a <code> element). */
function codeTextOf(children: unknown): string {
  const el = children as ReactElement<{ children?: unknown }> | undefined
  const inner = el?.props?.children
  return (typeof inner === 'string' ? inner : '').replace(/\n$/, '')
}

/**
 * Optional language class from the inner <code class="language-…">.
 * Allows `#` / `+` so `language-c#` / `language-c++` survive for aliases.
 */
function languageOf(children: unknown): string | undefined {
  const el = children as ReactElement<{ className?: string }> | undefined
  const cls = el?.props?.className ?? ''
  const m = /language-(\S+)/.exec(cls)
  return m?.[1]
}

/** Theme observer only when highlighting is enabled. */
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

export type CodeBlockProps = ComponentPropsWithoutRef<'pre'> & {
  node?: unknown
  /**
   * Lazy Shiki highlight (knowledge Reader / embed). Default false so chat
   * pays zero cost and never statically imports the highlighter.
   * When true, forces highlight (knowledge path) regardless of craft flags.
   */
  syntaxHighlight?: boolean
  /** Optional path label — producer must pass; chat P0 does not parse fences. */
  filePath?: string
  /** When structure flag on: allow fold. Default true under flag. */
  foldLong?: boolean
  /** Message still streaming — disables fold + lazy highlight. */
  isStreaming?: boolean
}

/**
 * Replacement for the markdown `pre` element: owns fenced-code chrome and
 * external vertical spacing (KD11).
 *
 * Shiki is loaded only via dynamic `import('@/lib/shikiLazy')` when highlighting
 * is requested — chat MarkdownBody stays off the shiki static graph.
 */
export function CodeBlock({
  children,
  node,
  syntaxHighlight = false,
  filePath,
  foldLong,
  isStreaming = false,
  ...props
}: CodeBlockProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [inView, setInView] = useState(false)
  const hostRef = useRef<HTMLDivElement>(null)
  const code = codeTextOf(children)
  const language = languageOf(children)
  const lines = code ? code.split('\n') : []
  const lineCount = lines.length

  const structureOn = CODEBLOCK_STRUCTURE_CRAFT
  const allowFold =
    structureOn &&
    foldLong !== false &&
    !isStreaming &&
    lineCount >= FOLD_LINE_THRESHOLD
  const folded = allowFold && !expanded
  const displayCode = folded
    ? lines.slice(0, FOLD_PREVIEW_LINES).join('\n')
    : code

  const wantHighlight =
    syntaxHighlight ||
    (CODEBLOCK_LAZY_HIGHLIGHT && !isStreaming && inView && code.length <= MAX_HIGHLIGHT_CODE_UNITS)

  const isDark = useIsDark(wantHighlight)
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null)

  // IntersectionObserver for lazy highlight (only when craft flag on and not parent-forced).
  useEffect(() => {
    if (syntaxHighlight || !CODEBLOCK_LAZY_HIGHLIGHT || isStreaming) {
      if (syntaxHighlight) setInView(true)
      return
    }
    const el = hostRef.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setInView(true)
        }
      },
      { root: null, rootMargin: '80px 0px', threshold: 0.01 },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [syntaxHighlight, isStreaming])

  useEffect(() => {
    if (!wantHighlight) {
      if (!syntaxHighlight) setHighlightedHtml(null)
      return
    }
    if (code.length > MAX_HIGHLIGHT_CODE_UNITS && !syntaxHighlight) {
      setHighlightedHtml(null)
      return
    }
    const canonical = normalizeHighlightLang(language)
    if (!canonical || !code) {
      setHighlightedHtml(null)
      return
    }
    let cancelled = false
    void import('@/lib/shikiLazy')
      .then(({ highlightCode }) => highlightCode(code, canonical, isDark))
      .then((html) => {
        if (!cancelled) setHighlightedHtml(html)
      })
      .catch(() => {
        if (!cancelled) setHighlightedHtml(null)
      })
    return () => {
      cancelled = true
    }
  }, [wantHighlight, syntaxHighlight, code, language, isDark])

  const onCopy = async () => {
    // Copy always uses full text (even when folded).
    if (code && (await copyText(code))) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  const headerLabel = filePath || language || ''

  return (
    <DeclarativeContextMenu
      kind="codeBlock"
      payload={{ code, language }}
      className="my-2"
      data-testid="code-block-context-menu"
    >
      <div
        ref={hostRef}
        className="overflow-hidden rounded-lg border border-border bg-surface-muted/80"
        data-testid="code-block"
        data-folded={folded ? 'true' : undefined}
      >
        <div className="flex h-7 items-center justify-between gap-2 border-b border-border/80 px-2.5">
          <span
            className={cn(
              'min-w-0 truncate text-caption font-medium text-ink-tertiary',
              structureOn && language && 'rounded bg-surface-muted px-1.5 py-px',
            )}
          >
            {headerLabel}
          </span>
          <button
            type="button"
            onClick={onCopy}
            data-testid="code-copy"
            title={t('chat.copyCode')}
            aria-label={t('chat.copyCode')}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-ink-tertiary transition-colors duration-chrome hover:bg-state-hover hover:text-ink"
          >
            {copied ? <Check size={13} strokeWidth={1.75} /> : <Copy size={13} strokeWidth={1.75} />}
          </button>
        </div>
        <pre
          {...props}
          className={cn(
            'm-0 overflow-auto bg-transparent p-3 font-mono text-meta text-ink',
            props.className,
          )}
        >
          {highlightedHtml && !folded ? (
            <code
              className={language ? `language-${language}` : undefined}
              dangerouslySetInnerHTML={{ __html: highlightedHtml }}
            />
          ) : folded ? (
            <code className={language ? `language-${language}` : undefined}>{displayCode}</code>
          ) : highlightedHtml ? (
            <code
              className={language ? `language-${language}` : undefined}
              dangerouslySetInnerHTML={{ __html: highlightedHtml }}
            />
          ) : (
            children
          )}
        </pre>
        {allowFold && (
          <button
            type="button"
            data-testid="code-block-fold-toggle"
            className="w-full border-t border-border/80 px-2.5 py-1.5 text-left text-caption text-ink-tertiary transition-colors duration-chrome hover:bg-state-hover hover:text-ink-secondary"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded
              ? t('chat.codeBlock.collapse')
              : t('chat.codeBlock.expand', { count: lineCount - FOLD_PREVIEW_LINES })}
          </button>
        )}
      </div>
    </DeclarativeContextMenu>
  )
}
