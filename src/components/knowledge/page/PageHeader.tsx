import { InlineDocTitle } from '../InlineDocTitle'
import { PageIconButton } from './PageIconButton'
import { PageProperties } from './PageProperties'
import { PageCover } from './PageCover'
import type { KnowledgeDocMeta } from '@/domain/knowledge/frontmatter'
import { cn } from '@/lib/utils'

export interface PageHeaderProps {
  docId: string
  title: string
  meta: KnowledgeDocMeta
  spaceId: string | null
  onTitleCommit: (title: string) => void
  onTitleEnter?: () => void
  onMetaChange: (patch: Partial<KnowledgeDocMeta>) => void
  showCover?: boolean
  showProperties?: boolean
  className?: string
}

export function PageHeader({
  docId,
  title,
  meta,
  spaceId,
  onTitleCommit,
  onTitleEnter,
  onMetaChange,
  showCover = true,
  showProperties = true,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn('shrink-0', className)}
      data-testid="knowledge-page-header"
    >
      {showCover ? (
        <PageCover
          spaceId={spaceId}
          cover={meta.cover}
          coverY={meta.coverY}
          onChange={({ cover, coverY }) =>
            onMetaChange({
              cover,
              coverY: coverY === undefined ? meta.coverY : coverY,
            })
          }
        />
      ) : null}
      <div className="knowledge-doc-measure flex items-start gap-2 pt-2 sm:pt-4">
        <PageIconButton
          icon={meta.icon}
          onChange={(icon) => onMetaChange({ icon })}
          className="mt-8 sm:mt-10"
        />
        <div className="min-w-0 flex-1">
          <InlineDocTitle
            docId={docId}
            title={title}
            onCommit={onTitleCommit}
            onEnterCommit={onTitleEnter}
            className="!pt-8 sm:!pt-10"
          />
        </div>
      </div>
      {showProperties ? (
        <PageProperties meta={meta} onChange={onMetaChange} />
      ) : null}
    </header>
  )
}
