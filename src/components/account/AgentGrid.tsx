import type { AgentConfig } from '@hip/protocol'
import { AgentCard } from './AgentCard'

export function AgentGrid({
  agents,
  emptyTitle,
  emptyHint,
  onEdit,
  onToggle,
  onDelete,
}: {
  agents: AgentConfig[]
  emptyTitle: string
  emptyHint?: string
  onEdit: (agent: AgentConfig) => void
  onToggle: (agent: AgentConfig, enabled: boolean) => void
  onDelete: (agent: AgentConfig) => void
}) {
  return (
    <div>
      {agents.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12 text-center">
          <div className="text-body font-medium text-ink">{emptyTitle}</div>
          {emptyHint && <div className="mt-1 max-w-xs text-meta text-ink-secondary">{emptyHint}</div>}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              viewMode="grid"
              onToggle={(enabled) => onToggle(agent, enabled)}
              onEdit={() => onEdit(agent)}
              onDelete={() => onDelete(agent)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
