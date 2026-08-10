import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

/**
 * Terminal search overlay bar (P0.1, spec docs/design/doc-terminal-capability-gap/).
 *
 * Fully controlled — the parent (XtermSurface) owns query / match state and drives
 * the SearchAddon. No xterm dependency here so this component is unit-testable
 * without a terminal mock.
 *
 * Contract:
 * - Rendered inside a `position: relative` terminal container; floats at the top.
 * - `onStep(1)` / `onStep(-1)` move to next / previous match.
 * - `matchCount === 0` renders "0 / 0" and Enter still steps (no-op in addon).
 */
export type TerminalSearchBarProps = {
  query: string
  onQueryChange: (query: string) => void
  /** 1-based index of the current match (0 when none). */
  matchIndex: number
  matchCount: number
  caseSensitive: boolean
  onToggleCase: () => void
  onStep: (dir: 1 | -1) => void
  onClose: () => void
}

export function TerminalSearchBar({
  query,
  onQueryChange,
  matchIndex,
  matchCount,
  caseSensitive,
  onToggleCase,
  onStep,
  onClose,
}: TerminalSearchBarProps) {
  const { t } = useTranslation()

  return (
    <div
      className="absolute left-2 right-2 top-2 z-20 flex items-center gap-2 rounded-lg border border-black/40 bg-[#1c1c1c] px-2.5 py-1.5 shadow-lg shadow-black/40"
      data-testid="terminal-searchbar"
      role="search"
    >
      <span className="text-ink-tertiary" aria-hidden>
        ⌕
      </span>
      <input
        autoFocus
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            onStep(e.shiftKey ? -1 : 1)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
        placeholder={t('artifact.terminalView.searchPlaceholder')}
        className="min-w-0 flex-1 bg-transparent font-mono text-body text-ink outline-none placeholder:text-ink-tertiary/70"
        data-testid="terminal-searchbar-input"
        spellCheck={false}
      />
      <span
        className="shrink-0 font-mono text-meta text-ink-tertiary"
        data-testid="terminal-searchbar-count"
      >
        {matchCount > 0 ? `${matchIndex} / ${matchCount}` : '0 / 0'}
      </span>
      <span className="h-3.5 w-px shrink-0 bg-ink-tertiary/25" aria-hidden />
      <button
        type="button"
        onClick={onToggleCase}
        title={t('artifact.terminalView.searchCase')}
        className={cn(
          'shrink-0 rounded px-1.5 py-0.5 font-mono text-meta transition-colors',
          caseSensitive
            ? 'bg-accent/15 text-accent-strong'
            : 'text-ink-tertiary hover:bg-state-hover hover:text-ink',
        )}
        data-testid="terminal-searchbar-case"
      >
        Aa
      </button>
      <button
        type="button"
        onClick={() => onStep(-1)}
        title={t('artifact.terminalView.searchPrev')}
        className="shrink-0 rounded px-1.5 py-0.5 text-meta text-ink-tertiary hover:bg-state-hover hover:text-ink"
        data-testid="terminal-searchbar-prev"
      >
        ↑
      </button>
      <button
        type="button"
        onClick={() => onStep(1)}
        title={t('artifact.terminalView.searchNext')}
        className="shrink-0 rounded px-1.5 py-0.5 text-meta text-ink-tertiary hover:bg-state-hover hover:text-ink"
        data-testid="terminal-searchbar-next"
      >
        ↓
      </button>
      <button
        type="button"
        onClick={onClose}
        title={t('artifact.terminalView.searchClose')}
        className="shrink-0 rounded px-1.5 py-0.5 text-meta text-ink-tertiary hover:bg-state-hover hover:text-ink"
        data-testid="terminal-searchbar-close"
      >
        ✕
      </button>
    </div>
  )
}
