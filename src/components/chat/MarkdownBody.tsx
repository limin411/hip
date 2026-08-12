import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Children, isValidElement, useMemo, type ReactNode } from 'react'
import { open } from '@tauri-apps/plugin-shell'
import { cn } from '@/lib/utils'
import { chunkStreamText } from '@/lib/streamChunks'
import { CodeBlock } from './CodeBlock'

/** Shared prose chrome for chat bubbles, file preview, skill docs. */
export const markdownProseClassName = [
  // min-w-0: flex column can shrink; long tables/URLs must not force full-bleed
  'min-w-0 max-w-full text-prose leading-relaxed text-ink',
  // Headings — semibold + tracking for a quieter editorial feel
  '[&_h1]:mb-3 [&_h1]:mt-1 [&_h1]:text-display [&_h1]:font-semibold [&_h1]:tracking-tight',
  '[&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-title [&_h2]:font-semibold [&_h2]:tracking-tight',
  '[&_h3]:mb-1.5 [&_h3]:mt-4 [&_h3]:text-body [&_h3]:font-semibold',
  '[&_h4]:mb-1 [&_h4]:mt-3 [&_h4]:text-meta [&_h4]:font-medium',
  '[&_h5]:mb-1 [&_h5]:mt-3 [&_h5]:text-meta [&_h5]:font-medium',
  '[&_h6]:mb-1 [&_h6]:mt-3 [&_h6]:text-meta [&_h6]:font-medium [&_h6]:text-ink-secondary',
  // Body — wrap long tokens so column max-width holds
  '[&_p]:my-1.5 [&_p]:break-words',
  '[&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5',
  '[&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5',
  '[&_li]:my-0.5 [&_li]:break-words',
  '[&_li>p]:my-0.5',
  // Fenced pre: NO [&_pre]:* — CodeBlock host owns my-2 + chrome (KD11)
  // Inline code — allow break inside cells / long tokens
  '[&_:not(pre)>code]:rounded-md [&_:not(pre)>code]:bg-surface-muted [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-px',
  '[&_:not(pre)>code]:break-all',
  '[&_code]:font-mono [&_code]:text-meta',
  // Quote / rule
  '[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border-strong [&_blockquote]:pl-3 [&_blockquote]:text-ink-secondary',
  '[&_hr]:my-4 [&_hr]:border-0 [&_hr]:border-t [&_hr]:border-border',
  // Tables: fixed layout + wrap cells so long content cannot blow past column width.
  // Wrapper (see `table` component) adds overflow-x-auto as a many-column fallback.
  '[&_table]:my-0 [&_table]:w-full [&_table]:table-fixed [&_table]:border-collapse',
  '[&_th]:border [&_th]:border-border [&_th]:bg-surface-muted [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left [&_th]:text-meta [&_th]:font-semibold',
  '[&_th]:align-top [&_th]:break-words [&_th]:whitespace-normal',
  '[&_td]:border [&_td]:border-border [&_td]:px-2.5 [&_td]:py-1.5 [&_td]:text-meta',
  '[&_td]:align-top [&_td]:break-words [&_td]:whitespace-normal',
  '[&_img]:max-w-full [&_img]:h-auto',
  // GFM task lists (remark-gfm): checkbox baseline
  '[&_input[type=checkbox]]:mr-2 [&_input[type=checkbox]]:align-middle',
].join(' ')

const DEFAULT_REMARK_PLUGINS = [remarkGfm]

const DEFAULT_COMPONENTS: Components = {
  pre: CodeBlock,
  /** Scroll shell so multi-column tables stay inside the chat column. */
  table: ({ children, ...props }) => (
    <div className="my-2 min-w-0 max-w-full overflow-x-auto" data-testid="md-table-scroll">
      <table {...props}>{children}</table>
    </div>
  ),
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
      <a
        href={href}
        onClick={handleClick}
        {...props}
        className="cursor-pointer break-all underline hover:opacity-80"
      >
        {children}
      </a>
    )
  },
}

/**
 * Streaming paragraph (ui-enhancement-bui P0-1): raw text runs split into
 * `.stream-chunk` spans that fade in on mount. Append-only growth keeps
 * earlier spans stable (React reuses them by key), so only new chunks animate.
 * Element children (code / strong / a …) are wrapped as one chunk unit each.
 */
function StreamingParagraph({ children }: { children?: ReactNode }) {
  const nodes: ReactNode[] = []
  Children.forEach(children, (child, idx) => {
    if (typeof child === 'string' || typeof child === 'number') {
      chunkStreamText(String(child)).forEach((c, j) => {
        nodes.push(
          <span key={`${idx}-${j}`} className="stream-chunk">
            {c}
          </span>,
        )
      })
    } else if (isValidElement(child)) {
      nodes.push(
        <span key={`el-${idx}`} className="stream-chunk">
          {child}
        </span>,
      )
    }
  })
  return <p>{nodes}</p>
}

export interface MarkdownBodyProps {
  content: string
  className?: string
  components?: Components
  /** When false, skip remark-gfm (e.g. plain preview). Default true. */
  gfm?: boolean
  /** Streaming: reveal raw text runs in opacity-fade chunks (P0-1). Default false. */
  streaming?: boolean
}

export function MarkdownBody({
  content,
  className,
  components,
  gfm = true,
  streaming = false,
}: MarkdownBodyProps) {
  const mergedComponents = useMemo(() => {
    const base: Components = { ...DEFAULT_COMPONENTS, ...components }
    if (streaming) base.p = StreamingParagraph
    return base
  }, [components, streaming])

  return (
    <div className={cn(markdownProseClassName, className)}>
      <ReactMarkdown
        remarkPlugins={gfm ? DEFAULT_REMARK_PLUGINS : undefined}
        components={mergedComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
