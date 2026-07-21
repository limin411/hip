import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, CheckCircle2, XCircle, ChevronRight, MessageSquare } from 'lucide-react'
import type { TurnAgent } from '@/lib/turnAgents'
import { ToolCallRow } from '@/components/artifact/ToolCallRow'
import { DeclarativeContextMenu } from '@/components/context-menu'
import { sanitizeDisplayText } from '@/lib/sanitizeDisplayText'
import { MarkdownBody } from '@/components/chat/MarkdownBody'
import { ThinkingDisclosure, TRAIL_ROW } from '@/components/chat/TurnTimeline'
import { ROLE_COLOR, agentDisplayName } from '@/lib/roleColor'
import { useFocusStore } from '@/store/focusStore'
import { useUiStore } from '@/store/uiStore'
import { useDomainStore } from '@/domain/sessionStore'
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

/** Collapsible sub-agent reply — intermediate output, not the final user-facing answer. */
function ReplyDisclosure({
  content,
  defaultOpen,
}: {
  content: string
  defaultOpen: boolean
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(defaultOpen)
  const clean = sanitizeDisplayText(content)
  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(TRAIL_ROW, 'text-ink-tertiary transition-colors hover:text-ink-secondary')}
        data-testid="subagent-reply-disclosure"
      >
        <ChevronRight
          size={14}
          className={cn('block shrink-0 transition-transform', open && 'rotate-90')}
        />
        <MessageSquare size={14} className="block shrink-0" aria-hidden />
        <span className="min-w-0 truncate">{t('chat.subagent.reply')}</span>
      </button>
      {open && (
        <div className="mt-1 max-h-48 overflow-auto border-l border-border pl-3" data-testid="subagent-output">
          <MarkdownBody content={clean} className="text-meta [&_p]:my-1" />
        </div>
      )}
    </div>
  )
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
  const nameLabel = agentDisplayName(agent, t)
  const title = hasTaskTitle ? agent.taskInput!.trim() : nameLabel
  const cleanOutput = sanitizeDisplayText(agent.output)
  const toolCount = agent.tools.length
  const elapsedSec = agent.elapsedMs > 0 ? Math.round(agent.elapsedMs / 1000) : null
  const runningTool = agent.tools.find((tc) => tc.status === 'running')
  const railColor = ROLE_COLOR[agent.role] ?? ROLE_COLOR.subagent
  const isRunning = agent.status === 'running'

  // Body: collapsed by default; user toggles to inspect tools / reply.
  const [manualOpen, setManualOpen] = useState<boolean | null>(null)
  const bodyOpen = manualOpen ?? false

  const openInAgents = (e: React.MouseEvent) => {
    e.stopPropagation()
    useFocusStore.getState().setFocusedAgentId(agent.agentId)
    useUiStore.getState().setTab('agents')
    const sid = useDomainStore.getState().activeSessionId
    if (sid) useDomainStore.getState().setSessionCodePanelOpen(sid, true)
  }

  return (
    <DeclarativeContextMenu kind="subAgent" payload={{ agent }}>
      <div
        className="mb-2 border-l-2 pl-3"
        style={{ borderLeftColor: railColor }}
        data-testid="subagent-card"
      >
        <button
          type="button"
          onClick={() => setManualOpen(!bodyOpen)}
          aria-expanded={bodyOpen}
          className={cn(TRAIL_ROW, 'w-full text-ink transition-colors hover:text-ink')}
          data-testid="subagent-card-header"
        >
          <ChevronRight
            size={14}
            className={cn('block shrink-0 text-ink-tertiary transition-transform', bodyOpen && 'rotate-90')}
          />
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
            <span className="shrink-0 text-ink-tertiary">{nameLabel}</span>
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
            role="link"
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
        </button>
        {bodyOpen && (
          <div className="mt-0.5 flex flex-col gap-0.5" data-testid="subagent-card-body">
            {agent.reasoning && (
              <ThinkingDisclosure
                role={agent.role}
                content={agent.reasoning}
                seconds={elapsedSec ?? undefined}
                showBadge={false}
              />
            )}
            {showTools && agent.tools.map((tc) => <ToolCallRow key={tc.callId} tool={tc} />)}
            {!showTools && toolCount > 0 && (
              <p className="text-meta leading-5 text-ink-tertiary">{t('chat.activity.viewInActivity')}</p>
            )}
            {cleanOutput ? (
              <ReplyDisclosure content={cleanOutput} defaultOpen={false} />
            ) : (
              <div className="text-meta leading-5 text-ink-tertiary">{t('chat.subagent.noSummary')}</div>
            )}
          </div>
        )}
      </div>
    </DeclarativeContextMenu>
  )
}
