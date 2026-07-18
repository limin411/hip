import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { open } from '@tauri-apps/plugin-shell'
import { cn } from '@/lib/utils'
import { CodeBlock } from './CodeBlock'

/** Shared prose chrome for chat bubbles, file preview, skill docs. */
export const markdownProseClassName = [
  'max-w-none text-prose leading-relaxed text-ink',
  // Headings
  '[&_h1]:mb-3 [&_h1]:mt-1 [&_h1]:text-display [&_h1]:font-bold [&_h1]:tracking-tight',
  '[&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-title [&_h2]:font-bold [&_h2]:tracking-tight',
  '[&_h3]:mb-1.5 [&_h3]:mt-4 [&_h3]:text-body [&_h3]:font-semibold',
  '[&_h4]:mb-1 [&_h4]:mt-3 [&_h4]:text-meta [&_h4]:font-semibold',
  '[&_h5]:mb-1 [&_h5]:mt-3 [&_h5]:text-meta [&_h5]:font-semibold',
  '[&_h6]:mb-1 [&_h6]:mt-3 [&_h6]:text-meta [&_h6]:font-semibold [&_h6]:text-ink-secondary',
  // Body
  '[&_p]:my-1.5',
  '[&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5',
  '[&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5',
  '[&_li]:my-0.5',
  '[&_li>p]:my-0.5',
  // Fenced pre: NO [&_pre]:* — CodeBlock host owns my-2 + chrome (KD11)
  // Inline code
  '[&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-surface-muted [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-px',
  '[&_code]:font-mono [&_code]:text-meta',
  // Quote / rule
  '[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-ink-secondary',
  '[&_hr]:my-4 [&_hr]:border-0 [&_hr]:border-t [&_hr]:border-border',
  // Tables (no sticky thead, no zebra — deferred)
  '[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse',
  '[&_th]:border [&_th]:border-border [&_th]:bg-surface-muted [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left [&_th]:text-meta [&_th]:font-semibold',
  '[&_td]:border [&_td]:border-border [&_td]:px-2.5 [&_td]:py-1.5 [&_td]:text-meta',
  // GFM task lists (remark-gfm): checkbox baseline
  '[&_input[type=checkbox]]:mr-2 [&_input[type=checkbox]]:align-middle',
].join(' ')

const DEFAULT_REMARK_PLUGINS = [remarkGfm]

const DEFAULT_COMPONENTS: Components = {
  pre: CodeBlock,
  a: ({ href, children, ...props }) => {
    const handleClick = async (e: React.MouseEvent) => {
      e.preventDefault()
      if (!href) return
      try {
        await open(href)
      } catch {
        window.open(href, '_blank', 'noopener,noreferrer')
      }
    }
    return (
      <a href={href} onClick={handleClick} {...props} className="cursor-pointer underline hover:opacity-80">
        {children}
      </a>
    )
  },
}

export interface MarkdownBodyProps {
  content: string
  className?: string
  components?: Components
  /** When false, skip remark-gfm (e.g. plain preview). Default true. */
  gfm?: boolean
}

export function MarkdownBody({ content, className, components, gfm = true }: MarkdownBodyProps) {
  return (
    <div className={cn(markdownProseClassName, className)}>
      <ReactMarkdown
        remarkPlugins={gfm ? DEFAULT_REMARK_PLUGINS : undefined}
        components={{ ...DEFAULT_COMPONENTS, ...components }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
