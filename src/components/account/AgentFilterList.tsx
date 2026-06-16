import { useTranslation } from 'react-i18next'
import { LayoutGrid, Sparkles, Bot, Terminal, Plug, type LucideIcon } from 'lucide-react'
import { AGENT_FILTERS, type AgentFilter, type AgentFilterIcon } from '@/lib/agentFilters'
import { cn } from '@/lib/utils'

const ICONS: Record<AgentFilterIcon, LucideIcon> = {
  'layout-grid': LayoutGrid,
  sparkles: Sparkles,
  bot: Bot,
  terminal: Terminal,
  plug: Plug,
}

/** Left master pane: a fixed type-filter rail (no search — only five entries). */
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
      case 'cli': return t('settings.agents.filterCli')
      case 'acp': return t('settings.agents.filterAcp')
    }
  }
  return (
    <div className="w-[184px] shrink-0 self-start overflow-hidden rounded-lg border border-border p-1.5">
      {AGENT_FILTERS.map((entry) => {
        const Icon = ICONS[entry.icon]
        const isActive = entry.id === active
        return (
          <button
            key={entry.id}
            onClick={() => onSelect(entry.id)}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-body transition-colors',
              isActive ? 'bg-accent-active font-medium text-accent-strong' : 'text-ink-secondary hover:bg-surface-muted',
            )}
          >
            <Icon size={16} className="shrink-0" />
            <span className="flex-1 truncate">{label(entry.id)}</span>
            <span className={cn('text-caption', isActive ? 'text-accent-strong' : 'text-ink-tertiary')}>{counts[entry.id]}</span>
          </button>
        )
      })}
    </div>
  )
}
