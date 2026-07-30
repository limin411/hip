import { useTranslation } from 'react-i18next'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import { cn } from '@/lib/utils'
import type { BoardOutlineItem } from '@/domain/knowledge/boardOutline'

/**
 * Whiteboard structure list (LKD-21/32). Click → requestBoardFocus (select + scroll).
 */
export function BoardStructureList({
  items,
  selectedIds,
  truncated,
  totalElements,
}: {
  items: BoardOutlineItem[]
  selectedIds: ReadonlySet<string>
  truncated: boolean
  totalElements: number
}) {
  const { t } = useTranslation()
  const requestBoardFocus = useKnowledgeStore((s) => s.requestBoardFocus)

  if (items.length === 0) {
    return (
      <p
        className="px-1 text-meta text-ink-tertiary"
        data-testid="knowledge-board-structure-empty"
      >
        {t('knowledge.board.structureEmpty')}
      </p>
    )
  }

  return (
    <div data-testid="knowledge-board-structure-list">
      <ul className="flex flex-col gap-0.5" role="list">
        {items.map((item) => {
          const selected = selectedIds.has(item.id)
          return (
            <li key={item.id}>
              <button
                type="button"
                className={cn(
                  'w-full rounded-md px-2 py-1.5 text-left text-meta',
                  'text-ink hover:bg-surface-hover',
                  selected && 'bg-surface-hover font-medium',
                )}
                data-testid={`knowledge-board-structure-item-${item.id}`}
                aria-current={selected ? 'true' : undefined}
                onClick={() => requestBoardFocus([item.id], { scroll: true })}
              >
                <span className="block truncate">{item.label}</span>
                <span className="mt-0.5 block text-caption text-ink-tertiary">
                  {t(`knowledge.board.elementType.${item.type}`, {
                    defaultValue: item.type,
                  })}
                  {item.locked ? ` · ${t('knowledge.board.locked')}` : null}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {truncated ? (
        <p
          className="mt-1 px-1 text-caption text-ink-tertiary"
          data-testid="knowledge-board-structure-truncated"
        >
          {t('knowledge.board.structureTruncated', {
            shown: items.length,
            total: totalElements,
          })}
        </p>
      ) : null}
    </div>
  )
}
