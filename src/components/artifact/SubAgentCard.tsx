import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Loader2, CheckCircle2, XCircle } from 'lucide-react'
import type { TurnAgent } from '@/lib/turnAgents'
import { ToolCallRow } from '@/components/artifact/ToolCallRow'
import { DeclarativeContextMenu } from '@/components/context-menu'
import { cn } from '@/lib/utils'
import { sanitizeDisplayText } from '@/lib/sanitizeDisplayText'
import { MarkdownBody } from '@/components/chat/MarkdownBody'
import { ROLE_NAME_KEY } from '@/lib/roleColor'
import { useFocusStore } from '@/store/focusStore'
import { useUiStore } from '@/store/uiStore'
import { useDomainStore } from '@/domain/sessionStore'

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

export function SubAgentCard({
  agent,
  showTools = true,
}: {
  agent: TurnAgent
  /** When false, tools are only shown in Activity (dedupe). */
  showTools?: boolean
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(agent.status === 'running')
  const title =
    agent.taskInput?.trim() ||
    t(ROLE_NAME_KEY[agent.role] ?? 'artifact.roles.subagent', {
      defaultValue: agent.role,
    })
  const cleanOutput = sanitizeDisplayText(agent.output)
  const toolCount = agent.tools.length
  const elapsedSec = agent.elapsedMs > 0 ? Math.round(agent.elapsedMs / 1000) : null
  const runningTool = agent.tools.find((tc) => tc.status === 'running')

  const openInAgents = (e: React.MouseEvent) => {
    e.stopPropagation()
    useFocusStore.getState().setFocusedAgentId(agent.agentId)
    useUiStore.getState().setTab('agents')
    const sid = useDomainStore.getState().activeSessionId
    if (sid) useDomainStore.getState().setSessionCodePanelOpen(sid, true)
  }

  return (
    <DeclarativeContextMenu kind="subAgent" payload={{ agent }}>
      <div className="mb-2 rounded-lg border border-border bg-surface-muted/30">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
          data-testid="subagent-card"
        >
          <ChevronRight
            size={12}
            className={cn('shrink-0 text-ink-tertiary transition-transform', open && 'rotate-90')}
          />
          <span className="min-w-0 flex-1 truncate text-meta font-medium text-ink" title={title}>
            {title}
          </span>
          <span className="hidden shrink-0 font-mono text-caption text-ink-tertiary sm:inline" title={agent.agentId}>
            {agent.agentId}
          </span>
          {runningTool && (
            <span className="hidden max-w-[8rem] shrink-0 truncate text-caption text-ink-tertiary sm:inline">
              {runningTool.name}
            </span>
          )}
          {toolCount > 0 && (
            <span className="shrink-0 text-caption text-ink-tertiary">
              {t('chat.subagent.toolsCount', { count: toolCount })}
            </span>
          )}
          {elapsedSec != null && (
            <span className="shrink-0 text-caption text-ink-tertiary">{elapsedSec}s</span>
          )}
          <span
            role="button"
            tabIndex={0}
            className="shrink-0 text-caption text-accent hover:underline"
            data-testid="subagent-open-agents"
            onClick={openInAgents}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter' || ev.key === ' ') {
                ev.preventDefault()
                openInAgents(ev as unknown as React.MouseEvent)
              }
            }}
          >
            Agents
          </span>
          <span className="ml-auto shrink-0">
            {agent.status === 'running' ? (
              <Loader2 size={12} className="animate-spin text-accent-strong" />
            ) : agent.status === 'error' ? (
              <XCircle size={12} className="text-danger" />
            ) : (
              <CheckCircle2 size={12} className="text-success" />
            )}
          </span>
        </button>
        {open && (
          <div className="space-y-1.5 border-t border-border px-2 py-1.5">
            {agent.reasoning && (
              <pre className="whitespace-pre-wrap text-caption text-ink-secondary">
                {sanitizeDisplayText(agent.reasoning)}
              </pre>
            )}
            {showTools && agent.tools.map((tc) => <ToolCallRow key={tc.callId} tool={tc} />)}
            {!showTools && toolCount > 0 && (
              <p className="text-caption text-ink-tertiary">{t('chat.activity.viewInActivity')}</p>
            )}
            {cleanOutput ? (
              <div className="max-h-48 overflow-auto" data-testid="subagent-output">
                <MarkdownBody content={cleanOutput} className="text-meta [&_p]:my-1" />
              </div>
            ) : (
              <div className="text-caption text-ink-tertiary">{t('chat.subagent.noSummary')}</div>
            )}
          </div>
        )}
      </div>
    </DeclarativeContextMenu>
  )
}
