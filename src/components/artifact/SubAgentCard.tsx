import { useTranslation } from 'react-i18next'
import { Loader2, CheckCircle2, XCircle } from 'lucide-react'
import type { TurnAgent } from '@/lib/turnAgents'
import { ToolCallRow } from '@/components/artifact/ToolCallRow'
import { DeclarativeContextMenu } from '@/components/context-menu'
import { sanitizeDisplayText } from '@/lib/sanitizeDisplayText'
import { MarkdownBody } from '@/components/chat/MarkdownBody'
import { ROLE_COLOR, ROLE_NAME_KEY } from '@/lib/roleColor'
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
  const hasTaskTitle = Boolean(agent.taskInput?.trim())
  const roleLabel = t(ROLE_NAME_KEY[agent.role] ?? 'artifact.roles.subagent', {
    defaultValue: agent.role,
  })
  const title = hasTaskTitle ? agent.taskInput!.trim() : roleLabel
  const cleanOutput = sanitizeDisplayText(agent.output)
  const toolCount = agent.tools.length
  const elapsedSec = agent.elapsedMs > 0 ? Math.round(agent.elapsedMs / 1000) : null
  const runningTool = agent.tools.find((tc) => tc.status === 'running')
  const railColor = ROLE_COLOR[agent.role] ?? ROLE_COLOR.subagent

  const openInAgents = (e: React.MouseEvent) => {
    e.stopPropagation()
    useFocusStore.getState().setFocusedAgentId(agent.agentId)
    useUiStore.getState().setTab('agents')
    const sid = useDomainStore.getState().activeSessionId
    if (sid) useDomainStore.getState().setSessionCodePanelOpen(sid, true)
  }

  return (
    <DeclarativeContextMenu kind="subAgent" payload={{ agent }}>
      {/* Always expanded — CLI-style flat trail, single-line baseline for header */}
      <div
        className="mb-2 border-l-2 pl-3"
        style={{ borderLeftColor: railColor }}
        data-testid="subagent-card"
      >
        <div className="flex min-h-[var(--trail-min-h)] w-full items-center gap-[var(--meta-gap)] text-left text-meta leading-5">
          <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center">
            {agent.status === 'running' ? (
              <Loader2 size={14} className="block animate-spin text-accent-strong" />
            ) : agent.status === 'error' ? (
              <XCircle size={14} className="block text-danger" />
            ) : (
              <CheckCircle2 size={14} className="block text-success" />
            )}
          </span>
          <span className="min-w-0 truncate font-medium text-ink" title={title}>
            {title}
          </span>
          {hasTaskTitle && (
            <span className="shrink-0 text-ink-tertiary">{roleLabel}</span>
          )}
          <span className="hidden min-w-0 shrink-0 truncate font-mono text-ink-tertiary sm:inline" title={agent.agentId}>
            {agent.agentId}
          </span>
          {runningTool && (
            <span className="hidden max-w-[8rem] shrink-0 truncate text-ink-tertiary sm:inline">
              {runningTool.name}
            </span>
          )}
          {toolCount > 0 && (
            <span className="shrink-0 text-ink-tertiary">
              {t('chat.subagent.toolsCount', { count: toolCount })}
            </span>
          )}
          {elapsedSec != null && (
            <span className="shrink-0 text-ink-tertiary">{elapsedSec}s</span>
          )}
          <span
            role="button"
            tabIndex={0}
            className="shrink-0 text-accent hover:underline"
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
        </div>
        <div className="mt-0.5 flex flex-col gap-0.5">
          {agent.reasoning && (
            <pre className="whitespace-pre-wrap text-meta leading-5 text-ink-secondary">
              {sanitizeDisplayText(agent.reasoning)}
            </pre>
          )}
          {showTools && agent.tools.map((tc) => <ToolCallRow key={tc.callId} tool={tc} />)}
          {!showTools && toolCount > 0 && (
            <p className="text-meta leading-5 text-ink-tertiary">{t('chat.activity.viewInActivity')}</p>
          )}
          {cleanOutput ? (
            <div className="max-h-48 overflow-auto" data-testid="subagent-output">
              <MarkdownBody content={cleanOutput} className="text-meta [&_p]:my-1" />
            </div>
          ) : (
            <div className="text-meta leading-5 text-ink-tertiary">{t('chat.subagent.noSummary')}</div>
          )}
        </div>
      </div>
    </DeclarativeContextMenu>
  )
}
