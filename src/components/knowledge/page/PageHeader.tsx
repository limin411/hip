import { InlineDocTitle } from '../InlineDocTitle'
import { cn } from '@/lib/utils'

export interface PageHeaderProps {
  docId: string
  title: string
  onTitleCommit: (title: string) => void
  onTitleEnter?: () => void
  className?: string
}

export function PageHeader({
  docId,
  title,
  onTitleCommit,
  onTitleEnter,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn('shrink-0', className)}
      data-testid="knowledge-page-header"
    >
      <div className="knowledge-doc-inline-pad">
        <div className="knowledge-doc-measure pt-3 sm:pt-4">
          <InlineDocTitle
            docId={docId}
            title={title}
            onCommit={onTitleCommit}
            onEnterCommit={onTitleEnter}
            className="!pt-0"
          />
        </div>
      </div>
    </header>
  )
}
