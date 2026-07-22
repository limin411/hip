import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import {
  KNOWLEDGE_SLASH_ITEMS,
  filterSlashItems,
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
      // M1: do not steal IME commit / composition keys (zh locales).
      if (e.isComposing || e.key === 'Process') return

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopImmediatePropagation()
        if (filtered.length === 0) return
        setActiveIndex((i) => {
          const cur = Math.min(i, filtered.length - 1)
          return Math.min(cur + 1, filtered.length - 1)
        })
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopImmediatePropagation()
        if (filtered.length === 0 || safeIndex <= 0) {
          onDismiss()
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

  return (
    <div
      role="listbox"
      aria-label={t('knowledge.slash.listLabel')}
      aria-activedescendant={activeOptionId}
      data-testid="knowledge-slash-menu"
      style={style}
      className={cn(
        'z-50 max-h-56 overflow-y-auto rounded-lg border border-border bg-surface shadow-overlay',
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
        filtered.map((item, i) => {
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
                'flex w-full items-center gap-2 px-3 py-2 text-left text-body text-ink transition-colors hover:bg-state-hover first:rounded-t-lg last:rounded-b-lg',
                i === safeIndex && 'bg-accent-subtle',
              )}
            >
              <span className="shrink-0 rounded bg-accent/10 px-1.5 py-0.5 text-caption font-mono text-accent">
                /{item.name}
              </span>
              <span className="flex-1 truncate text-ink-secondary">{label}</span>
            </button>
          )
        })
      )}
    </div>
  )
}
