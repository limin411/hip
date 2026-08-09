import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, Search } from 'lucide-react'
import { inputClassName } from '@/components/ui/Input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover'
import type { AgentModelGroup } from '@/lib/agentModelOptions'
import {
  countModels,
  currentModelLabel,
  filterModelGroups,
  flattenModelKeys,
  MODEL_SEARCH_THRESHOLD,
} from '@/lib/modelPickerSearch'
import { cn } from '@/lib/utils'

export type ModelSelectFieldProps = {
  value: string
  onChange: (key: string) => void
  groups: AgentModelGroup[]
  /** Label when value is empty (e.g. “Active model”). */
  emptyLabel: string
  disabled?: boolean
  /** Optional orphan key not in catalog — still selectable for honesty. */
  orphanLabel?: string
  className?: string
  /**
   * `field` — full-width form control (default).
   * `chip` — compact composer-style chip (automation prompt toolbar, etc.).
   */
  variant?: 'field' | 'chip'
  'data-testid'?: string
  'aria-label'?: string
  /**
   * Always show search when true. Default: show once catalog ≥ threshold
   * (same as chat ModelPicker).
   */
  alwaysSearch?: boolean
}

/**
 * Form-field model picker — same searchable list UX as chat ModelPicker.
 *
 * Uses Radix Popover (`modal={false}`) so it works inside Dialog/Modal:
 * - Portaled via Radix (not clipped by Modal overflow)
 * - `data-radix-popper-content-wrapper` is already in Modal’s outside/focus guards
 * - List uses explicit max-height + overflow-y-auto (reliable scrollbar)
 *
 * Controlled: empty string means “use default / active model”.
 */
