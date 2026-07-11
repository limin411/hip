import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { open } from '@tauri-apps/plugin-shell'
import { cn } from '@/lib/utils'
import { CodeBlock } from './CodeBlock'

/** Shared prose chrome for chat bubbles, file preview, skill docs. */
export const markdownProseClassName = [
  'max-w-none text-prose leading-relaxed text-ink',
  '[&_h1]:mb-3 [&_h1]:mt-1 [&_h1]:text-display [&_h1]:font-bold [&_h1]:tracking-tight',
  '[&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-title [&_h2]:font-bold [&_h2]:tracking-tight',
  '[&_p]:my-1.5',
  '[&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5',
  '[&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5',
  '[&_pre]:my-2 [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:bg-surface-muted [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-meta',
  '[&_code]:font-mono [&_code]:text-meta',
  '[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-ink-secondary',
  '[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse',
  '[&_th]:border [&_th]:border-border [&_th]:bg-surface-muted [&_th]:px-2 [&_th]:py-1 [&_th]:text-left',
  '[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1',
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
