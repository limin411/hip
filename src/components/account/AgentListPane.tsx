import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import type { AgentConfig } from '@hip/protocol'
import type { AgentCategory } from '@/lib/agentCategory'
import type { AgentFilter } from '@/lib/agentFilters'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/DropdownMenu'
import { BuiltinCard, AgentCard } from './AgentCard'

type EmptyKey = 'settings.agents.catInternalEmpty' | 'settings.agents.catCliEmpty' | 'settings.agents.catAcpEmpty'

const SECTIONS = [
  { cat: 'internal' as AgentCategory, titleKey: 'settings.agents.sectionInternal' as const, emptyKey: 'settings.agents.catInternalEmpty' as const, kind: 'internal' as AgentConfig['kind'], addKey: 'settings.agents.addInternal' as const },
  { cat: 'cli' as AgentCategory, titleKey: 'settings.agents.sectionCli' as const, emptyKey: 'settings.agents.catCliEmpty' as const, kind: 'custom' as AgentConfig['kind'], addKey: 'settings.agents.addCli' as const },
  { cat: 'acp' as AgentCategory, titleKey: 'settings.agents.sectionAcp' as const, emptyKey: 'settings.agents.catAcpEmpty' as const, kind: 'acp' as AgentConfig['kind'], addKey: 'settings.agents.addAcp' as const },
]

export function AgentListPane({
  filter,
  byCat,
  onAdd,
  onEdit,
  onToggle,
  onDelete,
}: {
  filter: AgentFilter
  byCat: Record<AgentCategory, AgentConfig[]>
  onAdd: (kind: AgentConfig['kind']) => void
  onEdit: (agent: AgentConfig) => void
  onToggle: (agent: AgentConfig, enabled: boolean) => void
  onDelete: (agent: AgentConfig) => void
}) {
  const { t } = useTranslation()

  const card = (agent: AgentConfig) => (
    <AgentCard
      key={agent.id}
      agent={agent}
      onToggle={(enabled) => onToggle(agent, enabled)}
      onEdit={() => onEdit(agent)}
      onDelete={() => onDelete(agent)}
    />
  )

  const empty = (key: EmptyKey) => (
    <div className="rounded-lg border border-dashed border-border py-5 text-center text-meta text-ink-tertiary">{t(key)}</div>
  )

  if (filter === 'builtin') {
    return (
      <div className="min-w-0 flex-1 space-y-2">
        <BuiltinCard />
        <div className="px-1 text-caption text-ink-tertiary">{t('settings.agents.builtinOnlyNote')}</div>
      </div>
    )
  }

  if (filter === 'internal' || filter === 'cli' || filter === 'acp') {
    const section = SECTIONS.find((s) => s.cat === filter)!
    const list = byCat[filter]
    return (
      <div className="min-w-0 flex-1">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-body font-medium text-ink">{t(section.titleKey)}</div>
          <button
            onClick={() => onAdd(section.kind)}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-meta font-medium text-accent-strong transition-colors hover:bg-accent-subtle"
          >
            <Plus size={14} /> {t(section.addKey)}
          </button>
        </div>
        <div className="space-y-2">{list.length === 0 ? empty(section.emptyKey) : list.map(card)}</div>
      </div>
    )
  }

  // filter === 'all' — overview
  return (
    <div className="min-w-0 flex-1">
      <BuiltinCard />
      {SECTIONS.map((s) => (
        <div key={s.cat} className="mt-6">
          <div className="mb-2 text-caption font-medium uppercase tracking-wide text-ink-tertiary">{t(s.titleKey)}</div>
          <div className="space-y-2">{byCat[s.cat].length === 0 ? empty(s.emptyKey) : byCat[s.cat].map(card)}</div>
        </div>
      ))}
      <div className="mt-6">
        {/* modal={false}: the menu opens a Modal; stacking two pointer-events locks freezes the app. */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-3 text-body font-medium text-accent-strong transition-colors hover:bg-accent-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
              <Plus size={15} /> {t('settings.agents.add')}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => onAdd('internal')}>{t('settings.agents.addInternal')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAdd('custom')}>{t('settings.agents.addCli')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAdd('acp')}>{t('settings.agents.addAcp')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
