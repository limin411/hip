import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { KnowledgeNode } from '@/domain/knowledge/types'
import {
  listDocsInTreeOrder,
  rankWikiCandidates,
} from '@/domain/knowledge/wikiLink'
import { cn } from '@/lib/utils'

export interface WikiLinkPickerProps {
  /** Open wiki query after `[[` (may be empty for browse). */
  query: string
  nodes: KnowledgeNode[]
  /** Anchor position in viewport (fixed coords). */
  anchor: { top: number; left: number }
  onPick: (title: string) => void
  onClose: () => void
}

/**
 * Lightweight floating list for Live-mode wiki fuzzy pick.
 * Source mode uses CodeMirror autocompletion instead.
 */
export function WikiLinkPicker({
  query,
  nodes,
  anchor,
  onPick,
  onClose,
}: WikiLinkPickerProps) {
  const { t } = useTranslation()
  const listRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)

  const candidates = useMemo(() => {
    const docs = listDocsInTreeOrder(nodes)
    return rankWikiCandidates(query, docs, 12)
  }, [nodes, query])

  useEffect(() => {
    setActive(0)
  }, [query, candidates.length])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
        return
      }
      if (candidates.length === 0) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopPropagation()
        setActive((i) => Math.min(i + 1, candidates.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        setActive((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault()
        e.stopPropagation()
        const pick = candidates[active]
        if (pick) onPick(pick.node.title)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [active, candidates, onClose, onPick])

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-wiki-pick-index="${active}"]`,
    )
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  return (
    <div
      role="listbox"
      data-testid="knowledge-wiki-picker"
      ref={listRef}
      className="fixed z-[60] max-h-56 w-64 overflow-y-auto rounded-md border border-border bg-surface py-1 shadow-overlay"
      style={{ top: anchor.top, left: anchor.left }}
    >
      {candidates.length === 0 ? (
        <div className="px-2.5 py-2 text-meta text-ink-tertiary">
          {t('knowledge.wiki.noMatches')}
        </div>
      ) : (
        candidates.map((c, i) => (
          <button
            key={c.node.id}
            type="button"
            role="option"
            aria-selected={i === active}
            data-wiki-pick-index={i}
            data-testid="knowledge-wiki-pick-item"
            className={cn(
              'flex w-full items-center px-2.5 py-1.5 text-left text-body text-ink',
              i === active ? 'bg-state-hover' : 'hover:bg-state-hover/70',
            )}
            onMouseDown={(e) => {
              // Prevent editor blur before pick applies.
              e.preventDefault()
            }}
            onClick={() => onPick(c.node.title)}
            onMouseEnter={() => setActive(i)}
          >
            <span className="truncate">{c.node.title}</span>
          </button>
        ))
      )}
    </div>
  )
}