export function ModelSelectField({
  value,
  onChange,
  groups,
  emptyLabel,
  disabled = false,
  orphanLabel,
  className,
  variant = 'field',
  'data-testid': dataTestId = 'model-select-field',
  'aria-label': ariaLabel,
  alwaysSearch = true,
}: ModelSelectFieldProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const activeItemRef = useRef<HTMLButtonElement | null>(null)
  const listId = useId()
  const searchId = useId()

  const totalCount = countModels(groups)
  const showSearch = alwaysSearch || totalCount >= MODEL_SEARCH_THRESHOLD
  const filtered = useMemo(() => filterModelGroups(groups, query), [groups, query])
  const flatKeys = useMemo(() => flattenModelKeys(filtered), [filtered])

  const showOrphan =
    Boolean(value.trim()) &&
    !groups.some((g) => g.models.some((m) => m.key === value)) &&
    Boolean(orphanLabel)

  const optionKeys = useMemo(() => {
    const keys = ['', ...flatKeys]
    if (showOrphan && value && !keys.includes(value)) keys.push(value)
    return keys
  }, [flatKeys, showOrphan, value])

  const label = value.trim()
    ? currentModelLabel(value) || value
    : emptyLabel

  const displayLabel = showOrphan && orphanLabel ? orphanLabel : label

  // Reset / seed when popover opens or closes.
  useEffect(() => {
    if (!open) {
      setQuery('')
      setActiveIndex(0)
      return
    }
    const idx = optionKeys.indexOf(value)
    setActiveIndex(idx >= 0 ? idx : 0)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  useEffect(() => {
    setActiveIndex((i) =>
      optionKeys.length === 0 ? 0 : Math.min(i, optionKeys.length - 1),
    )
  }, [optionKeys])

  const safeIndex =
    optionKeys.length === 0 ? 0 : Math.min(activeIndex, optionKeys.length - 1)

  useEffect(() => {
    if (!open || optionKeys.length === 0) return
    activeItemRef.current?.scrollIntoView({ block: 'nearest' })
  }, [safeIndex, open, optionKeys])

  const selectKey = (key: string) => {
    onChange(key)
    setOpen(false)
  }

  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (optionKeys.length === 0) return
      setActiveIndex((i) =>
        Math.min(Math.min(i, optionKeys.length - 1) + 1, optionKeys.length - 1),
      )
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (optionKeys.length === 0) return
      setActiveIndex((i) => Math.max(Math.min(i, optionKeys.length - 1) - 1, 0))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const key = optionKeys[safeIndex]
      if (key !== undefined) selectKey(key)
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    }
  }

  const indexByKey = useMemo(() => {
    const map = new Map<string, number>()
    optionKeys.forEach((key, i) => map.set(key, i))
    return map
  }, [optionKeys])

  const isChip = variant === 'chip'

  const optionClass = (active: boolean) =>
    cn(
      'flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-body text-ink outline-none transition-colors duration-chrome',
      active ? 'bg-state-hover' : 'hover:bg-state-hover',
    )

  return (
    <Popover
      open={open && !disabled}
      onOpenChange={(next) => {
        if (disabled) return
        setOpen(next)
      }}
      modal={false}
    >
      <div className={cn(isChip ? 'inline-flex' : 'relative w-full', className)}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            data-testid={dataTestId}
            aria-label={ariaLabel}
            aria-haspopup="listbox"
            aria-expanded={open && !disabled}
            className={cn(
              isChip
                ? cn(
                    'inline-flex h-7 max-w-[11rem] items-center gap-1 rounded-sm px-2 text-meta font-medium transition-colors duration-chrome',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
                    open
                      ? 'bg-state-hover text-ink'
                      : 'text-ink-tertiary hover:bg-state-hover hover:text-ink-secondary',
                    disabled && 'cursor-not-allowed opacity-50',
                  )
                : cn(
                    inputClassName,
                    'flex w-full items-center justify-between gap-2 text-left font-normal',
                    disabled && 'cursor-not-allowed opacity-60',
                  ),
            )}
          >
            <span
              className={cn(
                'min-w-0 truncate',
                isChip ? 'flex-1' : 'min-w-0 flex-1',
                !isChip && (value.trim() ? 'text-ink' : 'text-ink-tertiary'),
              )}
            >
              {displayLabel}
            </span>
            <ChevronDown
              className={cn(
                'shrink-0 transition-transform duration-chrome',
                isChip ? 'h-3 w-3' : 'h-3.5 w-3.5 text-ink-tertiary',
                open && 'rotate-180',
              )}
              strokeWidth={1.75}
              aria-hidden
            />
          </button>
        </PopoverTrigger>
      </div>

      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={4}
        collisionPadding={12}
        // Above Modal (z-50). Inline zIndex wins on Radix wrapper in WebView.
        style={{ zIndex: 100 }}
        className={cn(
          'p-0',
          isChip
            ? 'w-[min(18rem,calc(100vw-2rem))]'
            : 'w-[var(--radix-popover-trigger-width)] min-w-[16rem]',
        )}
        data-testid={`${dataTestId}-popover`}
        data-model-select-panel=""
        onOpenAutoFocus={(e) => {
          if (showSearch) {
            e.preventDefault()
            requestAnimationFrame(() =>
              searchRef.current?.focus({ preventScroll: true }),
            )
          }
        }}
        // Keep focus in the form after close (don’t jump to body).
        onCloseAutoFocus={(e) => e.preventDefault()}
        onKeyDown={showSearch ? undefined : onListKeyDown}
      >
        {showSearch ? (
          <div className="shrink-0 border-b border-border px-2 py-2">
            <label htmlFor={searchId} className="sr-only">
              {t('chat.searchModels')}
            </label>
            <div className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2">
              <Search size={13} className="shrink-0 text-ink-tertiary" aria-hidden />
              <input
                id={searchId}
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onListKeyDown}
                placeholder={t('chat.searchModels')}
                className="w-full bg-transparent text-meta text-ink placeholder:text-ink-tertiary focus:outline-none"
                data-testid={`${dataTestId}-search`}
                autoComplete="off"
                spellCheck={false}
                aria-controls={listId}
                aria-activedescendant={
                  optionKeys[safeIndex] !== undefined
                    ? `${listId}-opt-${safeIndex}`
                    : undefined
                }
              />
            </div>
          </div>
        ) : null}

        {/* Explicit max-height — same pattern as chat ModelPicker (scrollbar always works). */}
        <div
          id={listId}
          role="listbox"
          aria-label={ariaLabel ?? t('chat.modelHint')}
          className="max-h-[min(280px,45vh)] overflow-y-auto overscroll-contain p-1"
          data-testid={`${dataTestId}-list`}
        >
          {(() => {
            const index = indexByKey.get('') ?? 0
            const selected = !value.trim()
            const active = index === safeIndex
            return (
              <button
                type="button"
                id={`${listId}-opt-${index}`}
                role="option"
                aria-selected={selected}
                data-testid={`${dataTestId}-default`}
                ref={active ? activeItemRef : undefined}
                className={optionClass(active)}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectKey('')}
              >
                <Check
                  size={14}
                  className={cn('shrink-0', selected ? 'opacity-100' : 'opacity-0')}
                  aria-hidden
                />
                <span className="truncate text-ink-secondary">{emptyLabel}</span>
              </button>
            )
          })()}

          {filtered.length === 0 && !showOrphan ? (
            query.trim() || groups.length === 0 ? (
              <div
                className="px-2.5 py-3 text-center text-meta text-ink-tertiary"
                data-testid={`${dataTestId}-empty`}
              >
                {groups.length === 0
                  ? t('chat.noModelsAvailable')
                  : t('chat.noModelsMatch')}
              </div>
            ) : null
          ) : (
            filtered.map((g) => (
              <div
                key={g.providerID}
                role="group"
                aria-label={g.providerName}
                data-testid={`${dataTestId}-group`}
              >
                <div className="px-2.5 py-1.5 text-caption font-medium text-ink-tertiary">
                  {g.providerName}
                </div>
                {g.models.map((m) => {
                  const index = indexByKey.get(m.key) ?? 0
                  const selected = value === m.key
                  const active = index === safeIndex
                  return (
                    <button
                      key={m.key}
                      id={`${listId}-opt-${index}`}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      data-testid={`${dataTestId}-item`}
                      ref={active ? activeItemRef : undefined}
                      className={optionClass(active)}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => selectKey(m.key)}
                    >
                      <Check
                        size={14}
                        className={cn(
                          'shrink-0',
                          selected ? 'opacity-100' : 'opacity-0',
                        )}
                        aria-hidden
                      />
                      <span className="truncate">{m.modelID}</span>
                    </button>
                  )
                })}
              </div>
            ))
          )}

          {showOrphan && value
            ? (() => {
                const index = indexByKey.get(value) ?? 0
                const selected = true
                const active = index === safeIndex
                return (
                  <button
                    type="button"
                    id={`${listId}-opt-${index}`}
                    role="option"
                    aria-selected={selected}
                    data-testid={`${dataTestId}-orphan`}
                    ref={active ? activeItemRef : undefined}
                    className={optionClass(active)}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => selectKey(value)}
                  >
                    <Check
                      size={14}
                      className={cn(
                        'shrink-0',
                        selected ? 'opacity-100' : 'opacity-0',
                      )}
                      aria-hidden
                    />
                    <span className="truncate text-ink-secondary">
                      {orphanLabel}
                    </span>
                  </button>
                )
              })()
            : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}
