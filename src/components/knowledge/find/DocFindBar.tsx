import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface DocFindBarProps {
  open: boolean
  onClose: () => void
  /** Root element to search within (Live editor DOM). */
  root: HTMLElement | null
  /** Enable replace UI (Phase 2). */
  enableReplace?: boolean
  className?: string
}

/**
 * In-document find bar for Live editor.
 * Uses window.find when available; falls back to TreeWalker text scan.
 */
export function DocFindBar({
  open,
  onClose,
  root,
  enableReplace = false,
  className,
}: DocFindBarProps) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [replace, setReplace] = useState('')
  const [index, setIndex] = useState(0)
  const [total, setTotal] = useState(0)
  const rangesRef = useRef<Range[]>([])

  useEffect(() => {
    if (open) {
      window.setTimeout(() => inputRef.current?.focus(), 0)
    } else {
      clearHighlights()
      setQuery('')
      setReplace('')
      setIndex(0)
      setTotal(0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open || !root) return
    const ranges = collectRanges(root, query)
    rangesRef.current = ranges
    setTotal(ranges.length)
    setIndex(ranges.length ? 1 : 0)
    if (ranges.length) scrollToRange(ranges[0]!)
  }, [query, open, root])

  const go = (dir: 1 | -1) => {
    const ranges = rangesRef.current
    if (!ranges.length) return
    const next =
      dir === 1
        ? index >= ranges.length
          ? 1
          : index + 1
        : index <= 1
          ? ranges.length
          : index - 1
    setIndex(next)
    scrollToRange(ranges[next - 1]!)
  }

  const doReplaceOne = () => {
    if (!enableReplace || !query || !root) return
    const ranges = rangesRef.current
    if (!ranges.length || index < 1) return
    const range = ranges[index - 1]!
    range.deleteContents()
    range.insertNode(document.createTextNode(replace))
    // Rescan
    const next = collectRanges(root, query)
    rangesRef.current = next
    setTotal(next.length)
    setIndex(next.length ? Math.min(index, next.length) : 0)
    if (next.length) scrollToRange(next[Math.min(index, next.length) - 1]!)
    root.dispatchEvent(new Event('input', { bubbles: true }))
  }

  const doReplaceAll = () => {
    if (!enableReplace || !query || !root) return
    // Walk backwards so ranges stay valid
    const ranges = [...rangesRef.current].reverse()
    for (const range of ranges) {
      range.deleteContents()
      range.insertNode(document.createTextNode(replace))
    }
    rangesRef.current = []
    setTotal(0)
    setIndex(0)
    root.dispatchEvent(new Event('input', { bubbles: true }))
  }

  if (!open) return null

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-1.5 shadow-sm',
        className,
      )}
      data-testid="knowledge-doc-find-bar"
      role="search"
    >
      <input
        ref={inputRef}
        className="h-7 min-w-[10rem] flex-1 rounded-sm border border-border bg-surface-muted px-2 text-meta text-ink focus:outline-none focus:ring-1 focus:ring-accent/30"
        data-testid="knowledge-doc-find-input"
        placeholder={t('knowledge.doc.findPlaceholder')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          } else if (e.key === 'Enter') {
            e.preventDefault()
            go(e.shiftKey ? -1 : 1)
          }
        }}
      />
      <span
        className="shrink-0 text-meta text-ink-tertiary tabular-nums"
        data-testid="knowledge-doc-find-count"
      >
        {total === 0 ? '0/0' : `${index}/${total}`}
      </span>
      <button
        type="button"
        className="rounded-sm p-1 text-ink-secondary hover:bg-state-hover hover:text-ink"
        data-testid="knowledge-doc-find-prev"
        aria-label={t('knowledge.doc.findPrev')}
        onClick={() => go(-1)}
      >
        <ChevronUp size={16} />
      </button>
      <button
        type="button"
        className="rounded-sm p-1 text-ink-secondary hover:bg-state-hover hover:text-ink"
        data-testid="knowledge-doc-find-next"
        aria-label={t('knowledge.doc.findNext')}
        onClick={() => go(1)}
      >
        <ChevronDown size={16} />
      </button>
      {enableReplace ? (
        <>
          <input
            className="h-7 min-w-[8rem] rounded-sm border border-border bg-surface-muted px-2 text-meta text-ink focus:outline-none focus:ring-1 focus:ring-accent/30"
            data-testid="knowledge-doc-replace-input"
            placeholder={t('knowledge.doc.replacePlaceholder')}
            value={replace}
            onChange={(e) => setReplace(e.target.value)}
          />
          <button
            type="button"
            className="rounded-sm px-2 py-1 text-meta text-ink hover:bg-state-hover"
            data-testid="knowledge-doc-replace-one"
            onClick={doReplaceOne}
          >
            {t('knowledge.doc.replace')}
          </button>
          <button
            type="button"
            className="rounded-sm px-2 py-1 text-meta text-ink hover:bg-state-hover"
            data-testid="knowledge-doc-replace-all"
            onClick={doReplaceAll}
          >
            {t('knowledge.doc.replaceAll')}
          </button>
        </>
      ) : null}
      <button
        type="button"
        className="rounded-sm p-1 text-ink-secondary hover:bg-state-hover hover:text-ink"
        data-testid="knowledge-doc-find-close"
        aria-label={t('common.close')}
        onClick={onClose}
      >
        <X size={16} />
      </button>
    </div>
  )
}

function clearHighlights() {
  // CSS ::highlight or selection — we use native selection only
  try {
    window.getSelection()?.removeAllRanges()
  } catch {
    // ignore
  }
}

function scrollToRange(range: Range) {
  try {
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
    const el =
      range.startContainer instanceof HTMLElement
        ? range.startContainer
        : range.startContainer.parentElement
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  } catch {
    // ignore
  }
}

function collectRanges(root: HTMLElement, query: string): Range[] {
  const q = query.trim()
  if (!q) return []
  const out: Range[] = []
  const qLower = q.toLowerCase()
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    const text = node.textContent ?? ''
    const lower = text.toLowerCase()
    let from = 0
    while (from < lower.length) {
      const at = lower.indexOf(qLower, from)
      if (at < 0) break
      try {
        const range = document.createRange()
        range.setStart(node, at)
        range.setEnd(node, at + q.length)
        out.push(range)
      } catch {
        // ignore invalid
      }
      from = at + q.length
    }
    node = walker.nextNode()
  }
  return out
}
