import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Elevated paper shell chrome (KD1). Exported for visual class guardrail tests.
 * Mode overflow is parent-owned via paperClassName — not part of this constant.
 */
export const DOC_PAPER_SHELL =
  'rounded-xl border border-border bg-surface shadow-panel'

/**
 * Document paper column: elevated reading surface.
 * Scroll ownership stays in KnowledgeWorkspace (edit: CM/Live scroller; preview: outer stage).
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
  /** Classes on the elevated paper shell (overflow, flex grow). */
  paperClassName?: string
}) {
  return (
    <div
      data-testid="knowledge-doc-canvas"
      className={cn(
        // Outer: center paper. Prefer horizontal gutter; keep vertical pad modest
        // so short windows still give CM a usable height budget.
        'mx-auto flex min-h-0 w-full max-w-3xl flex-col px-4 sm:px-6 py-3 sm:py-4',
        className,
      )}
    >
      <div
        data-testid="knowledge-doc-paper"
        className={cn(
          'flex min-h-0 flex-1 flex-col',
          DOC_PAPER_SHELL,
          'px-8 sm:px-10',
          paperClassName,
        )}
      >
        {children}
      </div>
    </div>
  )
}
