import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Brain } from 'lucide-react'
import type { AgentRole, TimelineStep, ToolCall } from '@hip/protocol'
import { cn } from '@/lib/utils'
import { ToolCallRow } from '@/components/artifact/ToolCallRow'

const ROLE_COLOR: Record<AgentRole, string> = {
  supervisor: 'var(--role-supervisor)',
  planner: 'var(--role-planner)',
  coder: 'var(--role-coder)',
  reviewer: 'var(--role-reviewer)',
}

function AgentBadge({ role }: { role: AgentRole }) {
  return (
    <span
      className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
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
    <div className="flex gap-2">
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
          <Brain size={12} className="shrink-0" />
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
  onToolClick?: (callId: string) => void
}

/** Inline, flat per-turn activity (reasoning + tool steps), ordered by the turn-global stepSeq. */
export function TurnTimeline({ steps, toolCalls, onToolClick }: TurnTimelineProps) {
  if (!steps || steps.length === 0) return null
  const ordered = [...steps].sort((a, b) => a.stepSeq - b.stepSeq)
  const byCallId = new Map((toolCalls ?? []).map((tc) => [tc.callId, tc]))
  return (
    <div className="mb-2 flex flex-col gap-1.5" data-testid="turn-timeline">
      {ordered.map((step) => {
        if (step.kind === 'reasoning') {
          return (
            <ThinkingDisclosure
              key={`r-${step.stepSeq}`}
              role={step.role}
              content={step.content}
            />
          )
        }
        const tool = byCallId.get(step.callId)
        if (!tool) return null
        return (
          <div key={`t-${step.stepSeq}`} className="flex gap-2">
            <AgentBadge role={step.role} />
            <div
              className="min-w-0 flex-1"
              onClickCapture={onToolClick ? () => onToolClick(step.callId) : undefined}
            >
              <ToolCallRow tool={tool} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
