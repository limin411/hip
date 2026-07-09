import { Bot } from 'lucide-react'
import type { AgentConfig } from '@hip/protocol'
import { EmptyState } from '@/components/ui/EmptyState'
import { AgentCard } from './AgentCard'

export function AgentGrid({
  agents,
  emptyTitle,
  emptyHint,
  installed,
  detectionChecked,
  onEdit,
  onToggle,
  onDelete,
}: {
  agents: AgentConfig[]
  emptyTitle: string
  emptyHint?: string
  installed?: Record<string, boolean>
  detectionChecked?: boolean
  onEdit: (agent: AgentConfig) => void
  onToggle: (agent: AgentConfig, enabled: boolean) => void
  onDelete: (agent: AgentConfig) => void
}) {
  return (
    <div>
      {agents.length === 0 ? (
        <EmptyState icon={Bot} title={emptyTitle} description={emptyHint} />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              viewMode="grid"
              installed={installed}
              detectionChecked={detectionChecked}
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
