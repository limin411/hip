import {
  useEffect,
  useState,
  type ComponentPropsWithoutRef,
  type ReactElement,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Check } from 'lucide-react'
import { DeclarativeContextMenu } from '@/components/context-menu'
import { copyText } from '@/ipc/clipboard'
import { cn } from '@/lib/utils'
import { highlightCode } from '@/lib/shikiLazy'
import { normalizeHighlightLang } from '@/domain/knowledge/codeHighlight'

/** Extract the raw code text from react-markdown's <pre> children (a <code> element). */
function codeTextOf(children: unknown): string {
  const el = children as ReactElement<{ children?: unknown }> | undefined
  const inner = el?.props?.children
  return (typeof inner === 'string' ? inner : '').replace(/\n$/, '')
}

/** Optional language class from the inner <code class="language-…">. */
function languageOf(children: unknown): string | undefined {
  const el = children as ReactElement<{ className?: string }> | undefined
  const cls = el?.props?.className ?? ''
  const m = /language-([\w+-]+)/.exec(cls)
  return m?.[1]
}

function useIsDark(): boolean {
  const [dark, setDark] = useState(() =>
    typeof document !== 'undefined'
      ? document.documentElement.classList.contains('dark')
      : false,
  )

  useEffect(() => {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    const sync = () => setDark(root.classList.contains('dark'))
    sync()
    const obs = new MutationObserver(sync)
    obs.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])

  return dark
}

export type CodeBlockProps = ComponentPropsWithoutRef<'pre'> & {
  node?: unknown
  /**
   * Lazy Shiki highlight (knowledge Reader / embed). Default false so chat
   * pays zero cost and never imports the highlighter.
   */
  syntaxHighlight?: boolean
}

/**
 * Replacement for the markdown `pre` element: owns fenced-code chrome and
 * external vertical spacing (KD11). `node` (react-markdown's hast node) is
 * destructured out so it is never spread onto the DOM.
 */
export function CodeBlock({
  children,
  node,
  syntaxHighlight = false,
  ...props
}: CodeBlockProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const code = codeTextOf(children)
  const language = languageOf(children)
  const isDark = useIsDark()
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null)

  useEffect(() => {
    if (!syntaxHighlight) {
      setHighlightedHtml(null)
      return
    }
    const canonical = normalizeHighlightLang(language)
    if (!canonical || !code) {
      setHighlightedHtml(null)
      return
    }
    let cancelled = false
    void highlightCode(code, canonical, isDark).then((html) => {
      if (!cancelled) setHighlightedHtml(html)
    })
    return () => {
      cancelled = true
    }
  }, [syntaxHighlight, code, language, isDark])

  const onCopy = async () => {
    if (code && (await copyText(code))) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <DeclarativeContextMenu
      kind="codeBlock"
      payload={{ code, language }}
      className="my-2"
      data-testid="code-block-context-menu"
    >
      <div
        className="overflow-hidden rounded-lg border border-border bg-surface-muted/80"
        data-testid="code-block"
      >
        <div className="flex h-7 items-center justify-between gap-2 border-b border-border/80 px-2.5">
          <span className="min-w-0 truncate text-caption font-medium text-ink-tertiary">
            {language ?? ''}
          </span>
          <button
            type="button"
            onClick={onCopy}
            data-testid="code-copy"
            title={t('chat.copyCode')}
            aria-label={t('chat.copyCode')}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-tertiary transition-colors duration-chrome hover:bg-state-hover hover:text-ink"
          >
            {copied ? <Check size={13} strokeWidth={1.75} /> : <Copy size={13} strokeWidth={1.75} />}
          </button>
        </div>
        {/* Single-layer chrome: our pre/code only — never nest a shiki <pre>. */}
        <pre
          {...props}
          className={cn(
            'm-0 overflow-auto bg-transparent p-3 font-mono text-meta text-ink',
            props.className,
          )}
        >
          {highlightedHtml ? (
            <code
              className={language ? `language-${language}` : undefined}
              // Token spans from structure:'inline' — plain fence text only in.
              dangerouslySetInnerHTML={{ __html: highlightedHtml }}
            />
          ) : (
            children
          )}
        </pre>
      </div>
    </DeclarativeContextMenu>
  )
}
