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

/** Role color dot — no top margin; parents use items-center for baseline alignment. */
export function AgentBadge({ role }: { role: AgentRole }) {
  return (
    <span
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{ background: ROLE_COLOR[role] }}
      aria-hidden
    />
  )
}

/** Shared single-line trail row: fixed line box so icons + text share one baseline. */
export const TRAIL_ROW =
  'flex min-h-5 w-full items-center gap-1.5 text-left text-meta leading-5'

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
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(TRAIL_ROW, 'text-ink-tertiary transition-colors hover:text-ink-secondary')}
        data-testid="thinking-disclosure"
      >
        <AgentBadge role={role} />
        <ChevronRight
          size={14}
          className={cn('block shrink-0 transition-transform', open && 'rotate-90')}
        />
        <Brain size={14} className="block shrink-0" aria-hidden />
        <span className="min-w-0 truncate">{label}</span>
      </button>
      {open && (
        <pre className="mt-1 whitespace-pre-wrap break-words border-l border-border pl-3 font-sans text-meta leading-relaxed text-ink-secondary">
          {clean}
        </pre>
      )}
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
    .map((tool) => <ToolCallRow key={tool.callId} tool={tool} />)
}

/** Parent-shell delegation tools when child agentRuns already represent the work. */
const PARENT_DELEGATE_SHELL = new Set(['task', 'task_batch', 'dispatch_agent'])

interface AgentSection {
  agentId: string
  role: AgentRole
  taskInput?: string
  nodes: JSX.Element[]
  firstSeq: number
  startedAt: number
}

function buildAgentSections(
  steps: TimelineStep[] | undefined,
  toolCalls: ToolCall[] | undefined,
  agentRuns: AgentRun[] | undefined,
  t: (key: string, opts?: Record<string, unknown>) => string,
): AgentSection[] {
  const byCallId = new Map((toolCalls ?? []).map((tc) => [tc.callId, tc]))
  const runByAgent = new Map((agentRuns ?? []).map((r) => [r.agentId, r]))
  const hasNestedChildren = (agentRuns ?? []).some(
    (r) => r.role !== 'supervisor' && (r.parentAgentId || r.taskInput),
  )

  type Bucket = {
    agentId: string
    role: AgentRole
    items: Array<{ seq: number; node: JSX.Element }>
    firstSeq: number
  }
  const buckets = new Map<string, Bucket>()
  const ensure = (agentId: string, role: AgentRole, seq: number): Bucket => {
    let b = buckets.get(agentId)
    if (!b) {
      b = { agentId, role, items: [], firstSeq: seq }
      buckets.set(agentId, b)
    } else {
      b.firstSeq = Math.min(b.firstSeq, seq)
    }
    return b
  }

  const orderedSteps = [...(steps ?? [])].sort((a, b) => a.stepSeq - b.stepSeq)
  const referencedCallIds = new Set<string>()

  for (const step of orderedSteps) {
    const b = ensure(step.agentId, step.role, step.stepSeq)
    if (step.kind === 'reasoning') {
      b.items.push({
        seq: step.stepSeq,
        node: (
          <ThinkingDisclosure
            key={`r-${step.agentId}-${step.stepSeq}`}
            role={step.role}
            content={step.content}
          />
        ),
      })
    } else if (!isSuppressedToolStep(step, byCallId)) {
      const tool = byCallId.get(step.callId)
      if (!tool || tool.name === 'write_todos') continue
      // When children are present, hide parent shell delegate rows (shown as child sections).
      if (
        hasNestedChildren &&
        step.role === 'supervisor' &&
        PARENT_DELEGATE_SHELL.has(tool.name)
      ) {
        referencedCallIds.add(tool.callId)
        continue
      }
      referencedCallIds.add(tool.callId)
      b.items.push({
        seq: step.stepSeq,
        node: (
          <div key={tool.callId} className="flex gap-2">
            <div className="min-w-0 flex-1">
              <ToolCallRow tool={tool} />
            </div>
          </div>
        ),
      })
    } else {
      const tool = byCallId.get(step.callId)
      if (tool) referencedCallIds.add(tool.callId)
    }
  }

  // Orphan toolCalls (no timeline step) — attach by agentId, keep seq order.
  const orphans = (toolCalls ?? [])
    .filter((tc) => {
      if (tc.name === 'write_todos') return false
      if (referencedCallIds.has(tc.callId)) return false
      if (tc.name === 'task') return false
      if (hasNestedChildren && PARENT_DELEGATE_SHELL.has(tc.name) && tc.agentId === 'supervisor') {
        return false
      }
      return true
    })
    .sort((a, b) => a.seq - b.seq)

  for (const tc of orphans) {
    const run = runByAgent.get(tc.agentId)
    const role = (run?.role ?? (tc.agentId === 'supervisor' ? 'supervisor' : 'subagent')) as AgentRole
    const b = ensure(tc.agentId, role, tc.seq)
    b.items.push({
      seq: tc.seq,
      node: (
        <div key={tc.callId} className="flex gap-2">
          <div className="min-w-0 flex-1">
            <ToolCallRow tool={tc} />
          </div>
        </div>
      ),
    })
  }

  // Agents with runs but no tools/reasoning yet (or only output).
  for (const r of agentRuns ?? []) {
    if (!buckets.has(r.agentId)) {
      ensure(r.agentId, r.role, r.seq ?? 0)
    }
  }

  const sections: AgentSection[] = []
  for (const b of buckets.values()) {
    const run = runByAgent.get(b.agentId)
    const items = [...b.items].sort((a, c) => a.seq - c.seq)
    // When many tools for one agent, allow category grouping within that agent only.
    const toolOnly = items.length === 0
      ? []
      : (toolCalls ?? []).filter(
          (tc) =>
            tc.agentId === b.agentId &&
            tc.name !== 'write_todos' &&
            tc.name !== 'task' &&
            !(hasNestedChildren && b.role === 'supervisor' && PARENT_DELEGATE_SHELL.has(tc.name)),
        )
    let nodes: JSX.Element[]
    if (items.some((i) => i.node.key?.toString().startsWith('r-'))) {
      // Mixed reasoning + tools: keep interleaved order from items.
      nodes = items.map((i) => i.node)
    } else if (toolOnly.length >= 8) {
      // Pure tool list large enough to group — within agent only.
      nodes = [ <div key={`${b.agentId}-grouped`}>{renderToolList(toolOnly)}</div> ]
    } else {
      nodes = items.map((i) => i.node)
    }

    sections.push({
      agentId: b.agentId,
      role: b.role,
      taskInput: run?.taskInput,
      nodes,
      firstSeq: b.firstSeq,
      startedAt: run?.startedAt ?? b.firstSeq,
    })
  }

  sections.sort((a, b) => {
    if (a.role === 'supervisor' && b.role !== 'supervisor') return -1
    if (b.role === 'supervisor' && a.role !== 'supervisor') return 1
    if (a.startedAt !== b.startedAt) return a.startedAt - b.startedAt
    return a.firstSeq - b.firstSeq
  })

  // Attach delegation header nodes (not as separate global list).
  return sections.map((s) => {
    const headerNodes: JSX.Element[] = []
    if (s.role !== 'supervisor' && s.taskInput) {
      headerNodes.push(
        <div
          key={`d-${s.agentId}`}
          className={cn(TRAIL_ROW, 'text-ink-tertiary')}
          data-testid="delegation-row"
        >
          <AgentBadge role={s.role} />
          <span className="min-w-0 truncate">
            <span className="font-medium text-ink-secondary">
              {t('chat.delegatedTo', { role: t(ROLE_NAME_KEY[s.role]) })}
            </span>
            : {s.taskInput}
          </span>
        </div>,
      )
    } else if (s.role !== 'supervisor') {
      headerNodes.push(
        <div
          key={`h-${s.agentId}`}
          className={cn(TRAIL_ROW, 'text-ink-tertiary')}
          data-testid="agent-section-header"
        >
          <AgentBadge role={s.role} />
          <span className="min-w-0 truncate font-medium text-ink-secondary">{s.agentId}</span>
        </div>,
      )
    }
    return { ...s, nodes: [...headerNodes, ...s.nodes] }
  })
}

