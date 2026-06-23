import { useTranslation } from 'react-i18next'
import { LayoutGrid, Sparkles, Bot, Plug, type LucideIcon } from 'lucide-react'
import { AGENT_FILTERS, type AgentFilter, type AgentFilterIcon } from '@/lib/agentFilters'
import { cn } from '@/lib/utils'

const ICONS: Partial<Record<AgentFilterIcon, LucideIcon>> = {
  'layout-grid': LayoutGrid,
  sparkles: Sparkles,
  bot: Bot,
  plug: Plug,
}

/** Left icon-only filter rail. */
export function AgentFilterList({
  active,
  counts,
  onSelect,
}: {
  active: AgentFilter
  counts: Record<AgentFilter, number>
  onSelect: (filter: AgentFilter) => void
}) {
  const { t } = useTranslation()
  const label = (id: AgentFilter) => {
    switch (id) {
      case 'all': return t('settings.agents.filterAll')
      case 'builtin': return t('settings.agents.filterBuiltin')
      case 'internal': return t('settings.agents.filterInternal')
      case 'acp': return t('settings.agents.filterAcp')
    }
  }
  return (
    <div className="w-16 shrink-0 self-start overflow-hidden rounded-lg border border-border p-1.5">
      {AGENT_FILTERS.map((entry) => {
        const Icon = ICONS[entry.icon]
        const isActive = entry.id === active
        const count = counts[entry.id]
        return (
          <button
            key={entry.id}
            type="button"
            onClick={() => onSelect(entry.id)}
            title={label(entry.id)}
            className={cn(
              'relative flex w-full flex-col items-center rounded-md px-1 py-2 text-center transition-colors',
              isActive ? 'bg-accent-active font-medium text-accent-strong' : 'text-ink-secondary hover:bg-surface-muted',
            )}
          >
            {Icon && <Icon size={18} className="shrink-0" />}
            <span className="mt-1 w-full truncate px-0.5 text-[10px] leading-tight">{label(entry.id)}</span>
            <span
              className={cn(
                'absolute right-0.5 top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full border px-1 text-[10px] font-medium',
                isActive
                  ? 'border-accent-strong/30 bg-white text-accent-strong'
                  : 'border-border bg-surface text-ink-tertiary',
              )}
            >
              {count}
            </span>
          </button>
        )
      })}
    </div>
  )
}
