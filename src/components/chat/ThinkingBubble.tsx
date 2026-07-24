import { useRef } from 'react'
import type { AgentRun, TimelineStep, ToolCall } from '@hip/protocol'
import { TurnStatusLine } from './TurnStatusLine'

interface ThinkingBubbleProps {
  steps?: TimelineStep[]
  toolCalls?: ToolCall[]
  agentRuns?: AgentRun[]
}

/** Provisional row while waiting for the first assistant tokens of a turn. */
export function ThinkingBubble({ steps, toolCalls, agentRuns }: ThinkingBubbleProps) {
  // Stable wall-clock start for live elapsed (do not use Date.now() as a prop).
  const startedAtRef = useRef(Date.now())

  return (
    <div className="min-w-0 w-full" data-testid="thinking-bubble">
      <div className="mb-1 flex min-h-[var(--trail-min-h)] items-center text-meta font-medium leading-5 text-ink-secondary">
        hip
      </div>
      <TurnStatusLine
        streaming
        steps={steps}
        toolCalls={toolCalls}
        agentRuns={agentRuns}
        startedAt={startedAtRef.current}
      />
    </div>
  )
}
