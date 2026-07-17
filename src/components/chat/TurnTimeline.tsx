import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Brain } from 'lucide-react'
import type { AgentRole, AgentRun, TimelineStep, ToolCall } from '@hip/protocol'
import { cn } from '@/lib/utils'
import { ToolCallRow } from '@/components/artifact/ToolCallRow'
import { ToolCallGroup } from '@/components/artifact/ToolCallGroup'
import { ROLE_COLOR, ROLE_NAME_KEY } from '@/lib/roleColor'
import { isSuppressedToolStep } from '@/lib/timelineFilter'
import { latestTodos } from '@/lib/todos'
import { groupToolCalls } from '@/lib/toolGroups'
import { sanitizeDisplayText } from '@/lib/sanitizeDisplayText'
import { MarkdownBody } from './MarkdownBody'
import { TodoChecklist } from './TodoChecklist'

export function AgentBadge({ role }: { role: AgentRole }) {
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
  const clean = sanitizeDisplayText(content)
  return (
    <div className="flex gap-2">
      <AgentBadge role={role} />
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex items-center gap-1.5 text-left text-meta text-ink-tertiary transition-colors hover:text-ink-secondary"
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
          <pre className="mt-1 whitespace-pre-wrap break-words border-l border-border pl-3 font-sans text-meta leading-relaxed text-ink-secondary">
            {clean}
          </pre>
        )}
      </div>
    </div>
  )
}

function renderToolList(tools: ToolCall[]) {
  const grouped = groupToolCalls(tools)
  if (grouped.mode === 'grouped') {
    return grouped.groups.map((g) => (
      <ToolCallGroup key={g.category} category={g.category} tools={g.tools} />
    ))
  }
  return grouped.tools
    .filter((tool) => tool.name !== 'write_todos')
    .map((tool) => (
      <div key={tool.callId} className="flex gap-2">
        <div className="min-w-0 flex-1">
          <ToolCallRow tool={tool} />
        </div>
      </div>
    ))
}

interface TurnTimelineProps {
  steps?: TimelineStep[]
  toolCalls?: ToolCall[]
  agentRuns?: AgentRun[]
  /** When true, omit TodoChecklist (sticky PlanProgressPanel already shows the live plan). */
  hidePlan?: boolean
}

/** Inline, flat per-turn activity (reasoning + tool steps), ordered by the turn-global stepSeq. */
export function TurnTimeline({ steps, toolCalls, agentRuns, hidePlan }: TurnTimelineProps) {
  const { t } = useTranslation()
  const byCallId = new Map((toolCalls ?? []).map((tc) => [tc.callId, tc]))
  const taskByAgent = new Map((agentRuns ?? []).filter((r) => r.taskInput).map((r) => [r.agentId, r.taskInput!]))
  const plan = hidePlan ? null : latestTodos(toolCalls)

  const hasSteps = (steps?.length ?? 0) > 0
  const hasTools = (toolCalls?.length ?? 0) > 0
  const hasRuns = (agentRuns?.length ?? 0) > 0
  if (!hasSteps && !hasTools && !hasRuns) return null

  // Path 1: timeline steps present — reasoning interleaved; tools collected then flat/grouped
  if (hasSteps) {
    const ordered = [...steps!].sort((a, b) => a.stepSeq - b.stepSeq)
    const seen = new Set<string>()
    const reasoningNodes: JSX.Element[] = []
    const toolList: ToolCall[] = []
    const delegationNodes: JSX.Element[] = []

    for (const step of ordered) {
      if (!seen.has(step.agentId)) {
        seen.add(step.agentId)
        const task = taskByAgent.get(step.agentId)
        if (task && step.role !== 'supervisor') {
          delegationNodes.push(
            <div key={`d-${step.agentId}`} className="flex items-center gap-2 text-meta text-ink-tertiary" data-testid="delegation-row">
              <AgentBadge role={step.role} />
              <span className="truncate">
                <span className="font-medium text-ink-secondary">{t('chat.delegatedTo', { role: t(ROLE_NAME_KEY[step.role]) })}</span>: {task}
              </span>
            </div>,
          )
        }
      }
      if (step.kind === 'reasoning') {
        reasoningNodes.push(
          <ThinkingDisclosure key={`r-${step.stepSeq}`} role={step.role} content={step.content} />,
        )
      } else if (!isSuppressedToolStep(step, byCallId)) {
        const tool = byCallId.get(step.callId)
        if (tool && tool.name !== 'write_todos') toolList.push(tool)
      }
    }

    // Also include tools not referenced by steps (orphan toolCalls)
    for (const tc of toolCalls ?? []) {
      if (tc.name === 'write_todos' || tc.name === 'task') continue
      if (!toolList.some((x) => x.callId === tc.callId) && !isSuppressedToolStep(
        { kind: 'tool', stepSeq: tc.seq, agentId: tc.agentId, role: 'supervisor', callId: tc.callId },
        byCallId,
      )) {
        // only add if no step referenced it
        const referenced = ordered.some((s) => s.kind === 'tool' && s.callId === tc.callId)
        if (!referenced) toolList.push(tc)
      }
    }

    return (
      <div className="mb-0 flex flex-col gap-1" data-testid="turn-timeline">
        {plan && plan.todos.length > 0 && <TodoChecklist todos={plan.todos} />}
        {delegationNodes}
        {reasoningNodes}
        {renderToolList(toolList)}
      </div>
    )
  }

  // Path 2: no timeline — fallback to toolCalls by seq (export / legacy)
  if (hasTools) {
    const tools = [...(toolCalls ?? [])].sort((a, b) => a.seq - b.seq)
    return (
      <div className="mb-0 flex flex-col gap-1" data-testid="turn-timeline">
        {plan && plan.todos.length > 0 && <TodoChecklist todos={plan.todos} />}
        {renderToolList(tools.filter((t) => t.name !== 'task'))}
      </div>
    )
  }

  // Path 3: agentRuns only
  return (
    <div className="mb-0 flex flex-col gap-1" data-testid="turn-timeline">
      {(agentRuns ?? [])
        .filter((r) => r.role !== 'supervisor')
        .map((r) => {
          const out = sanitizeDisplayText(r.output)
          return (
            <div key={r.agentId} className="rounded-md border border-border px-2 py-1.5" data-testid="run-summary-row">
              <div className="text-meta font-medium text-ink-secondary">
                {r.taskInput?.trim() || r.agentId}
              </div>
              {out ? (
                <div className="mt-1 max-h-24 overflow-auto">
                  <MarkdownBody content={out} className="text-caption [&_p]:my-0.5" />
                </div>
              ) : (
                <div className="mt-0.5 text-caption text-ink-tertiary">{t('chat.subagent.noSummary')}</div>
              )}
            </div>
          )
        })}
    </div>
  )
}
