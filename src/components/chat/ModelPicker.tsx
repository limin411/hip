import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Cpu, Search } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover'
import { ComposerChip } from './ComposerChip'
import { useDraftStore } from '@/store/draftStore'
import { useProvidersStore } from '@/store/providersStore'
import { useActiveSession, useActiveSessionId, sessionService } from '@/domain'
import { groupModelOptions } from '@/lib/agentModelOptions'
import { activeModelKey } from '@/lib/modelKey'
import {
  countModels,
  currentModelLabel,
  filterModelGroups,
  flattenModelKeys,
  MODEL_SEARCH_THRESHOLD,
} from '@/lib/modelPickerSearch'
import { cn } from '@/lib/utils'

/** Pure: groups for the dropdown. */
export const modelPickerItems = groupModelOptions

// Re-export pure helpers so existing `from './ModelPicker'` imports keep working.
export {
  countModels,
  currentModelLabel,
  filterModelGroups,
  flattenModelKeys,
  MODEL_SEARCH_THRESHOLD,
}

export function ModelPicker() {
  const { t } = useTranslation()
  const draft = useDraftStore((s) => s.draft)
  const setModelKey = useDraftStore((s) => s.setModelKey)
  // Separate selectors (matching AgentPicker) avoid a new object each render / useShallow.
  const catalog = useProvidersStore((s) => s.catalog)
  const config = useProvidersStore((s) => s.config)
  const keyConfigured = useProvidersStore((s) => s.keyConfigured)
  const activeId = useActiveSessionId()
  const session = useActiveSession()

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const activeItemRef = useRef<HTMLButtonElement | null>(null)
  const listId = useId()
  const searchId = useId()

  const groups = useMemo(
    () => groupModelOptions(catalog, config, keyConfigured),
    [catalog, config, keyConfigured],
  )
  const totalCount = countModels(groups)
  const showSearch = totalCount >= MODEL_SEARCH_THRESHOLD
  const filtered = useMemo(() => filterModelGroups(groups, query), [groups, query])
  const flatKeys = useMemo(() => flattenModelKeys(filtered), [filtered])

  // Active session: show the session's current model (pinned or global fallback) and allow switching.
  // Draft (no session): show the draft's modelKey (or global fallback).
  const currentKey = activeId && session
    ? (session.config.model ? `${session.config.llmProvider}/${session.config.model}` : activeModelKey(config))
    : (draft?.modelKey ?? activeModelKey(config))
  const label = currentModelLabel(currentKey) || t('chat.noModelSelected')

  // Reset search/highlight when the popover closes; seed highlight to current model on open.
  useEffect(() => {
    if (!open) {
      setQuery('')
      setActiveIndex(0)
      return
    }
    const keys = flattenModelKeys(groups)
    const idx = keys.indexOf(currentKey)
    setActiveIndex(idx >= 0 ? idx : 0)
  }, [open, groups, currentKey])

  // Query changed → jump highlight to first match (not on open — open seeds to current model).
  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  // List shrank (filter) → clamp highlight so Enter never lands out of bounds.
  useEffect(() => {
    setActiveIndex((i) => (flatKeys.length === 0 ? 0 : Math.min(i, flatKeys.length - 1)))
  }, [flatKeys])

  const safeIndex = flatKeys.length === 0 ? 0 : Math.min(activeIndex, flatKeys.length - 1)

  useEffect(() => {
    if (!open || flatKeys.length === 0) return
    activeItemRef.current?.scrollIntoView({ block: 'nearest' })
  }, [safeIndex, open, flatKeys])

  const selectKey = (key: string) => {
    if (activeId && session) {
      sessionService.setSessionModel(key)
    } else {
      setModelKey(key)
    }
    setOpen(false)
  }

  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (flatKeys.length === 0) return
      setActiveIndex((i) => Math.min(Math.min(i, flatKeys.length - 1) + 1, flatKeys.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (flatKeys.length === 0) return
      setActiveIndex((i) => Math.max(Math.min(i, flatKeys.length - 1) - 1, 0))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const key = flatKeys[safeIndex]
      if (key) selectKey(key)
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    }
  }

  const indexByKey = useMemo(() => {
    const map = new Map<string, number>()
    flatKeys.forEach((key, i) => map.set(key, i))
    return map
  }, [flatKeys])

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <ComposerChip title={t('chat.modelHint')} data-testid="model-chip">
          <Cpu size={13} strokeWidth={1.75} className="shrink-0" aria-hidden />
          <span className="max-w-[140px] truncate">{label}</span>
        </ComposerChip>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(280px,calc(100vw-2rem))] p-0"
        data-testid="model-picker-popover"
        onOpenAutoFocus={(e) => {
          if (showSearch) {
            e.preventDefault()
            // Defer so the input is mounted before focusing.
            requestAnimationFrame(() => searchRef.current?.focus())
          }
        }}
        onKeyDown={showSearch ? undefined : onListKeyDown}
      >
        {showSearch && (
          <div className="border-b border-border px-2 py-2">
            <label htmlFor={searchId} className="sr-only">
              {t('chat.searchModels')}
            </label>
            <div className="flex h-8 items-center gap-1.5 rounded-sm border border-border bg-surface px-2">
              <Search size={13} className="shrink-0 text-ink-tertiary" aria-hidden />
              <input
                id={searchId}
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onListKeyDown}
                placeholder={t('chat.searchModels')}
                className="w-full bg-transparent text-meta text-ink placeholder:text-ink-tertiary focus:outline-none"
                data-testid="model-picker-search"
                autoComplete="off"
                spellCheck={false}
                aria-controls={listId}
                aria-activedescendant={
                  flatKeys[safeIndex] ? `${listId}-${flatKeys[safeIndex]}` : undefined
                }
              />
            </div>
          </div>
        )}

        <div
          id={listId}
          role="listbox"
          aria-label={t('chat.modelHint')}
          className="max-h-[min(320px,50vh)] overflow-y-auto overscroll-contain p-1"
          data-testid="model-picker-list"
        >
          {filtered.length === 0 ? (
            <div
              className="px-2.5 py-3 text-center text-meta text-ink-tertiary"
              data-testid="model-picker-empty"
            >
              {groups.length === 0 ? t('chat.noModelsAvailable') : t('chat.noModelsMatch')}
            </div>
          ) : (
            filtered.map((g) => (
              <div
                key={g.providerID}
                role="group"
                aria-label={g.providerName}
                data-testid="model-picker-group"
              >
                <div className="px-2.5 py-1.5 text-caption font-medium text-ink-tertiary">
                  {g.providerName}
                </div>
                {g.models.map((m) => {
                  const index = indexByKey.get(m.key) ?? 0
                  const selected = currentKey === m.key
                  const active = index === safeIndex
                  return (
                    <button
                      key={m.key}
                      id={`${listId}-${m.key}`}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      data-testid="model-picker-item"
                      ref={active ? activeItemRef : undefined}
                      className={cn(
                        'flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-body text-ink outline-none transition-colors duration-chrome',
                        active ? 'bg-state-hover' : 'hover:bg-state-hover',
                      )}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => selectKey(m.key)}
                    >
                      <Check
                        size={14}
                        className={cn('shrink-0', selected ? 'opacity-100' : 'opacity-0')}
                        aria-hidden
                      />
                      <span className="truncate">{m.modelID}</span>
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
