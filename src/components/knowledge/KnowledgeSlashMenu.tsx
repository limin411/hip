import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import {
  KNOWLEDGE_SLASH_ITEMS,
  filterSlashItems,
  groupSlashItems,
  slashGroupLabelKey,
  slashItemLabelKey,
  type KnowledgeSlashItem,
} from '@/domain/knowledge/slashMenu'

export interface KnowledgeSlashMenuProps {
  /** Query text after `/` (empty string shows full catalog). */
  query: string
  onSelect: (item: KnowledgeSlashItem) => void
  onDismiss: () => void
  /**
   * Optional catalog override (e.g. Live mid-line without block items).
   * Defaults to the shared `KNOWLEDGE_SLASH_ITEMS`.
   */
  items?: KnowledgeSlashItem[]
  /** Optional class for positioning (caller places absolute/fixed). */
  className?: string
  /** Optional inline style (caret-relative top/left from host). */
  style?: React.CSSProperties
}

/**
 * Slash insert palette for knowledge Live/Source editors.
 * Keyboard: ↑↓, Enter select, Escape dismiss (capture phase).
 * IME: ignores composition keydowns (`isComposing` / `Process`).
 * R5: group headers + icons + zh keywords via filterSlashItems.
 */
export function KnowledgeSlashMenu({
  query,
  onSelect,
  onDismiss,
  items,
  className,
  style,
}: KnowledgeSlashMenuProps) {
  const { t } = useTranslation()
  const catalog = items ?? KNOWLEDGE_SLASH_ITEMS
  const filtered = useMemo(
    () => filterSlashItems(catalog, query),
    [catalog, query],
  )
  const groups = useMemo(() => groupSlashItems(filtered), [filtered])
  const [activeIndex, setActiveIndex] = useState(0)
  const activeRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  useEffect(() => {
    setActiveIndex((i) =>
      filtered.length === 0 ? 0 : Math.min(i, filtered.length - 1),
    )
  }, [filtered])

  const safeIndex =
    filtered.length === 0 ? 0 : Math.min(activeIndex, filtered.length - 1)
  const activeOptionId =
    filtered[safeIndex] != null
      ? `knowledge-slash-opt-${filtered[safeIndex].id}`
      : undefined

  useEffect(() => {
    if (filtered.length === 0) return
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [safeIndex, filtered])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.isComposing || e.key === 'Process') return

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopImmediatePropagation()
        if (filtered.length === 0) return
        setActiveIndex((i) => {
          const cur = Math.min(i, filtered.length - 1)
          // Wrap from the bottom back to the first item.
          return cur + 1 >= filtered.length ? 0 : cur + 1
        })
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopImmediatePropagation()
        if (filtered.length === 0) {
          onDismiss()
        } else if (safeIndex <= 0) {
          // Wrap from the top back to the last item instead of dismissing.
          setActiveIndex(filtered.length - 1)
        } else {
          setActiveIndex(safeIndex - 1)
        }
        return
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        e.stopImmediatePropagation()
        if (filtered[safeIndex]) onSelect(filtered[safeIndex])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        onDismiss()
        return
      }
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [safeIndex, filtered, onSelect, onDismiss])

  let flatIndex = 0

  return (
    <div
      role="listbox"
      aria-label={t('knowledge.slash.listLabel')}
      aria-activedescendant={activeOptionId}
      data-testid="knowledge-slash-menu"
      style={style}
      className={cn(
        'z-50 max-h-72 animate-menu-in overflow-y-auto rounded-xl border border-border bg-surface shadow-overlay',
        className,
      )}
    >
      {filtered.length === 0 ? (
        <div
          data-testid="knowledge-slash-menu-empty"
          className="px-3 py-4 text-center text-meta text-ink-secondary"
          role="presentation"
        >
          {t('knowledge.slash.noMatch')}
        </div>
      ) : (
        groups.map(({ group, items: groupItems }) => (
          <div key={group} role="group" data-testid={`knowledge-slash-group-${group}`}>
            <div className="px-3 pb-1 pt-2 text-caption font-semibold uppercase tracking-wide text-ink-tertiary">
              {t(slashGroupLabelKey(group), { defaultValue: group })}
            </div>
            {groupItems.map((item) => {
              const i = flatIndex++
              const label = t(slashItemLabelKey(item.id), {
                defaultValue: item.label,
              })
              return (
                <button
                  key={item.id}
                  type="button"
                  id={`knowledge-slash-opt-${item.id}`}
                  data-testid={`knowledge-slash-${item.name}`}
                  role="option"
                  aria-selected={i === safeIndex}
                  ref={i === safeIndex ? activeRef : undefined}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onSelect(item)}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-2 text-left text-body text-ink transition-colors hover:bg-state-hover',
                    i === safeIndex && 'bg-accent-subtle',
                  )}
                >
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-muted text-caption font-medium text-ink-secondary"
                    aria-hidden
                  >
                    {item.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">{label}</span>
                    <span className="block truncate text-caption text-ink-tertiary">
                      /{item.name}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        ))
      )}
    </div>
  )
}
