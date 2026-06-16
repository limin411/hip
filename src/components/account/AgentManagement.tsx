import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentConfig } from '@hip/protocol'
import { useAgentsStore } from '@/store/agentsStore'
import { agentCategory, type AgentCategory } from '@/lib/agentCategory'
import { agentFilterCounts, type AgentFilter } from '@/lib/agentFilters'
import { AgentFilterList } from './AgentFilterList'
import { AgentListPane } from './AgentListPane'
import { AgentEditor } from './AgentEditor'
import { DeleteAgentDialog } from './DeleteAgentDialog'

type Editing =
  | { mode: 'add'; kind: AgentConfig['kind'] }
  | { mode: 'edit'; agent: AgentConfig }
  | null

export function AgentManagement() {
  const { t } = useTranslation()
  const { agents, loaded, load, addAgent, updateAgent, removeAgent } = useAgentsStore()
  const [filter, setFilter] = useState<AgentFilter>('all')
  const [editing, setEditing] = useState<Editing>(null)
  const [deleting, setDeleting] = useState<AgentConfig | null>(null)

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  const byCat = useMemo(() => {
    const m: Record<AgentCategory, AgentConfig[]> = { acp: [], cli: [], internal: [] }
    for (const a of agents) m[agentCategory(a)].push(a)
    return m
  }, [agents])
  const counts = useMemo(() => agentFilterCounts(agents), [agents])

  return (
    <div className="p-6">
      <h2 className="text-title font-semibold text-ink">{t('settings.agents.title')}</h2>
      <p className="mt-1 text-body text-ink-secondary">{t('settings.agents.intro')}</p>

      <div className="mt-5 flex gap-3.5">
        <AgentFilterList active={filter} counts={counts} onSelect={setFilter} />
        <AgentListPane
          filter={filter}
          byCat={byCat}
          onAdd={(kind) => setEditing({ mode: 'add', kind })}
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
