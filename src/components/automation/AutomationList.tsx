import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'
import type { Automation } from '@/domain/automations'
import { Input } from '@/components/ui/Input'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { EmptyState } from '@/components/ui/EmptyState'
import { AutomationRow } from './AutomationRow'

export type AutomationFilter = 'all' | 'enabled' | 'disabled'

export type AutomationListProps = {
  automations: Automation[]
  onToggle: (id: string, enabled: boolean) => void
  onRun: (id: string) => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
  runningIds?: Set<string>
}

export function AutomationList({
  automations,
  onToggle,
  onRun,
  onEdit,
  onDelete,
  runningIds,
}: AutomationListProps) {
  const { t } = useTranslation()
  const [filter, setFilter] = useState<AutomationFilter>('all')
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return automations.filter((a) => {
      if (filter === 'enabled' && !a.enabled) return false
      if (filter === 'disabled' && a.enabled) return false
      if (!q) return true
      return (
        a.name.toLowerCase().includes(q) ||
        a.prompt.toLowerCase().includes(q) ||
        (a.projectPath?.toLowerCase().includes(q) ?? false)
      )
    })
  }, [automations, filter, search])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3" data-testid="automation-list">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-tertiary"
            strokeWidth={1.75}
            aria-hidden
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('automation.list.searchPlaceholder')}
            className="h-8 pl-8"
            data-testid="automation-list-search"
            aria-label={t('automation.list.searchPlaceholder')}
          />
        </div>
        <SegmentedControl
          data-testid="automation-list-filter"
          aria-label={t('automation.list.filterAria')}
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: t('automation.list.filterAll') },
            { value: 'enabled', label: t('automation.list.filterEnabled') },
            { value: 'disabled', label: t('automation.list.filterDisabled') },
          ]}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          tier="professional"
          title={
            search.trim()
              ? t('automation.list.emptySearch')
              : t('automation.list.emptyFilter')
          }
          description={
            search.trim()
              ? t('automation.list.emptySearchHint')
              : t('automation.list.emptyFilterHint')
          }
          className="flex-1"
          data-testid="automation-list-empty"
        />
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pb-4">
          {filtered.map((a) => (
            <li key={a.id}>
              <AutomationRow
                automation={a}
                onToggle={(en) => onToggle(a.id, en)}
                onRun={() => onRun(a.id)}
                onEdit={() => onEdit(a.id)}
                onDelete={() => onDelete(a.id)}
                running={runningIds?.has(a.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
