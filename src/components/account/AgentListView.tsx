import type { AgentConfig } from '@hip/protocol'
import { EmptyState } from '@/components/ui/EmptyState'
import { AgentCard } from './AgentCard'

export function AgentListView({
  sections,
  onEdit,
  onToggle,
  onDelete,
}: {
  sections: {
    title: string
    agents: AgentConfig[]
    emptyTitle: string
    emptyHint?: string
  }[]
  onEdit: (agent: AgentConfig) => void
  onToggle: (agent: AgentConfig, enabled: boolean) => void
  onDelete: (agent: AgentConfig) => void
}) {
  return (
    <div className="space-y-6">
      {sections.map((section) => (
        <section key={section.title}>
          <h3 className="mb-3 text-body font-medium text-ink">{section.title}</h3>
          {section.agents.length === 0 ? (
            <EmptyState title={section.emptyTitle} description={section.emptyHint} />
          ) : (
            <div className="space-y-2">
              {section.agents.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  viewMode="list"
                  onToggle={(enabled) => onToggle(agent, enabled)}
                  onEdit={() => onEdit(agent)}
                  onDelete={() => onDelete(agent)}
                />
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  )
}
