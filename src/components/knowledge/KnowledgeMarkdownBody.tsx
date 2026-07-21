import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { cn } from '@/lib/utils'
import { markdownProseClassName } from '@/components/chat/MarkdownBody'
import { CodeBlock } from '@/components/chat/CodeBlock'
import { KnowledgeMermaid } from './KnowledgeMermaid'
import { KnowledgeSvg } from './KnowledgeSvg'
import { firstTextLine, parseCalloutHeader } from '@/domain/knowledge/callout'

export interface KnowledgeMarkdownBodyProps {
  content: string
  className?: string
  components?: Components
}

const CALLOUT_STYLE: Record<string, string> = {
  note: 'border-accent/50 bg-accent/5',
  tip: 'border-success/50 bg-success/5',
  info: 'border-accent/50 bg-accent/5',
  warning: 'border-warning/50 bg-warning/5',
  caution: 'border-warning/50 bg-warning/5',
  danger: 'border-danger/50 bg-danger/5',
  important: 'border-accent/60 bg-accent/10',
}

/**
 * Knowledge-only markdown pipeline: GFM + math + mermaid/svg fences + callout blockquotes.
 * Chat continues to use plain MarkdownBody (no katex/mermaid cost).
 */
export function KnowledgeMarkdownBody({
  content,
  className,
  components,
}: KnowledgeMarkdownBodyProps) {
  const { t } = useTranslation()
  const merged = useMemo((): Components => {
    const base: Components = {
      pre: ({ children, ...props }) => {
        // Detect ```mermaid / ```svg via code child className
        const child = Array.isArray(children) ? children[0] : children
        if (
          child &&
          typeof child === 'object' &&
          'props' in child &&
          (child as { props?: { className?: string; children?: ReactNode } }).props
        ) {
          const cp = (child as { props: { className?: string; children?: ReactNode } }).props
          const cls = cp.className ?? ''
          if (/\blanguage-mermaid\b/.test(cls)) {
            const code = textOf(cp.children)
            return <KnowledgeMermaid code={code} />
          }
          if (/\blanguage-svg\b/.test(cls)) {
            const code = textOf(cp.children)
            return <KnowledgeSvg code={code} />
          }
        }
        // Knowledge Reader/embed: enable lazy CSP-safe Shiki (chat stays default off).
        return (
          <CodeBlock syntaxHighlight {...props}>
            {children}
          </CodeBlock>
        )
      },
      blockquote: ({ children, ...props }) => {
        const header = parseCalloutHeader(firstTextLine(children))
        if (!header) {
          return <blockquote {...props}>{children}</blockquote>
        }
        const style = CALLOUT_STYLE[header.type] ?? CALLOUT_STYLE.note
        // Drop the first paragraph if it was only the [!type] header line
        const rest = stripCalloutHeaderChild(children)
        const typeLabel = t(`knowledge.callout.${header.type}`, {
          defaultValue: header.type,
        })
        return (
          <aside
            className={cn(
              'my-2 rounded-md border-l-4 px-3 py-2',
              style,
            )}
            data-testid="knowledge-callout"
            data-callout={header.type}
            {...(props as object)}
          >
            <div className="mb-1 text-meta font-medium text-ink-secondary">
              {header.title ?? typeLabel}
            </div>
            <div className="text-body text-ink [&_p]:my-1">{rest}</div>
          </aside>
        )
      },
    }
    return { ...base, ...components }
  }, [components, t])

  return (
    <div className={cn(markdownProseClassName, className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={merged}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node === 'object' && node !== null && 'props' in node) {
    return textOf((node as { props?: { children?: ReactNode } }).props?.children)
  }
  return ''
}

/** Remove first child paragraph that is the callout marker line. */
function stripCalloutHeaderChild(children: ReactNode): ReactNode {
  const arr = Array.isArray(children) ? children : [children]
  if (arr.length === 0) return children
  const first = arr[0]
  const text = firstTextLine(first)
  if (parseCalloutHeader(text)) {
    return arr.slice(1)
  }
  return children
}
