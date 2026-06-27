import type { AgentRun, TimelineStep, ToolCall } from '@hip/protocol'
import { ActivityBar } from './ActivityBar'

interface ThinkingBubbleProps {
  steps?: TimelineStep[]
  toolCalls?: ToolCall[]
  agentRuns?: AgentRun[]
}

export function ThinkingBubble({ steps, toolCalls, agentRuns }: ThinkingBubbleProps) {
  return (
    <div className="flex gap-3" data-testid="thinking-bubble">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-caption font-semibold text-white">
        AI
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-1 text-meta font-medium text-ink-secondary">hip</div>
        <ActivityBar steps={steps} toolCalls={toolCalls} agentRuns={agentRuns} streaming />
      </div>
    </div>
  )
}
