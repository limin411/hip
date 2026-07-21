import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ROLE_COLOR, ROLE_NAME_KEY, agentDisplayName } from '@/lib/roleColor'
import type { TurnAgent } from '@/lib/turnAgents'
import { sanitizeDisplayText } from '@/lib/sanitizeDisplayText'
import { MarkdownBody } from '@/components/chat/MarkdownBody'
import { ToolTrace } from './ToolTrace'
import { useUiStore } from '@/store/uiStore'
import { useFocusStore } from '@/store/focusStore'

/** Flat trail row — same density as chat timeline, no card chrome. */
const TRAIL_ROW =
  'flex min-h-[var(--trail-min-h)] w-full items-center gap-[var(--meta-gap)] text-left text-meta leading-5'

function StatusDot({ status, color }: { status: TurnAgent['status']; color: string }) {
  if (status === 'running') {
    return (
      <span
        className="h-1.5 w-1.5 animate-pulse rounded-full"
        style={{ background: color }}
        data-testid="status-dot-running"
      />
    )
  }
  if (status === 'error') {
    return <span className="h-1.5 w-1.5 rounded-full bg-danger" data-testid="status-dot-error" />
  }
  return (
    <span className="h-1.5 w-1.5 rounded-full bg-ink-tertiary/45" data-testid="status-dot-done" />
  )
}

/** Collapsible sub-agent output — same interaction as chat SubAgentCard reply. */
function OutputDisclosure({
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
        data-testid="agent-output-disclosure"
      >
        <ChevronRight
          size={14}
          strokeWidth={1.75}
          className={cn('block shrink-0 transition-transform duration-chrome', open && 'rotate-90')}
        />
        <MessageSquare size={14} className="block shrink-0" aria-hidden />
        <span className="min-w-0 truncate">{t('artifact.output')}</span>
      </button>
      {open && (
        <div
          className="mt-1 max-h-48 overflow-auto border-l border-border pl-3"
          data-testid="agent-output"
        >
          <MarkdownBody content={clean} className="text-meta [&_p]:my-1" />
        </div>
      )}
    </div>
  )
}

/** Collapsible reasoning block — default closed, like chat ThinkingDisclosure. */
function ReasoningDisclosure({ content }: { content: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(TRAIL_ROW, 'text-ink-tertiary transition-colors hover:text-ink-secondary')}
        data-testid="agent-reasoning-disclosure"
      >
        <ChevronRight
          size={14}
          strokeWidth={1.75}
          className={cn('block shrink-0 transition-transform duration-chrome', open && 'rotate-90')}
        />
        <span className="min-w-0 truncate">{t('chat.thinkingMode')}</span>
      </button>
      {open && (
        <pre className="mt-1 whitespace-pre-wrap break-words border-l border-border pl-3 font-sans text-meta leading-snug text-ink-secondary">
          {content}
        </pre>
      )}
    </div>
  )
}

export function AgentCard({ agent, live }: { agent: TurnAgent; live: boolean }) {
  const { t } = useTranslation()
  const color = ROLE_COLOR[agent.role]
  const running = live && agent.status === 'running'
  const isError = agent.status === 'error'
  // Body: collapsed by default; user toggles to inspect tools / output.
  const [manual, setManual] = useState<boolean | null>(null)
  const open = manual ?? false
  const setScrollTarget = useUiStore((s) => s.setScrollTarget)

  const jumpToTurn = () => {
    if (agent.messageId) setScrollTarget(agent.messageId)
    useFocusStore.getState().setFocusedAgentId(agent.agentId)
  }

  const statusLabel =
    agent.status === 'done' && agent.elapsedMs > 0
      ? t('chat.thoughtFor', { seconds: Math.round(agent.elapsedMs / 1000) })
      : agent.status === 'error'
        ? t('artifact.failed')
        : agent.status === 'running'
          ? t('artifact.statusRunning')
          : agent.status

  const cleanOutput = agent.output ? sanitizeDisplayText(agent.output) : ''
  const isSubAgent = agent.role !== 'supervisor'

  return (
    <div className="min-w-0" data-testid="agent-card" data-status={agent.status}>
      <button
        type="button"
        onClick={() => setManual(!open)}
        aria-expanded={open}
        className={cn(
          TRAIL_ROW,
          'w-full rounded-md px-1.5 py-1.5 text-ink transition-colors duration-chrome',
          'hover:bg-state-hover',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
        )}
        data-testid="agent-card-header"
      >
        <ChevronRight
          size={14}
          strokeWidth={1.75}
          className={cn(
            'block shrink-0 text-ink-tertiary transition-transform duration-chrome',
            open && 'rotate-90',
          )}
        />
        <StatusDot status={agent.status} color={color} />
        <span className="min-w-0 flex-1 truncate font-medium tracking-tight text-ink">
          {agentDisplayName(agent, t)}
        </span>
        <span className="flex shrink-0 items-center gap-2 text-caption tabular-nums text-ink-tertiary">
          {agent.tools.length > 0 && (
            <span>{t('artifact.toolsCount', { count: agent.tools.length })}</span>
          )}
          {typeof agent.totalTokens === 'number' && agent.totalTokens > 0 && (
            <span data-testid="agent-tokens">{t('artifact.tokens', { count: agent.totalTokens })}</span>
          )}
          <span className={cn(isError ? 'text-danger' : running ? 'text-accent' : undefined)}>
            {statusLabel}
          </span>
        </span>
      </button>

      {open && (
        <div
          className="mt-0.5 flex flex-col gap-1.5 border-l border-border pl-3 ml-[0.6875rem]"
          data-testid="agent-card-body"
        >
          {agent.messageId && (
            <button
              type="button"
              className="self-start text-caption text-accent transition-colors hover:text-accent-strong"
              onClick={jumpToTurn}
              data-testid="agent-jump-turn"
            >
              {t('artifact.jumpToTurn')}
            </button>
          )}
          {agent.taskInput && (
            <p className="text-meta leading-snug text-ink-secondary">
              <span className="text-ink-tertiary">
                {t('artifact.delegatedBy')} {t(ROLE_NAME_KEY.supervisor)} ·{' '}
              </span>
              {agent.taskInput}
            </p>
          )}
          {agent.reasoning && <ReasoningDisclosure content={agent.reasoning} />}
          {agent.tools.length > 0 && (
            <ToolTrace tools={agent.tools} onToolClick={agent.messageId ? jumpToTurn : undefined} />
          )}
          {isSubAgent && cleanOutput && (
            <OutputDisclosure content={cleanOutput} defaultOpen={false} />
          )}
        </div>
      )}
    </div>
  )
}