interface TurnTimelineProps {
  steps?: TimelineStep[]
  toolCalls?: ToolCall[]
  agentRuns?: AgentRun[]
  /** When true, omit TodoChecklist (sticky PlanProgressPanel already shows the live plan). */
  hidePlan?: boolean
}

/** Inline per-turn activity, ordered by agent then stepSeq within each agent. */
export function TurnTimeline({ steps, toolCalls, agentRuns, hidePlan }: TurnTimelineProps) {
  const { t } = useTranslation()
  const plan = hidePlan ? null : latestTodos(toolCalls)

  const hasSteps = (steps?.length ?? 0) > 0
  const hasTools = (toolCalls?.length ?? 0) > 0
  const hasRuns = (agentRuns?.length ?? 0) > 0
  if (!hasSteps && !hasTools && !hasRuns) return null

  // Multi-agent path: steps and/or tools and/or runs → per-agent sections.
  if (hasSteps || (hasTools && hasRuns) || (hasRuns && (agentRuns?.length ?? 0) > 1)) {
    const translate = (key: string, opts?: Record<string, unknown>) =>
      String(t(key as never, opts as never))
    const sections = buildAgentSections(steps, toolCalls, agentRuns, translate)
    const multi = sections.length > 1
    return (
      <div className="mb-0 flex flex-col gap-1" data-testid="turn-timeline">
        {plan && plan.todos.length > 0 && <TodoChecklist todos={plan.todos} />}
        {sections.map((s) => (
          <div
            key={s.agentId}
            className={cn(multi && 'border-l-2 pl-2', multi && s.role !== 'supervisor' && 'mt-1')}
            style={multi ? { borderLeftColor: ROLE_COLOR[s.role] } : undefined}
            data-testid="agent-timeline-section"
            data-agent-id={s.agentId}
          >
            {s.nodes}
          </div>
        ))}
      </div>
    )
  }

  // Single-agent / export fallback: toolCalls by seq (no agentRuns).
  if (hasTools) {
    const tools = [...(toolCalls ?? [])]
      .filter((t) => t.name !== 'task' && t.name !== 'write_todos')
      .sort((a, b) => a.seq - b.seq)
    return (
      <div className="mb-0 flex flex-col gap-1" data-testid="turn-timeline">
        {plan && plan.todos.length > 0 && <TodoChecklist todos={plan.todos} />}
        {renderToolList(tools)}
      </div>
    )
  }

  // agentRuns only
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
