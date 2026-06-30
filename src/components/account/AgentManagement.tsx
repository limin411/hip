import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentConfig } from '@hip/protocol'
import { useAgentsStore } from '@/store/agentsStore'
import { AgentToolbar } from './AgentToolbar'
import { AgentGrid } from './AgentGrid'
import { AgentEditor } from './AgentEditor'
import { DeleteAgentDialog } from './DeleteAgentDialog'

type Editing =
  | { mode: 'add'; kind: AgentConfig['kind'] }
  | { mode: 'edit'; agent: AgentConfig }
  | null

export function AgentManagement() {
  const { t } = useTranslation()
  const { agents, loaded, load, addAgent, updateAgent, removeAgent } = useAgentsStore()
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Editing>(null)
  const [deleting, setDeleting] = useState<AgentConfig | null>(null)

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

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
      <div>
        <h2 className="text-title font-semibold text-ink">{t('settings.agentsLabel')}</h2>
      </div>
      <AgentToolbar
        search={search}
        onSearchChange={setSearch}
        onAdd={(kind) => setEditing({ mode: 'add', kind })}
      />

      <div className="mt-5 min-h-0 flex-1 overflow-y-auto">
        <Content
          filteredAgents={filteredAgents}
          totalAgents={agents.length}
          enabledCount={enabledCount}
          isSearchActive={search.trim().length > 0}
          onEdit={(a) => setEditing({ mode: 'edit', agent: a })}
          onToggle={(a, enabled) => void updateAgent(a.id, { enabled })}
          onDelete={(a) => setDeleting(a)}
        />
      </div>

      {editing && (
        <AgentEditor
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
  filteredAgents,
  totalAgents,
  enabledCount,
  isSearchActive,
  onEdit,
  onToggle,
  onDelete,
}: {
  filteredAgents: AgentConfig[]
  totalAgents: number
  enabledCount: number
  isSearchActive: boolean
  onEdit: (agent: AgentConfig) => void
  onToggle: (agent: AgentConfig, enabled: boolean) => void
  onDelete: (agent: AgentConfig) => void
}) {
  const { t } = useTranslation()

  const isEmpty = filteredAgents.length === 0
  let emptyTitle = ''
  let emptyHint: string | undefined
  if (isEmpty) {
    if (isSearchActive) {
      emptyTitle = t('settings.agents.searchEmpty')
    } else {
      emptyTitle = t('settings.agents.gridEmptyTitle')
      emptyHint = t('settings.agents.gridEmptyHint')
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <Stat label={t('settings.agents.overviewTotal')} value={totalAgents} />
        <Stat label={t('settings.agents.overviewEnabled')} value={enabledCount} />
      </div>
      <AgentGrid
        agents={filteredAgents}
        emptyTitle={emptyTitle}
        emptyHint={emptyHint}
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
