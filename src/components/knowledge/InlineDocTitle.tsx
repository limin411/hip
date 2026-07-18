import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

export interface InlineDocTitleProps {
  docId: string
  title: string
  readOnly?: boolean
  onCommit: (title: string) => void | Promise<void>
  className?: string
}

/**
 * Large page title above the doc canvas. Commits on Enter/blur; Esc cancels.
 * Title stays in tree.json via renameNode — not H1/frontmatter.
 */
export function InlineDocTitle({
  docId,
  title,
  readOnly = false,
  onCommit,
  className,
}: InlineDocTitleProps) {
  const [draft, setDraft] = useState(title)
  const [focused, setFocused] = useState(false)
  const skipBlurCommit = useRef(false)

  // Re-seed when doc changes or external rename (while not editing).
  useEffect(() => {
    if (!focused) setDraft(title)
  }, [docId, title, focused])

  const commit = () => {
    setFocused(false)
    const next = draft.trim()
    if (!next) {
      setDraft(title)
      return
    }
    if (next !== title) void onCommit(next)
  }

  const cancel = () => {
    setDraft(title)
    setFocused(false)
  }

  if (readOnly) {
    return (
      <h1
        data-testid="knowledge-doc-title"
        className={cn(
          'shrink-0 px-0 pb-2 pt-7 sm:pt-8 text-page font-semibold tracking-tight text-ink',
          className,
        )}
      >
        {title}
      </h1>
    )
  }

  return (
    <input
      data-testid="knowledge-doc-title"
      type="text"
      value={draft}
      aria-label="Document title"
      className={cn(
        'w-full shrink-0 border-0 bg-transparent px-0 pb-2 pt-7 sm:pt-8 text-page font-semibold tracking-tight text-ink',
        'placeholder:text-ink-tertiary focus:outline-none focus-visible:ring-0',
        className,
      )}
      placeholder="Untitled"
      onFocus={() => setFocused(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (skipBlurCommit.current) {
          skipBlurCommit.current = false
          return
        }
        commit()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          skipBlurCommit.current = true
          commit()
          ;(e.target as HTMLInputElement).blur()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          skipBlurCommit.current = true
          cancel()
          ;(e.target as HTMLInputElement).blur()
        }
      }}
    />
  )
}
