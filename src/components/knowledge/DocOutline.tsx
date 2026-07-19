import { useMemo } from 'react'
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
  className?: string
}

/**
 * Right-rail table of contents from ATX markdown headings.
 * Indentation reflects heading level; click jumps via parent handler.
 */
export function DocOutline({ content, onSelect, className }: DocOutlineProps) {
  const { t } = useTranslation()
  const items = useMemo(() => extractDocOutline(content), [content])

  if (items.length === 0) {
    return (
      <div
        className={cn(
          'flex h-full flex-col items-center justify-center gap-2 px-4 py-8 text-center',
          className,
        )}
        data-testid="knowledge-doc-outline-empty"
        role="status"
      >
        <ListTree size={18} className="text-ink-tertiary/70" aria-hidden />
        <p className="text-meta text-ink-tertiary">{t('knowledge.outline.empty')}</p>
      </div>
    )
  }

  // Flatten nesting for padding: level 1 → pl-2, level 2 → pl-4, …
  return (
    <nav
      className={cn('flex h-full min-h-0 flex-col', className)}
      data-testid="knowledge-doc-outline"
      aria-label={t('knowledge.outline.title')}
    >
      <div className="shrink-0 border-b border-border px-3 py-2">
        <p className="text-caption font-medium text-ink-tertiary">
          {t('knowledge.outline.count', { count: items.length })}
        </p>
      </div>
      <ol className="m-0 min-h-0 flex-1 list-none overflow-y-auto px-1.5 pb-3">
        {items.map((item) => {
          const label = item.text.trim() || t('knowledge.outline.untitled')
          // Cap indent so deep h5/h6 still fit; level 1 has minimal pad.
          const pad = Math.min(item.level - 1, 4)
          return (
            <li key={`${item.line}-${item.id}`} className="m-0 p-0">
              <button
                type="button"
                data-testid={`knowledge-doc-outline-item-${item.id}`}
                data-outline-level={item.level}
                data-outline-line={item.line}
                title={label}
                onClick={() => onSelect(item)}
                className={cn(
                  'mb-0.5 flex min-h-[28px] w-full items-center rounded-md py-1 pr-2 text-left transition-colors',
                  'hover:bg-state-hover',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
                  item.level === 1
                    ? 'text-meta font-medium text-ink'
                    : 'text-meta text-ink-secondary',
                )}
                style={{ paddingLeft: `${8 + pad * 10}px` }}
              >
                <span className="min-w-0 flex-1 truncate leading-snug">{label}</span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
