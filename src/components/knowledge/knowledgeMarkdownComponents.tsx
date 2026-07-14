import type { Components } from 'react-markdown'
import type { ReactNode } from 'react'
import { open } from '@tauri-apps/plugin-shell'
import {
  createHeadingIdAssigner,
  scrollToKnowledgeHeading,
} from '@/domain/knowledge/mdPreview'

export interface KnowledgeMarkdownOptions {
  /** Called with 0-based GFM task index (document order). */
  onTaskToggle?: (taskIndex: number) => void
  /** Optional scope for in-doc #anchor scroll (DocReader root). */
  getScrollRoot?: () => ParentNode | null | undefined
}

/** Flatten react-markdown children to plain text for heading ids. */
export function textFromChildren(children: ReactNode): string {
  if (children == null || typeof children === 'boolean') return ''
  if (typeof children === 'string' || typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(textFromChildren).join('')
  if (typeof children === 'object' && children !== null && 'props' in children) {
    const el = children as { props?: { children?: ReactNode } }
    return textFromChildren(el.props?.children)
  }
  return ''
}

type HeadingTag = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'

/**
 * Knowledge-only MarkdownBody component overrides:
 * interactive GFM task checkboxes + heading ids + in-doc #anchors.
 *
 * **Call once per React render pass** (do not memoize across renders).
 * Counters live in this factory closure and must start at 0 for every
 * ReactMarkdown walk; reusing a prior return value makes indices/ids drift.
 *
 * Chat / other MarkdownBody callers stay on defaults.
 */
export function knowledgeMarkdownComponents(opts: KnowledgeMarkdownOptions = {}): Components {
  // Fresh for this render pass only — never share across re-renders.
  let taskIndex = 0
  const assignId = createHeadingIdAssigner()

  const heading =
    (Tag: HeadingTag): NonNullable<Components[HeadingTag]> =>
    ({ node: _node, children, ...props }) => {
      void _node
      const id = assignId(textFromChildren(children))
      return (
        <Tag id={id} {...props}>
          {children}
        </Tag>
      )
    }

  return {
    h1: heading('h1'),
    h2: heading('h2'),
    h3: heading('h3'),
    h4: heading('h4'),
    h5: heading('h5'),
    h6: heading('h6'),

    input: ({ node: _node, type, checked, disabled: _disabled, ...props }) => {
      void _node
      void _disabled
      if (type !== 'checkbox') {
        return <input type={type} checked={checked} {...props} />
      }
      const index = taskIndex++
      return (
        <input
          {...props}
          type="checkbox"
          checked={Boolean(checked)}
          data-testid="knowledge-task-checkbox"
          data-task-index={index}
          className="mr-1.5 cursor-pointer align-middle"
          onChange={() => opts.onTaskToggle?.(index)}
        />
      )
    },

    a: ({ node: _node, href, children, ...props }) => {
      void _node
      const handleClick = async (e: React.MouseEvent) => {
        e.preventDefault()
        if (!href) return
        if (href.startsWith('#')) {
          scrollToKnowledgeHeading(href, opts.getScrollRoot?.() ?? null)
          return
        }
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
          className="cursor-pointer underline hover:opacity-80"
        >
          {children}
        </a>
      )
    },
  }
}
