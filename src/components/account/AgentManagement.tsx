import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentConfig } from '@hip/protocol'
import { useAgentsStore } from '@/store/agentsStore'
import { agentCategory } from '@/lib/agentCategory'
import { agentFilterCounts, type AgentFilter } from '@/lib/agentFilters'
import { AgentFilterList } from './AgentFilterList'
import { AgentToolbar } from './AgentToolbar'
import { AgentGrid } from './AgentGrid'
import { AgentListView } from './AgentListView'
import { AgentEditor } from './AgentEditor'
import { DeleteAgentDialog } from './DeleteAgentDialog'

type Editing =
  | { mode: 'add'; kind: AgentConfig['kind'] }
  | { mode: 'edit'; agent: AgentConfig }
  | null

export function AgentManagement() {
  const { agents, loaded, load, addAgent, updateAgent, removeAgent } = useAgentsStore()
  const [filter, setFilter] = useState<AgentFilter>('all')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Editing>(null)
  const [deleting, setDeleting] = useState<AgentConfig | null>(null)

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  const counts = useMemo(() => agentFilterCounts(agents), [agents])

  const filteredAgents = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return agents
    return agents.filter(
      (a) =>
        a.name.toLowerCase().includes(s) ||
        (a.description ?? '').toLowerCase().includes(s) ||
        a.command.toLowerCase().includes(s),
    )
  }, [agents, search])

  const enabledCount = useMemo(() => agents.filter((a) => a.enabled).length, [agents])

  return (
    <div className="flex h-full flex-col p-6">
      <AgentToolbar
        search={search}
        onSearchChange={setSearch}
        onAdd={(kind) => setEditing({ mode: 'add', kind })}
      />

      <div className="mt-5 flex min-h-0 flex-1 gap-3.5">
        <AgentFilterList active={filter} counts={counts} onSelect={setFilter} />
        <div className="min-w-0 flex-1 overflow-y-auto">
          <Content
            filter={filter}
            search={search}
            filteredAgents={filteredAgents}
            enabledCount={enabledCount}
            counts={counts}
            onEdit={(a) => setEditing({ mode: 'edit', agent: a })}
            onToggle={(a, enabled) => void updateAgent(a.id, { enabled })}
            onDelete={(a) => setDeleting(a)}
          />
        </div>
      </div>

      {editing && (
        <AgentEditor
          variant={editing.mode === 'add' ? 'modal' : 'drawer'}
          initial={editing.mode === 'edit' ? editing.agent : null}
          initialKind={editing.mode === 'add' ? editing.kind : undefined}
          onCancel={() => setEditing(null)}
          onSave={async (draft) => {
            if (editing.mode === 'edit') await updateAgent(editing.agent.id, draft)
            else await addAgent(draft)
            setEditing(null)
          }}
        />
      )}

      {deleting && (
        <DeleteAgentDialog
          agent={deleting}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            void removeAgent(deleting.id)
            setDeleting(null)
          }}
        />
      )}
    </div>
  )
}

function Content({
  filter,
  search,
  filteredAgents,
  enabledCount,
  counts,
  onEdit,
  onToggle,
  onDelete,
}: {
  filter: AgentFilter
  search: string
  filteredAgents: AgentConfig[]
  enabledCount: number
  counts: Record<AgentFilter, number>
  onEdit: (agent: AgentConfig) => void
  onToggle: (agent: AgentConfig, enabled: boolean) => void
  onDelete: (agent: AgentConfig) => void
}) {
  const { t } = useTranslation()

  if (filter === 'internal' || filter === 'acp') {
    const list = filteredAgents.filter((a) => agentCategory(a) === filter)
    return (
      <AgentListView
        sections={[
          {
            title: filter === 'internal' ? t('settings.agents.sectionInternal') : t('settings.agents.sectionAcp'),
            agents: list,
            emptyTitle: filter === 'internal' ? t('settings.agents.catInternalEmpty') : t('settings.agents.catAcpEmpty'),
            emptyHint: search ? t('settings.agents.searchEmpty') : undefined,
          },
        ]}
        onEdit={onEdit}
        onToggle={onToggle}
        onDelete={onDelete}
      />
    )
  }

  // filter === 'all'
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat label={t('settings.agents.overviewTotal')} value={counts.all} />
        <Stat label={t('settings.agents.overviewEnabled')} value={enabledCount} />
      </div>
      <AgentGrid
        agents={filteredAgents}
        emptyTitle={search ? t('settings.agents.searchEmpty') : t('settings.agents.gridEmptyTitle')}
        emptyHint={search ? undefined : t('settings.agents.gridEmptyHint')}
        onEdit={onEdit}
        onToggle={onToggle}
        onDelete={onDelete}
      />
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="text-caption text-ink-tertiary">{label}</div>
      <div className="mt-1 text-stat font-semibold text-ink">{value}</div>
    </div>
  )
}
