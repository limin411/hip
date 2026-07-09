import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { AgentConfig } from '@hip/protocol'
import { useAgentsStore } from '@/store/agentsStore'
import { useHipConfigStore } from '@/store/hipConfigStore'
import { useDetectionStore } from '@/store/detectionStore'
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
  const installed = useDetectionStore((s) => s.installed)
  const detectionChecked = useDetectionStore((s) => s.checked)
  const refreshDetection = useDetectionStore((s) => s.refresh)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Editing>(null)
  const [deleting, setDeleting] = useState<AgentConfig | null>(null)

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  useEffect(() => {
    void refreshDetection()
  }, [refreshDetection])

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
    const prev = fixedAgentsEnabled // snapshot BEFORE optimistic update
    try {
      await updateSection('fixedAgents', next)
    } catch (err) {
      console.error('Failed to toggle fixed agent:', err)
      // Revert Zustand state (updateSection already did optimistic set; we must undo it)
      useHipConfigStore.setState((state) => ({
        config: { ...state.config, fixedAgents: prev },
        error: null,
      }))
      toast.error(t('settings.agents.toggleFailed'))
    }
  }

  const emptyTitle = (() => {
    if (filteredAgents.length > 0) return ''
    if (search.trim().length > 0) return t('settings.agents.searchEmpty')
    return t('settings.agents.gridEmptyTitle')
  })()

  return (
    <div className="flex h-full flex-col p-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between shrink-0">
        <div className="min-w-0">
          <h2 className="text-title font-semibold text-ink">{t('settings.agents.title')}</h2>
          <p className="mt-1 text-body text-ink-secondary">
            {t('settings.agents.intro')}
            <span className="mx-1.5 text-ink-tertiary/30">·</span>
            <span className="text-ink-tertiary">{t('settings.agents.overviewTotal')}: {totalAgents}</span>
            <span className="mx-1.5 text-ink-tertiary/30">·</span>
            <span className="text-ink-tertiary">{t('settings.agents.overviewEnabled')}: {enabledCount}</span>
          </p>
        </div>
        <AgentToolbar
          search={search}
          onSearchChange={setSearch}
          onAdd={(kind) => setEditing({ mode: 'add', kind })}
        />
      </div>

      <div className="mt-6 min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-6">
          {/* Fixed agents section */}
          <section className="rounded-lg border border-border bg-surface p-4">
            <div className="mb-3 flex items-center gap-2">
              <h3 className="text-caption font-semibold uppercase tracking-wider text-ink-tertiary">
                {t('settings.agents.sectionBuiltin')}
              </h3>
              <span className="rounded-full bg-surface-muted px-2 py-0.5 text-caption text-ink-tertiary">
                {FIXED_AGENTS.length}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {FIXED_AGENTS.map((agent) => (
                <FixedAgentCard
                  key={agent.id}
                  agent={agent}
                  enabled={fixedAgentsEnabled?.[agent.id] !== false}
                  onToggle={(enabled) => handleFixedToggle(agent.id, enabled)}
                />
              ))}
            </div>
          </section>

          {/* User agents section */}
          <section className="rounded-lg border border-border bg-surface p-4">
            <div className="mb-3 flex items-center gap-2">
              <h3 className="text-caption font-semibold uppercase tracking-wider text-ink-tertiary">
                {t('settings.agents.customSection')}
              </h3>
              <span className="rounded-full bg-surface-muted px-2 py-0.5 text-caption text-ink-tertiary">
                {filteredAgents.length}
              </span>
            </div>
            <AgentGrid
              agents={filteredAgents}
              emptyTitle={emptyTitle}
              emptyHint={
                filteredAgents.length === 0 && !search.trim()
                  ? t('settings.agents.gridEmptyHint')
                  : undefined
              }
              installed={installed}
              detectionChecked={detectionChecked}
              onEdit={(a) => setEditing({ mode: 'edit', agent: a })}
              onToggle={(a, enabled) => void updateAgent(a.id, { enabled })}
              onDelete={(a) => setDeleting(a)}
            />
          </section>
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

