import { useTranslation } from 'react-i18next'
import type { AgentRole, Message, TimelineStep, ToolCall } from '@hip/protocol'
import { useActiveMessages, useActiveSessionStatus } from '@/domain'
import { AgentCard, type TurnAgent } from './AgentCard'

/** Group a turn's flat timeline + toolCalls into per-agent buckets (derived OUTSIDE any selector). */
function groupByAgent(message: Message | null, live: boolean): TurnAgent[] {
  if (!message) return []
  const steps: TimelineStep[] = message.timeline ?? []
  const toolByCallId = new Map((message.toolCalls ?? []).map((tc) => [tc.callId, tc]))
  const order: string[] = []
  const buckets = new Map<string, { role: AgentRole; reasoning: string[]; tools: ToolCall[] }>()
  for (const step of [...steps].sort((a, b) => a.stepSeq - b.stepSeq)) {
    let b = buckets.get(step.agentId)
    if (!b) { b = { role: step.role, reasoning: [], tools: [] }; buckets.set(step.agentId, b); order.push(step.agentId) }
    if (step.kind === 'reasoning') b.reasoning.push(step.content)
    else { const tc = toolByCallId.get(step.callId); if (tc) b.tools.push(tc) }
  }
  return order.map((agentId) => {
    const b = buckets.get(agentId)!
    const anyRunning = b.tools.some((tc) => tc.status === 'running')
    return { agentId, role: b.role, reasoning: b.reasoning.join('\n\n'), tools: b.tools, status: live && anyRunning ? 'running' : 'done' }
  })
}

export function AgentDashboard() {
  const { t } = useTranslation()
  const messages = useActiveMessages()
  const status = useActiveSessionStatus()
  let latest: Message | null = null
  for (let i = messages.length - 1; i >= 0; i--) { if (messages[i].role === 'assistant') { latest = messages[i]; break } }
  const live = status === 'running'
  const agents = groupByAgent(latest, live)
  const supervisor = agents.find((a) => a.role === 'supervisor')
  const children = agents.filter((a) => a.role !== 'supervisor')
  if (agents.length === 0) return <div className="text-[12px] text-ink-tertiary">{t('artifact.noTools')}</div>
  return (
    <div className="flex flex-col gap-3">
      {supervisor && <AgentCard agent={supervisor} live={live} />}
      {children.length > 0 && (
        <>
          <div className="text-[11px] font-medium uppercase tracking-wide text-ink-tertiary">{t('artifact.subAgents')}</div>
          <div className="flex flex-col gap-2.5">{children.map((agent) => <AgentCard key={agent.agentId} agent={agent} live={live} />)}</div>
        </>
      )}
    </div>
  )
}
