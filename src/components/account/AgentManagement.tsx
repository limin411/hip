import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentConfig } from '@hip/protocol'
import { useAgentsStore } from '@/store/agentsStore'
import { useHipConfigStore } from '@/store/hipConfigStore'
import { FIXED_AGENTS } from '@/lib/fixedAgents'
import { AgentToolbar } from './AgentToolbar'
import { AgentGrid } from './AgentGrid'
import { AgentEditor } from './AgentEditor'
import { DeleteAgentDialog } from './DeleteAgentDialog'
import { FixedAgentCard } from './FixedAgentCard'

type Editing =
  | { mode: 'add'; kind: AgentConfig['kind'] }
  | { mode: 'edit'; agent: AgentConfig }
  | null

export function AgentManagement() {
  const { t } = useTranslation()
  const { agents, loaded, load, addAgent, updateAgent, removeAgent } = useAgentsStore()
  const fixedAgentsEnabled = useHipConfigStore((s) => s.config.fixedAgents)
  const updateSection = useHipConfigStore((s) => s.updateSection)
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

  const fixedEnabledCount = FIXED_AGENTS.filter(
    (a) => fixedAgentsEnabled?.[a.id] !== false,
  ).length
  const userEnabledCount = useMemo(
    () => agents.filter((a) => a.enabled).length,
    [agents],
  )
  const totalAgents = FIXED_AGENTS.length + agents.length
  const enabledCount = fixedEnabledCount + userEnabledCount

  const handleFixedToggle = async (id: string, enabled: boolean) => {
    const next = { ...(fixedAgentsEnabled ?? {}), [id]: enabled }
    await updateSection('fixedAgents', next)
  }

  return (
    <div className="flex h-full flex-col p-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between shrink-0">
        <div className="min-w-0">
          <h2 className="text-title font-semibold text-ink">{t('settings.agents.title')}</h2>
          <p className="mt-1 text-body text-ink-secondary">{t('settings.agents.intro')}</p>
        </div>
        <AgentToolbar
          search={search}
          onSearchChange={setSearch}
          onAdd={(kind) => setEditing({ mode: 'add', kind })}
        />
      </div>

      <div className="mt-5 min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-5">
          {/* Stats — includes fixed agents */}
          <div className="grid grid-cols-2 gap-3">
            <Stat label={t('settings.agents.overviewTotal')} value={totalAgents} />
            <Stat label={t('settings.agents.overviewEnabled')} value={enabledCount} />
          </div>

          {/* Fixed agents section */}
          <div className="space-y-3">
            {FIXED_AGENTS.map((agent) => (
              <FixedAgentCard
                key={agent.id}
                agent={agent}
                enabled={fixedAgentsEnabled?.[agent.id] !== false}
                onToggle={(enabled) => handleFixedToggle(agent.id, enabled)}
              />
            ))}
          </div>

          {/* User agents section */}
          <AgentGrid
            agents={filteredAgents}
            emptyTitle={
              filteredAgents.length === 0
                ? search.trim().length > 0
                  ? t('settings.agents.searchEmpty')
                  : t('settings.agents.gridEmptyTitle')
                : ''
            }
            emptyHint={
              filteredAgents.length === 0 && !search.trim()
                ? t('settings.agents.gridEmptyHint')
                : undefined
            }
            onEdit={(a) => setEditing({ mode: 'edit', agent: a })}
            onToggle={(a, enabled) => void updateAgent(a.id, { enabled })}
            onDelete={(a) => setDeleting(a)}
          />
        </div>
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

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="text-caption text-ink-tertiary">{label}</div>
      <div className="mt-1 text-stat font-semibold text-ink">{value}</div>
    </div>
  )
}
