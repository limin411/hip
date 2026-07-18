import type { AgentRun, TimelineStep, ToolCall } from '@hip/protocol'
import { ActivityBar } from './ActivityBar'

interface ThinkingBubbleProps {
  steps?: TimelineStep[]
  toolCalls?: ToolCall[]
  agentRuns?: AgentRun[]
}

export function ThinkingBubble({ steps, toolCalls, agentRuns }: ThinkingBubbleProps) {
  return (
    <div className="min-w-0 w-full" data-testid="thinking-bubble">
      <div className="mb-1 flex min-h-5 items-center text-meta font-medium leading-5 text-ink-secondary">hip</div>
      <ActivityBar steps={steps} toolCalls={toolCalls} agentRuns={agentRuns} streaming />
    </div>
  )
}
