import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, Plus } from 'lucide-react'
import type { AgentConfig } from '@hip/protocol'
import { useAgentsStore } from '@/store/agentsStore'
import { agentCategory, type AgentCategory } from '@/lib/agentCategory'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/DropdownMenu'
import { BuiltinCard, AgentCard } from './AgentCard'
import { AgentEditor } from './AgentEditor'
import { DeleteAgentDialog } from './DeleteAgentDialog'

type Editing =
  | { mode: 'add'; kind: AgentConfig['kind'] }
  | { mode: 'edit'; agent: AgentConfig }
  | null

const SECTIONS = [
  { cat: 'internal' as AgentCategory, titleKey: 'settings.agents.sectionInternal' as const, emptyKey: 'settings.agents.catInternalEmpty' as const },
  { cat: 'cli' as AgentCategory, titleKey: 'settings.agents.sectionCli' as const, emptyKey: 'settings.agents.catCliEmpty' as const },
  { cat: 'acp' as AgentCategory, titleKey: 'settings.agents.sectionAcp' as const, emptyKey: 'settings.agents.catAcpEmpty' as const },
]

export function AgentManagement() {
  const { t } = useTranslation()
  const { agents, loaded, load, addAgent, updateAgent, removeAgent } = useAgentsStore()
  const [editing, setEditing] = useState<Editing>(null)
  const [deleting, setDeleting] = useState<AgentConfig | null>(null)

  useEffect(() => { if (!loaded) void load() }, [loaded, load])

  const byCat = useMemo(() => {
    const m: Record<AgentCategory, AgentConfig[]> = { acp: [], cli: [], internal: [] }
    for (const a of agents) m[agentCategory(a)].push(a)
    return m
  }, [agents])

  return (
    <div className="p-6">
      <h2 className="text-title font-semibold text-ink">{t('settings.agents.title')}</h2>
      <p className="mt-1 text-body text-ink-secondary">{t('settings.agents.intro')}</p>

      <div className="mt-5 space-y-2">
        <BuiltinCard />
      </div>

      {SECTIONS.map(({ cat, titleKey, emptyKey }) => (
        <div key={cat} className="mt-6">
          <div className="mb-2 text-caption font-medium uppercase tracking-wide text-ink-tertiary">{t(titleKey)}</div>
          <div className="space-y-2">
            {byCat[cat].length === 0 ? (
              <div className="rounded-lg border border-dashed border-border py-5 text-center text-meta text-ink-tertiary">
                {t(emptyKey)}
              </div>
            ) : (
              byCat[cat].map((a) => (
                <AgentCard
                  key={a.id}
                  agent={a}
                  onToggle={(enabled) => void updateAgent(a.id, { enabled })}
                  onEdit={() => setEditing({ mode: 'edit', agent: a })}
                  onDelete={() => setDeleting(a)}
                />
              ))
            )}
          </div>
        </div>
      ))}

      <div className="mt-6">
        {/* modal={false}: the menu's item opens a Modal; stacking two pointer-events locks freezes the app. */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-3 text-body font-medium text-accent-strong transition-colors hover:bg-accent-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
              <Plus size={15} /> {t('settings.agents.add')}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => setEditing({ mode: 'add', kind: 'internal' })}>
              <Bot size={14} /> {t('settings.agents.addInternal')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setEditing({ mode: 'add', kind: 'custom' })}>
              {t('settings.agents.addCli')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setEditing({ mode: 'add', kind: 'acp' })}>
              {t('settings.agents.addAcp')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
          onConfirm={() => { void removeAgent(deleting.id); setDeleting(null) }}
        />
      )}
    </div>
  )
}
