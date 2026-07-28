import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, LayoutTemplate, Plus, Search } from 'lucide-react'
import type { Automation } from '@/domain/automations'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { EmptyState } from '@/components/ui/EmptyState'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu'
import { Modal } from '@/components/ui/Modal'
import { AutomationRow } from './AutomationRow'
import { AutomationTemplateGrid } from './AutomationTemplateGrid'
import type { AutomationTemplate } from './templates'
import { isInFlight } from '@/store/automationStore'

export type AutomationFilter = 'all' | 'enabled' | 'disabled'
export type AutomationSort = 'nextRun' | 'recent' | 'name' | 'failedFirst'

export type AutomationListProps = {
  automations: Automation[]
  onToggle: (id: string, enabled: boolean) => void
  onRun: (id: string, opts?: { focus?: boolean }) => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
  onOpenLastSession?: (id: string) => void
  onCreate?: () => void
  onCreateFromTemplate?: (template: AutomationTemplate) => void
  onSelect?: (id: string) => void
  selectedId?: string | null
  runningIds?: Set<string>
  /** Tray/quit config makes scheduled fires unreliable (per-row warning). */
  scheduleUnreliable?: boolean
}

function sortAutomations(
  list: Automation[],
  sort: AutomationSort,
  runningIds?: Set<string>,
): Automation[] {
  const copy = list.slice()
  copy.sort((a, b) => {
    const aRun = runningIds?.has(a.id) || isInFlight(a.id) ? 0 : 1
    const bRun = runningIds?.has(b.id) || isInFlight(b.id) ? 0 : 1
    if (aRun !== bRun) return aRun - bRun

    if (sort === 'name') {
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    }
    if (sort === 'recent') {
      const aT = a.lastRunAt ?? a.updatedAt ?? 0
      const bT = b.lastRunAt ?? b.updatedAt ?? 0
      if (bT !== aT) return bT - aT
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    }
    if (sort === 'failedFirst') {
      const aFail = a.lastStatus === 'failed' || a.lastStatus === 'skipped' ? 0 : 1
      const bFail = b.lastStatus === 'failed' || b.lastStatus === 'skipped' ? 0 : 1
      if (aFail !== bFail) return aFail - bFail
      const aT = a.lastRunAt ?? 0
      const bT = b.lastRunAt ?? 0
      if (bT !== aT) return bT - aT
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    }
    // nextRun (default): sooner next first; manuals at end
    const aNext = a.nextRunAt ?? Number.POSITIVE_INFINITY
    const bNext = b.nextRunAt ?? Number.POSITIVE_INFINITY
    if (aNext !== bNext) return aNext - bNext
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
  return copy
}

export function AutomationList({
  automations,
  onToggle,
  onRun,
  onEdit,
  onDelete,
  onOpenLastSession,
  onCreate,
  onCreateFromTemplate,
  onSelect,
  selectedId,
  runningIds,
  scheduleUnreliable = false,
}: AutomationListProps) {
  const { t } = useTranslation()
  const [filter, setFilter] = useState<AutomationFilter>('all')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<AutomationSort>('nextRun')
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const base = automations.filter((a) => {
      if (filter === 'enabled' && !a.enabled) return false
      if (filter === 'disabled' && a.enabled) return false
      if (!q) return true
      return (
        a.name.toLowerCase().includes(q) ||
        a.prompt.toLowerCase().includes(q) ||
        (a.projectPath?.toLowerCase().includes(q) ?? false)
      )
    })
    return sortAutomations(base, sort, runningIds)
  }, [automations, filter, search, sort, runningIds])

  const hasSearch = search.trim().length > 0
  const hasFilter = filter !== 'all'

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface"
      data-testid="automation-list"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-subtle px-3 py-2">
        <span
          className="shrink-0 text-meta text-ink-tertiary"
          data-testid="automation-list-count"
        >
          {t('automation.list.count', {
            shown: filtered.length,
            total: automations.length,
          })}
        </span>

        <div className="relative min-w-[10rem] flex-1">
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

        <label className="flex items-center gap-1.5 text-meta text-ink-tertiary">
          <span className="sr-only">{t('automation.list.sortAria')}</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as AutomationSort)}
            data-testid="automation-list-sort"
            aria-label={t('automation.list.sortAria')}
            className="h-8 rounded-md border border-border bg-surface px-2 text-meta text-ink"
          >
            <option value="nextRun">{t('automation.list.sortNextRun')}</option>
            <option value="recent">{t('automation.list.sortRecent')}</option>
            <option value="name">{t('automation.list.sortName')}</option>
            <option value="failedFirst">{t('automation.list.sortFailedFirst')}</option>
          </select>
        </label>

        {onCreate ? (
          onCreateFromTemplate ? (
            /* modal={false}: menu item opens Modal; two body pointer-events locks
               stack and leave the app unclickable after the dialog closes. */
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  data-testid="automation-new"
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                  {t('automation.startCta')}
                  <ChevronDown className="h-3 w-3 opacity-70" strokeWidth={2} aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" data-testid="automation-new-menu">
                <DropdownMenuItem
                  data-testid="automation-new-blank"
                  onSelect={() => onCreate()}
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
                  {t('automation.list.newBlank')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  data-testid="automation-new-template"
                  onSelect={() => setTemplatePickerOpen(true)}
                >
                  <LayoutTemplate className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
                  {t('automation.list.newFromTemplate')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button
              type="button"
              size="sm"
              data-testid="automation-new"
              onClick={onCreate}
            >
              {t('automation.startCta')}
            </Button>
          )
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-4">
          <EmptyState
            tier="professional"
            title={
              hasSearch
                ? t('automation.list.emptySearch')
                : t('automation.list.emptyFilter')
            }
            description={
              hasSearch
                ? t('automation.list.emptySearchHint')
                : t('automation.list.emptyFilterHint')
            }
            className="py-8"
            data-testid="automation-list-empty"
          />
          <div className="flex flex-wrap items-center justify-center gap-2">
            {hasSearch ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                data-testid="automation-list-clear-search"
                onClick={() => setSearch('')}
              >
                {t('automation.list.clearSearch')}
              </Button>
            ) : null}
            {hasFilter ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                data-testid="automation-list-clear-filter"
                onClick={() => setFilter('all')}
              >
                {t('automation.list.showAll')}
              </Button>
            ) : null}
            {onCreate ? (
              <Button
                type="button"
                size="sm"
                data-testid="automation-list-empty-create"
                onClick={onCreate}
              >
                {t('automation.startCta')}
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <ul className="m-0 min-h-0 flex-1 list-none overflow-y-auto p-0">
          {filtered.map((a) => (
            <li key={a.id}>
              <AutomationRow
                automation={a}
                onToggle={(en) => onToggle(a.id, en)}
                onRun={(opts) => onRun(a.id, opts)}
                onEdit={() => onEdit(a.id)}
                onDelete={() => onDelete(a.id)}
                onOpenLastSession={
                  onOpenLastSession && a.lastSessionId
                    ? () => onOpenLastSession(a.id)
                    : undefined
                }
                onSelect={onSelect ? () => onSelect(a.id) : undefined}
                selected={selectedId === a.id}
                running={runningIds?.has(a.id)}
                scheduleUnreliable={scheduleUnreliable}
              />
            </li>
          ))}
        </ul>
      )}

      {onCreateFromTemplate ? (
        <Modal
          open={templatePickerOpen}
          onOpenChange={setTemplatePickerOpen}
          title={t('automation.list.newFromTemplate')}
        >
          <div className="max-h-[min(28rem,60vh)] overflow-y-auto px-4 py-3">
            <p className="mb-3 text-meta text-ink-tertiary">
              {t('automation.templatesHint')}
            </p>
            <AutomationTemplateGrid
              onSelect={(template) => {
                setTemplatePickerOpen(false)
                onCreateFromTemplate(template)
              }}
            />
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
