import { useState } from 'react'
import { ChevronRight, Loader2, Check } from 'lucide-react'
import type { TurnAgent } from '@/lib/turnAgents'
import { ToolCallRow } from '@/components/artifact/ToolCallRow'
import { cn } from '@/lib/utils'

/** Split grouped agents into flat (supervisor) vs nested (dispatched sub-agents). */
export function splitAgents(agents: TurnAgent[]): { flat: TurnAgent[]; nested: TurnAgent[] } {
  const flat: TurnAgent[] = []
  const nested: TurnAgent[] = []
  for (const a of agents) {
    if (a.role === 'subagent' && a.parentAgentId) nested.push(a)
    else flat.push(a)
  }
  return { flat, nested }
}

export function SubAgentCard({ agent }: { agent: TurnAgent }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="rounded-md border border-border bg-surface-muted/30">
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-2 px-2 py-1.5 text-left" data-testid="subagent-card">
        <ChevronRight size={12} className={cn('shrink-0 text-ink-tertiary transition-transform', open && 'rotate-90')} />
        <span className="shrink-0 text-meta font-medium text-ink">{agent.agentId}</span>
        {agent.taskInput && <span className="truncate text-caption text-ink-tertiary">{agent.taskInput}</span>}
        <span className="ml-auto shrink-0">
          {agent.status === 'running' ? <Loader2 size={12} className="animate-spin text-accent-strong" /> : <Check size={12} className="text-success" />}
        </span>
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-border px-2 py-1.5">
          {agent.reasoning && <pre className="whitespace-pre-wrap text-caption text-ink-secondary">{agent.reasoning}</pre>}
          {agent.tools.map((tc) => <ToolCallRow key={tc.callId} tool={tc} />)}
          {agent.output && <div className="text-prose text-ink">{agent.output}</div>}
        </div>
      )}
    </div>
  )
}
