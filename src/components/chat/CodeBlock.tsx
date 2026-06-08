import { useState, type ComponentPropsWithoutRef, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Check } from 'lucide-react'
import { copyText } from '@/ipc/clipboard'

/** Extract the raw code text from react-markdown's <pre> children (a <code> element). */
function codeTextOf(children: unknown): string {
  const el = children as ReactElement<{ children?: unknown }> | undefined
  const inner = el?.props?.children
  return (typeof inner === 'string' ? inner : '').replace(/\n$/, '')
}

/**
 * Replacement for the markdown `pre` element: keeps the styled <pre> and adds a
 * hover copy button. `node` (react-markdown's hast node) is destructured out so it
 * is never spread onto the DOM; the loose props type stays assignable to the
 * `components.pre` slot.
 */
export function CodeBlock({ children, node, ...props }: ComponentPropsWithoutRef<'pre'> & { node?: unknown }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const code = codeTextOf(children)

  const onCopy = async () => {
    if (code && (await copyText(code))) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <div className="group/code relative">
      <pre {...props}>{children}</pre>
      <button
        onClick={onCopy}
        data-testid="code-copy"
        title={t('chat.copyCode')}
        aria-label={t('chat.copyCode')}
        className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-md bg-surface/80 text-ink-tertiary opacity-0 transition-opacity hover:text-ink-secondary group-hover/code:opacity-100 focus-visible:opacity-100"
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </div>
  )
}
