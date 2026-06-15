import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, Plus } from 'lucide-react'
import type { AgentConfig } from '@hip/protocol'
import { useAgentsStore } from '@/store/agentsStore'
import { BuiltinCard, AgentCard } from './AgentCard'
import { AgentEditor } from './AgentEditor'
import { DeleteAgentDialog } from './DeleteAgentDialog'

type Editing = { mode: 'add' } | { mode: 'edit'; agent: AgentConfig } | null

export function AgentManagement() {
  const { t } = useTranslation()
  const { agents, loaded, load, addAgent, updateAgent, removeAgent } = useAgentsStore()
  const [editing, setEditing] = useState<Editing>(null)
  const [deleting, setDeleting] = useState<AgentConfig | null>(null)

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  return (
    <div className="p-6">
      <h2 className="text-title font-semibold text-ink">{t('settings.agents.title')}</h2>
      <p className="mt-1 text-body text-ink-secondary">{t('settings.agents.intro')}</p>

      <div className="mt-5 space-y-2">
        <BuiltinCard />

        {agents.map((a) => (
          <AgentCard
            key={a.id}
            agent={a}
            onToggle={(enabled) => void updateAgent(a.id, { enabled })}
            onEdit={() => setEditing({ mode: 'edit', agent: a })}
            onDelete={() => setDeleting(a)}
          />
        ))}

        {agents.length === 0 && (
          <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-border py-8 text-center">
            <Bot size={22} className="text-ink-tertiary" />
            <div className="text-body text-ink-secondary">{t('settings.agents.empty')}</div>
            <div className="text-meta text-ink-tertiary">{t('settings.agents.emptyHint')}</div>
          </div>
        )}

        <button
          onClick={() => setEditing({ mode: 'add' })}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-3 text-body font-medium text-accent-strong transition-colors hover:bg-accent-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <Plus size={15} /> {t('settings.agents.add')}
        </button>
      </div>

      {editing && (
        <AgentEditor
          initial={editing.mode === 'edit' ? editing.agent : null}
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
