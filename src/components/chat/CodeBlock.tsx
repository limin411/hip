import { useState, type ComponentPropsWithoutRef, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Check } from 'lucide-react'
import { DeclarativeContextMenu } from '@/components/context-menu'
import { copyText } from '@/ipc/clipboard'
import { cn } from '@/lib/utils'

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

/**
 * Replacement for the markdown `pre` element: owns fenced-code chrome and
 * external vertical spacing (KD11). `node` (react-markdown's hast node) is
 * destructured out so it is never spread onto the DOM.
 */
export function CodeBlock({ children, node, ...props }: ComponentPropsWithoutRef<'pre'> & { node?: unknown }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const code = codeTextOf(children)
  const language = languageOf(children)

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
        className="overflow-hidden rounded-md border border-border bg-surface-muted"
        data-testid="code-block"
      >
        <div className="flex h-7 items-center justify-between gap-2 border-b border-border px-2.5">
          <span className="min-w-0 truncate text-caption uppercase tracking-wide text-ink-tertiary">
            {language ?? ''}
          </span>
          <button
            type="button"
            onClick={onCopy}
            data-testid="code-copy"
            title={t('chat.copyCode')}
            aria-label={t('chat.copyCode')}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:text-ink-secondary"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
        </div>
        <pre
          {...props}
          className={cn(
            'm-0 overflow-auto bg-transparent p-3 font-mono text-meta text-ink',
            props.className,
          )}
        >
          {children}
        </pre>
      </div>
    </DeclarativeContextMenu>
  )
}
