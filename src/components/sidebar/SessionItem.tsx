import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { type SessionVM, sessionService } from '@/domain'
import { cn } from '@/lib/utils'
import { formatRelativeTime, formatAbsolute } from '@/lib/datetime'
import { splitSnippet } from '@/lib/snippet'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from '@/components/ui/ContextMenu'

interface SessionItemProps {
  session: SessionVM
  active: boolean
  onSelect: () => void
  onDelete: () => void
  /** Search-match snippet; when present, renders a second line under the title. */
  snippet?: string
}

export function SessionItem({ session, active, onSelect, onDelete, snippet }: SessionItemProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(session.title)
  const inputRef = useRef<HTMLInputElement>(null)
  // Dedupe Enter+blur (and Escape+blur) so we commit/cancel an edit exactly once.
  const committedRef = useRef(false)

  // Focus + select on the next frame: lets radix finish its close-focus restore first.
  useEffect(() => {
    if (!editing) return
    const id = requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.select() })
    return () => cancelAnimationFrame(id)
  }, [editing])

  const startEdit = () => { committedRef.current = false; setDraft(session.title); setEditing(true) }
  const commit = () => {
    if (committedRef.current) return
    committedRef.current = true
    setEditing(false)
    const next = draft.trim()
    if (next && next !== session.title) sessionService.renameSession(session.id, next)
  }
  const cancel = () => { committedRef.current = true; setEditing(false) }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          data-testid="session-item"
          onClick={editing ? undefined : onSelect}
          className={cn(
            'group flex cursor-pointer flex-col gap-0.5 rounded-lg px-2.5 py-2 transition-colors',
            active ? 'bg-accent/10 text-accent-strong' : 'text-ink hover:bg-surface-muted',
          )}
        >
          <div className="flex items-center gap-2">
            {editing ? (
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commit() }
                  else if (e.key === 'Escape') { e.preventDefault(); cancel() }
                }}
                onBlur={commit}
                className="min-w-0 flex-1 rounded border border-accent/40 bg-surface px-1 py-0 text-body text-ink outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-accent/60"
              />
            ) : (
              <>
                <span className={cn('min-w-0 flex-1 truncate text-body font-medium', active ? 'text-accent-strong' : 'text-ink')}>
                  {session.title}
                </span>
                {/* Relative time is formatted at render from updatedAtMs (localized; recomputed on each
                    re-render, e.g. on activity/search/language change). No per-minute ticker by design. */}
                <span className="shrink-0 text-caption text-ink-tertiary" title={formatAbsolute(session.updatedAtMs, locale)}>
                  {formatRelativeTime(session.updatedAtMs, locale)}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete() }}
                  className="shrink-0 rounded p-0.5 text-ink-tertiary opacity-0 transition-[color,opacity,background-color] hover:bg-danger/10 hover:text-danger group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                  title={t('sidebar.deleteSession')}
                >
                  <X size={14} />
                </button>
              </>
            )}
          </div>
          {snippet && !editing && (
            <span className="block truncate text-meta text-ink-tertiary">
              {splitSnippet(snippet).map((seg, i) =>
                seg.mark ? (
                  <mark key={i} className="rounded bg-accent/10 px-0.5 text-accent-strong">
                    {seg.text}
                  </mark>
                ) : (
                  <span key={i}>{seg.text}</span>
                ),
              )}
            </span>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={startEdit}>{t('sidebar.renameSession')}</ContextMenuItem>
        <ContextMenuItem className="text-danger focus:bg-danger/10" onSelect={onDelete}>
          {t('sidebar.deleteSession')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
