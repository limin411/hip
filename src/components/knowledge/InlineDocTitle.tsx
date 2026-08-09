import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

/** 多行标题的公共类（textarea 与只读渲染共享）。 */
const titleClass =
  'w-full shrink-0 border-0 bg-transparent px-0 pb-4 pt-1.5 sm:pt-2 text-page font-semibold tracking-tight text-ink'
const editableTitleClass = cn(
  titleClass,
  'min-w-0 flex-1 resize-none overflow-hidden leading-tight placeholder:text-ink-tertiary focus:outline-none focus-visible:ring-0',
)

export interface InlineDocTitleProps {
  docId: string
  title: string
  readOnly?: boolean
  onCommit: (title: string) => void | Promise<void>
  /**
   * Called after Enter commit path (including empty-title restore).
   * Used to move focus into the Live body (R4).
   */
  onEnterCommit?: () => void
  className?: string
  /** Override default `knowledge.doc.titleLabel` (e.g. board chrome). */
  ariaLabel?: string
  /** Override default `knowledge.doc.untitled` placeholder. */
  placeholder?: string
  /**
   * Embedded in a flex row (PageHeader title + hover menu): drop the
   * measure column classes, stretch to the row remainder.
   */
  embedded?: boolean
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
  onEnterCommit,
  className,
  ariaLabel,
  placeholder,
  embedded = false,
}: InlineDocTitleProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(title)
  const [focused, setFocused] = useState(false)
  const skipBlurCommit = useRef(false)
  const taRef = useRef<HTMLTextAreaElement>(null)
  // 高度自适应：内容换行时增高（长标题可见），无换行时回到单行。
  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${el.scrollHeight}px`
  }, [draft, focused])
  const resolvedAria = ariaLabel ?? t('knowledge.doc.titleLabel')
  const resolvedPlaceholder = placeholder ?? t('knowledge.doc.untitled')

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
          // Same measure as body column (Notion-like page stack).
          'knowledge-doc-measure shrink-0 px-0 pb-2 pt-1.5 sm:pt-2 text-page font-semibold tracking-tight text-ink',
          className,
        )}
      >
        {title}
      </h1>
    )
  }

  return (
    <textarea
      ref={taRef}
      data-testid="knowledge-doc-title"
      rows={1}
      value={draft}
      aria-label={resolvedAria}
      className={cn(
        embedded ? editableTitleClass : cn('knowledge-doc-measure', editableTitleClass),
        className,
      )}
      placeholder={resolvedPlaceholder}
      onFocus={() => setFocused(true)}
      onChange={(e) => {
        // 标题仅视觉换行：剔除粘贴/输入带入的换行符（Enter 由 onKeyDown 提交）。
        setDraft(e.target.value.replace(/\n/g, ''))
      }}
      onBlur={() => {
        if (skipBlurCommit.current) {
          skipBlurCommit.current = false
          return
        }
        commit()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault()
          skipBlurCommit.current = true
          commit()
          // Always leave title for body (even if empty restore / no rename).
          onEnterCommit?.()
          ;(e.target as HTMLTextAreaElement).blur()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          skipBlurCommit.current = true
          cancel()
          ;(e.target as HTMLTextAreaElement).blur()
        }
      }}
    />
  )
}
