import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Document column layout only: max width + horizontal padding.
 * Scroll ownership stays in KnowledgeWorkspace (edit: CM scroller; preview: outer stage).
 */
export function KnowledgeDocCanvas({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'mx-auto flex min-h-0 w-full max-w-3xl flex-col px-10 sm:px-12',
        className,
      )}
    >
      {children}
    </div>
  )
}
