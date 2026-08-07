import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ListTree } from 'lucide-react'
import {
  extractDocOutline,
  type DocOutlineItem,
} from '@/domain/knowledge/mdPreview'
import { cn } from '@/lib/utils'

export interface DocOutlineProps {
  /** Markdown body used to derive headings (prefer draft while editing). */
  content: string
  /** Jump to a heading — parent decides Source / Live / Preview strategy. */
  onSelect: (item: DocOutlineItem) => void
  /** Active heading id (scrollspy). */
  activeId?: string | null
  className?: string
}

/**
 * Right-rail table of contents from ATX markdown headings.
 * Indentation reflects heading level; click jumps via parent handler.
 * Section chrome lives in KnowledgeOutlinePanel (no nested header bar).
 */
export function DocOutline({
  content,
  onSelect,
  activeId = null,
  className,
}: DocOutlineProps) {
  const { t } = useTranslation()
  const items = useMemo(() => extractDocOutline(content), [content])
  const activeRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!activeId) return
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeId])

  if (items.length === 0) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center gap-2 px-2 py-6 text-center',
          className,
        )}
        data-testid="knowledge-doc-outline-empty"
        role="status"
      >
        <ListTree size={18} className="text-ink-tertiary" aria-hidden />
        <p className="text-meta text-ink-tertiary">{t('knowledge.outline.empty')}</p>
      </div>
    )
  }

  return (
    <nav
      className={cn('flex min-h-0 flex-col', className)}
      data-testid="knowledge-doc-outline"
      aria-label={t('knowledge.outline.title')}
    >
      <ol className="m-0 min-h-0 flex-1 list-none overflow-y-auto px-0.5 pb-1">
        {items.map((item) => {
          const label = item.text.trim() || t('knowledge.outline.untitled')
          const pad = Math.min(item.level - 1, 4)
          const isActive = activeId != null && item.id === activeId
          return (
            <li key={`${item.line}-${item.id}`} className="m-0 p-0">
              <button
                type="button"
                data-testid={`knowledge-doc-outline-item-${item.id}`}
                data-outline-level={item.level}
                data-outline-line={item.line}
                data-outline-active={isActive ? 'true' : undefined}
                aria-current={isActive ? 'location' : undefined}
                title={label}
                ref={isActive ? activeRef : undefined}
                onClick={() => onSelect(item)}
                className={cn(
                  'mb-0.5 flex min-h-[28px] w-full items-center rounded-md py-1 pr-2 text-left transition-colors',
                  'hover:bg-state-hover',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
                  isActive
                    ? 'bg-accent/10 font-medium text-ink'
                    : item.level === 1
                      ? 'text-meta font-medium text-ink'
                      : 'text-meta text-ink-secondary',
                )}
                style={{ paddingLeft: `${8 + pad * 10}px` }}
              >
                {isActive ? (
                  <span
                    className="mr-1.5 h-3 w-0.5 shrink-0 rounded-full bg-accent"
                    aria-hidden
                  />
                ) : null}
                <span className="min-w-0 flex-1 truncate leading-snug">{label}</span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
