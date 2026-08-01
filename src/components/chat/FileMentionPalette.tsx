import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import {
  workspaceFileSearch,
  type WorkspaceFileSearchHit,
} from '@/ipc/workspaceFileSearch'

const DEBOUNCE_MS = 120

export interface FileMentionPaletteProps {
  /** Active @ query (without leading @). Empty string = hint only. */
  query: string
  searchRoot: string
  onSelect: (hit: WorkspaceFileSearchHit) => void
  onDismiss?: () => void
}

/**
 * File reference palette — triggered when the user types `@` in the chat composer
 * and a project search root is available.
 */
export function FileMentionPalette({
  query,
  searchRoot,
  onSelect,
  onDismiss,
}: FileMentionPaletteProps) {
  const { t } = useTranslation()
  const [hits, setHits] = useState<WorkspaceFileSearchHit[]>([])
  const [loading, setLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const activeRef = useRef<HTMLButtonElement | null>(null)
  const genRef = useRef(0)

  useEffect(() => {
    const gen = ++genRef.current
    if (!query.trim()) {
      setHits([])
      setLoading(false)
      return
    }

    setLoading(true)
    const timer = window.setTimeout(() => {
      void workspaceFileSearch({
        root: searchRoot,
        query,
        limit: 50,
        includeDirs: true,
      })
        .then((r) => {
          if (gen !== genRef.current) return
          setHits(r.hits)
          setLoading(false)
        })
        .catch(() => {
          if (gen !== genRef.current) return
          setHits([])
          setLoading(false)
        })
    }, DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timer)
    }
  }, [query, searchRoot])

  useEffect(() => {
    setActiveIndex(0)
  }, [query, hits])

  useEffect(() => {
    setActiveIndex((i) => (hits.length === 0 ? 0 : Math.min(i, hits.length - 1)))
  }, [hits])

  const safeIndex = hits.length === 0 ? 0 : Math.min(activeIndex, hits.length - 1)

  useEffect(() => {
    if (hits.length === 0) return
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [safeIndex, hits])

  // Always attach while mounted so empty-state Enter cannot fall through to Composer submit.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopImmediatePropagation()
        if (hits.length === 0) return
        setActiveIndex((i) => {
          const cur = Math.min(i, hits.length - 1)
          return Math.min(cur + 1, hits.length - 1)
        })
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopImmediatePropagation()
        if (hits.length === 0 || safeIndex <= 0) {
          onDismiss?.()
        } else {
          setActiveIndex(safeIndex - 1)
        }
        return
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        e.stopImmediatePropagation()
        if (hits[safeIndex]) onSelect(hits[safeIndex])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        onDismiss?.()
        return
      }
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [safeIndex, hits, onSelect, onDismiss])

  const body = useMemo(() => {
    if (!query.trim()) {
      return (
        <div
          data-testid="file-mention-hint"
          className="px-3 py-4 text-center text-meta text-ink-secondary"
          role="presentation"
        >
          {t('chat.fileMention.hint')}
        </div>
      )
    }
    if (loading && hits.length === 0) {
      return (
        <div
          data-testid="file-mention-loading"
          className="px-3 py-4 text-center text-meta text-ink-secondary"
          role="presentation"
        >
          {t('chat.fileMention.loading')}
        </div>
      )
    }
    if (hits.length === 0) {
      return (
        <div
          data-testid="file-mention-empty"
          className="px-3 py-4 text-center text-meta text-ink-secondary"
          role="presentation"
        >
          {t('chat.fileMention.noMatch')}
        </div>
      )
    }
    return hits.map((hit, i) => (
      <button
        key={`${hit.isDir ? 'd' : 'f'}:${hit.absolutePath}`}
        type="button"
        data-testid={`file-mention-hit-${i}`}
        data-path={hit.relativePath}
        role="option"
        aria-selected={i === safeIndex}
        ref={i === safeIndex ? activeRef : undefined}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onSelect(hit)}
        onMouseEnter={() => setActiveIndex(i)}
        className={cn(
          'flex w-full items-center gap-2 px-3 py-2 text-left text-body text-ink transition-colors hover:bg-state-hover first:rounded-t-lg last:rounded-b-lg',
          i === safeIndex && 'bg-accent-subtle',
        )}
      >
        <span className="min-w-0 flex-1 truncate font-mono text-caption text-ink">
          {hit.relativePath}
        </span>
        {hit.isDir && (
          <span className="shrink-0 rounded bg-surface-muted px-1.5 py-0.5 text-caption text-ink-tertiary">
            {t('chat.fileMention.dirSuffix')}
          </span>
        )}
      </button>
    ))
  }, [query, loading, hits, safeIndex, onSelect, t])

  return (
    <div
      role="listbox"
      aria-label={t('chat.fileMention.listLabel')}
      data-testid="file-mention-palette"
      className="absolute bottom-full left-0 right-0 z-50 mb-2 max-h-48 animate-menu-in overflow-y-auto rounded-xl border border-border bg-surface shadow-overlay"
    >
      {body}
    </div>
  )
}
