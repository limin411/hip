import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  DefaultReactSuggestionItem,
  SuggestionMenuProps,
} from '@blocknote/react'
import { cn } from '@/lib/utils'
import { KNOWLEDGE_SLASH_ITEMS } from '@/domain/knowledge/slashMenu'

const ICON_BY_NAME = new Map(
  KNOWLEDGE_SLASH_ITEMS.map((item) => [item.name, item.icon] as const),
)

/**
 * Live slash menu chrome — matches Source `KnowledgeSlashMenu`
 * (groups, icon tiles, accent active, overlay shadow).
 * Wired via BlockNote `SuggestionMenuController.suggestionMenuComponent`.
 */
export function BlockNoteHipSlashMenu({
  items,
  loadingState,
  selectedIndex,
  onItemClick,
}: SuggestionMenuProps<DefaultReactSuggestionItem>) {
  const { t } = useTranslation()
  const activeRef = useRef<HTMLButtonElement | null>(null)
  const loaded = loadingState === 'loaded'
  const safeIndex =
    items.length === 0 || selectedIndex == null
      ? -1
      : Math.min(selectedIndex, items.length - 1)

  useEffect(() => {
    if (safeIndex < 0) return
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [safeIndex, items])

  const groups = useMemo(() => {
    const out: { label: string; start: number; items: DefaultReactSuggestionItem[] }[] =
      []
    let current: (typeof out)[number] | null = null
    items.forEach((item, index) => {
      const label = item.group ?? ''
      if (!current || current.label !== label) {
        current = { label, start: index, items: [] }
        out.push(current)
      }
      current.items.push(item)
    })
    return out
  }, [items])

  let flatIndex = 0

  return (
    <div
      id="bn-suggestion-menu"
      role="listbox"
      aria-label={t('knowledge.slash.listLabel')}
      aria-activedescendant={
        safeIndex >= 0 ? `bn-suggestion-menu-item-${safeIndex}` : undefined
      }
      data-testid="knowledge-slash-menu"
      className="z-50 max-h-72 w-[min(100vw-2rem,22.25rem)] animate-menu-in overflow-y-auto rounded-xl border border-border bg-surface shadow-overlay"
    >
      {!loaded ? (
        <div
          className="px-3 py-4 text-center text-meta text-ink-secondary"
          role="presentation"
        >
          …
        </div>
      ) : items.length === 0 ? (
        <div
          data-testid="knowledge-slash-menu-empty"
          className="px-3 py-4 text-center text-meta text-ink-secondary"
          role="presentation"
        >
          {t('knowledge.slash.noMatch')}
        </div>
      ) : (
        groups.map((group) => (
          <div
            key={`${group.label}-${group.start}`}
            role="group"
            data-testid={
              group.label
                ? `knowledge-slash-group-${group.label}`
                : 'knowledge-slash-group'
            }
          >
            {group.label ? (
              <div className="px-3.5 pb-1 pt-2 text-meta font-semibold uppercase tracking-wide text-ink-tertiary">
                {group.label}
              </div>
            ) : null}
            {group.items.map((item) => {
              const i = flatIndex++
              const selected = i === safeIndex
              const icon =
                (typeof item.subtext === 'string'
                  ? ICON_BY_NAME.get(item.subtext)
                  : undefined) ?? '·'
              const subtitle =
                typeof item.subtext === 'string' && item.subtext
                  ? `/${item.subtext}`
                  : undefined
              return (
                <button
                  key={`${item.title}-${i}`}
                  type="button"
                  id={`bn-suggestion-menu-item-${i}`}
                  data-testid={
                    typeof item.subtext === 'string' && item.subtext
                      ? `knowledge-slash-${item.subtext}`
                      : `knowledge-slash-item-${i}`
                  }
                  role="option"
                  aria-selected={selected}
                  ref={selected ? activeRef : undefined}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onItemClick?.(item)}
                  className={cn(
                    'kb-slash-item flex h-10 w-full items-center gap-2.5 px-3 text-left text-body text-ink transition-colors hover:bg-state-hover',
                    selected && 'kb-slash-selected',
                  )}
                >
                  <span
                    className="flex w-[46px] shrink-0 justify-center"
                    aria-hidden
                  >
                    <span className="kb-slash-icon">{icon}</span>
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">
                    {item.title}
                  </span>
                  {subtitle ? (
                    <span className="shrink-0 truncate text-caption text-ink-tertiary">
                      {subtitle}
                    </span>
                  ) : null}
                  {selected ? (
                    <span
                      className="kb-slash-arrow"
                      aria-hidden
                    >
                      ›
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
        ))
      )}
    </div>
  )
}
