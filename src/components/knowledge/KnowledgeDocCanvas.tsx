import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Full-page document body chrome (no elevated card).
 * Mode overflow is parent-owned via paperClassName — not part of this constant.
 */
export const DOC_PAGE_SHELL = 'w-full min-h-0 flex-1 flex flex-col bg-surface'

/** @deprecated Use DOC_PAGE_SHELL — kept as alias for any residual imports. */
export const DOC_PAPER_SHELL = DOC_PAGE_SHELL

/**
 * Document page column: fills the workspace main area (no rounded card).
 * Scroll ownership stays in KnowledgeWorkspace (Live/Source scroller).
 *
 * Mode overflow is applied by the parent via paperClassName — default classes omit
 * overflow so Workspace can pass mode-specific overflow without fighting the primitive.
 */
export function KnowledgeDocCanvas({
  children,
  className,
  paperClassName,
}: {
  children: ReactNode
  className?: string
  /** Classes on the page body (overflow, flex grow). */
  paperClassName?: string
}) {
  return (
    <div
      data-testid="knowledge-doc-canvas"
      className={cn(
        // Full-bleed in main: stretch width/height; modest horizontal pad for prose.
        'flex min-h-0 w-full flex-1 flex-col',
        className,
      )}
    >
      <div
        data-testid="knowledge-doc-paper"
        className={cn(
          DOC_PAGE_SHELL,
          // Side padding only — content uses the full stage, not a floating card.
          'px-8 sm:px-12 lg:px-16',
          paperClassName,
        )}
      >
        {children}
      </div>
    </div>
  )
}
