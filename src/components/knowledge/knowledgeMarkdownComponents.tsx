import type { Components } from 'react-markdown'
import type { ReactNode } from 'react'
import { open } from '@tauri-apps/plugin-shell'
import { scrollToKnowledgeHeading, slugifyHeading } from '@/domain/knowledge/mdPreview'
import { KnowledgeAssetImage } from './KnowledgeAssetImage'

export interface KnowledgeMarkdownOptions {
  /** Called with 0-based GFM task index (document order). */
  onTaskToggle?: (taskIndex: number) => void
  /** Optional scope for in-doc #anchor scroll (DocReader root). */
  getScrollRoot?: () => ParentNode | null | undefined
  /**
   * Precomputed ATX heading ids by 1-based source line (from `headingIdsBySourceLine`).
   * Looked up via hast/mdast `node.position.start.line` — no render-time counters.
   */
  headingIdsByLine?: ReadonlyMap<number, string>
  /** Active space — required for local `assets/…` image preview via data URLs. */
  spaceId?: string | null
}

/** Flatten react-markdown children to plain text (fallback heading id only). */
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

function sourceLine(node: unknown): number | undefined {
  if (!node || typeof node !== 'object' || !('position' in node)) return undefined
  const line = (node as { position?: { start?: { line?: number } } }).position?.start?.line
  return typeof line === 'number' ? line : undefined
}

/**
 * Resolve checkbox index from live DOM order inside the reader root.
 * Safe under StrictMode (no render-time `taskIndex++`).
 */
export function taskIndexFromDom(
  el: Element,
  root?: ParentNode | null,
): number {
  const scope: ParentNode = root ?? el.ownerDocument ?? document
  const boxes = scope.querySelectorAll(
    'input[type="checkbox"][data-testid="knowledge-task-checkbox"]',
  )
  return Array.prototype.indexOf.call(boxes, el)
}

type HeadingTag = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'

/**
 * Knowledge-only MarkdownBody component overrides:
 * interactive GFM task checkboxes + heading ids + in-doc #anchors.
 *
 * Indices/ids are **not** assigned via mutable render counters (StrictMode-safe):
 * - Tasks: DOM order at click time via `taskIndexFromDom`
 * - Headings: pure precompute `headingIdsByLine` + `node.position.start.line`
 *
 * Chat / other MarkdownBody callers stay on defaults.
 */
export function knowledgeMarkdownComponents(opts: KnowledgeMarkdownOptions = {}): Components {
  const heading =
    (Tag: HeadingTag): NonNullable<Components[HeadingTag]> =>
    ({ node, children, ...props }) => {
      const line = sourceLine(node)
      const id =
        (line != null ? opts.headingIdsByLine?.get(line) : undefined) ??
        slugifyHeading(textFromChildren(children))
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
      return (
        <input
          {...props}
          type="checkbox"
          checked={Boolean(checked)}
          data-testid="knowledge-task-checkbox"
          className="mr-1.5 cursor-pointer align-middle"
          onChange={(e) => {
            const index = taskIndexFromDom(e.currentTarget, opts.getScrollRoot?.() ?? null)
            if (index >= 0) opts.onTaskToggle?.(index)
          }}
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

    img: ({ node: _node, src, alt, ...props }) => {
      void _node
      const spaceId = opts.spaceId
      if (spaceId) {
        return (
          <KnowledgeAssetImage
            spaceId={spaceId}
            src={typeof src === 'string' ? src : undefined}
            alt={typeof alt === 'string' ? alt : ''}
            className="my-2 max-h-[480px] max-w-full rounded-md border border-border"
          />
        )
      }
      if (!src || typeof src !== 'string') return null
      // No spaceId: still mark as lightbox-host so a parent canvas does not double-fire.
      // Plain img is clickable via nearest KnowledgeDocCanvas capture listener.
      return (
        <img
          src={src}
          alt={typeof alt === 'string' ? alt : ''}
          {...props}
          className="my-2 max-h-[480px] max-w-full cursor-zoom-in rounded-md border border-border"
        />
      )
    },
  }
}
