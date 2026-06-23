import { useTranslation } from 'react-i18next'
import { Search, Plus, Ban, ChevronRight, X } from 'lucide-react'
import { isCompatible, type CatalogProvider } from '@/ipc/catalog'
import type { ProviderGroups } from '@/lib/providerGroups'
import { cn } from '@/lib/utils'

/** Left master pane: searchable, grouped provider list + add-custom footer. */
export function ProviderList({
  groups,
  activeId,
  keyConfigured,
  filter,
  onFilter,
  showIncompatible,
  onToggleIncompatible,
  onSelect,
  onAddCustom,
}: {
  groups: ProviderGroups
  activeId: string | null
  keyConfigured: Record<string, boolean>
  filter: string
  onFilter: (value: string) => void
  showIncompatible: boolean
  onToggleIncompatible: () => void
  onSelect: (id: string) => void
  onAddCustom: () => void
}) {
  const { t } = useTranslation()
  const hasMatches =
    groups.configured.length + groups.available.length + groups.incompatible.length > 0
  // A filter search should reach incompatible matches too, even while the group is collapsed.
  const incompatibleOpen = showIncompatible || filter.trim() !== ''

  const renderRow = (p: CatalogProvider) => {
    const compat = isCompatible(p)
    const isActive = p.id === activeId
    return (
      <button
        key={p.id}
        disabled={!compat}
        onClick={() => onSelect(p.id)}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-body transition-colors',
          compat ? 'hover:bg-surface-muted' : 'cursor-not-allowed opacity-55',
          isActive && 'bg-accent-active',
        )}
      >
        <span
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-caption',
            isActive ? 'bg-accent-subtle text-accent-strong' : 'bg-surface-muted text-ink-secondary',
          )}
        >
          {p.name.charAt(0).toUpperCase()}
        </span>
        <span className={cn('truncate', isActive ? 'font-medium text-accent-strong' : 'text-ink-secondary')}>
          {p.name}
        </span>
        {!compat ? (
          <Ban size={13} className="ml-auto shrink-0 text-ink-tertiary" />
        ) : keyConfigured[p.id] ? (
          <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
        ) : (
          <span className="ml-auto shrink-0 text-caption text-ink-tertiary">
            {t('settings.modelConfig.notConfigured')}
          </span>
        )}
      </button>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex items-center gap-1.5 border-b border-border px-2.5 py-2">
        <Search size={14} className="shrink-0 text-ink-tertiary" />
        <input
          value={filter}
          onChange={(e) => onFilter(e.target.value)}
          placeholder={t('settings.modelConfig.searchProviders')}
          className="min-w-0 flex-1 bg-transparent text-body text-ink placeholder:text-ink-tertiary focus:outline-none"
        />
        {filter && (
          <button
            onClick={() => onFilter('')}
            className="rounded p-0.5 text-ink-tertiary hover:bg-surface-muted hover:text-ink-secondary"
            aria-label={t('settings.modelConfig.clear')}
          >
            <X size={13} />
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {groups.configured.length > 0 && (
          <>
            <div className="px-2.5 pb-0.5 pt-2 text-caption text-ink-tertiary">
              {t('settings.modelConfig.configured')} · {groups.configured.length}
            </div>
            {groups.configured.map(renderRow)}
          </>
        )}
        {groups.available.length > 0 && (
          <>
            <div className="px-2.5 pb-0.5 pt-2 text-caption text-ink-tertiary">
              {t('settings.modelConfig.available')} · {groups.available.length}
            </div>
            {groups.available.map(renderRow)}
          </>
        )}
        {groups.incompatible.length > 0 && (
          <>
            <button
              onClick={onToggleIncompatible}
              className="flex w-full items-center gap-1 px-2.5 pb-0.5 pt-2 text-left text-caption text-ink-tertiary transition-colors hover:text-ink-secondary"
            >
              <ChevronRight size={11} className={cn('shrink-0 transition-transform', incompatibleOpen && 'rotate-90')} />
              {t('settings.modelConfig.incompatibleGroup')} · {groups.incompatible.length}
            </button>
            {incompatibleOpen && groups.incompatible.map(renderRow)}
          </>
        )}
        {!hasMatches && (
          <div className="px-2.5 py-3 text-center text-meta text-ink-tertiary">
            {t('settings.modelConfig.noMatches')}
          </div>
        )}
      </div>
      <button
        onClick={onAddCustom}
        className="flex w-full items-center gap-1.5 border-t border-border bg-surface px-2.5 py-2.5 text-body text-accent-strong transition-colors hover:bg-surface-muted"
      >
        <Plus size={14} /> {t('settings.modelConfig.addCustom')}
      </button>
    </div>
  )
}
