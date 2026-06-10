import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Brain } from 'lucide-react'
import type { AgentRole, AgentRun, TimelineStep, ToolCall } from '@hip/protocol'
import { cn } from '@/lib/utils'
import { ToolCallRow } from '@/components/artifact/ToolCallRow'
import { ROLE_COLOR, ROLE_NAME_KEY } from '@/lib/roleColor'

function AgentBadge({ role }: { role: AgentRole }) {
  return (
    <span
      className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ background: ROLE_COLOR[role] }}
      aria-hidden
    />
  )
}

function ThinkingDisclosure({
  role,
  content,
  seconds,
}: {
  role: AgentRole
  content: string
  seconds?: number
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const label =
    seconds != null ? t('chat.thoughtFor', { seconds }) : t('chat.thinkingMode')
  return (
    <div className="flex gap-2 transition-colors">
      <AgentBadge role={role} />
      <div className="min-w-0 flex-1">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex items-center gap-1.5 text-left text-[12px] text-ink-tertiary transition-colors hover:text-ink-secondary"
          data-testid="thinking-disclosure"
        >
          <ChevronRight
            size={12}
            className={cn('shrink-0 transition-transform', open && 'rotate-90')}
          />
          <Brain size={12} className="shrink-0" aria-hidden />
          <span>{label}</span>
        </button>
        {open && (
          <pre className="mt-1 whitespace-pre-wrap break-words border-l border-border pl-3 font-sans text-[12.5px] leading-relaxed text-ink-secondary">
            {content}
          </pre>
        )}
      </div>
    </div>
  )
}

interface TurnTimelineProps {
  steps?: TimelineStep[]
  toolCalls?: ToolCall[]
  agentRuns?: AgentRun[]
}

/** Inline, flat per-turn activity (reasoning + tool steps), ordered by the turn-global stepSeq. */
export function TurnTimeline({ steps, toolCalls, agentRuns }: TurnTimelineProps) {
  const { t } = useTranslation()
  if (!steps || steps.length === 0) return null
  const ordered = [...steps].sort((a, b) => a.stepSeq - b.stepSeq)
  const byCallId = new Map((toolCalls ?? []).map((tc) => [tc.callId, tc]))
  const taskByAgent = new Map((agentRuns ?? []).filter((r) => r.taskInput).map((r) => [r.agentId, r.taskInput!]))
  const seen = new Set<string>()
  return (
    <div className="mb-2 flex flex-col gap-1.5" data-testid="turn-timeline">
      {ordered.flatMap((step) => {
        const nodes: JSX.Element[] = []
        if (!seen.has(step.agentId)) {
          seen.add(step.agentId)
          const task = taskByAgent.get(step.agentId)
          if (task && step.role !== 'supervisor') {
            nodes.push(
              <div key={`d-${step.agentId}`} className="flex items-center gap-2 text-[12px] text-ink-tertiary transition-colors" data-testid="delegation-row">
                <AgentBadge role={step.role} />
                <span className="truncate">
                  <span className="font-medium text-ink-secondary">{t('chat.delegatedTo', { role: t(ROLE_NAME_KEY[step.role]) })}</span>: {task}
                </span>
              </div>,
            )
          }
        }
        if (step.kind === 'reasoning') {
          nodes.push(<ThinkingDisclosure key={`r-${step.stepSeq}`} role={step.role} content={step.content} />)
        } else {
          const tool = byCallId.get(step.callId)
          if (tool) nodes.push(
            <div key={`t-${step.stepSeq}`} className="flex gap-2 transition-colors">
              <AgentBadge role={step.role} />
              <div className="min-w-0 flex-1"><ToolCallRow tool={tool} /></div>
            </div>,
          )
        }
        return nodes
      })}
    </div>
  )
}
