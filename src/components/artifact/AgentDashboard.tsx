import { useTranslation } from 'react-i18next'
import { Bot } from 'lucide-react'
import type { Message } from '@hip/protocol'
import { useActiveMessages, useActiveSessionStatus } from '@/domain'
import { groupAllAgents, type GroupedTurn, type TurnAgent } from '@/lib/turnAgents'
import { formatClockTime } from '@/lib/datetime'
import { cn } from '@/lib/utils'
import { useFocusStore } from '@/store/focusStore'
import { EmptyState } from '@/components/ui/EmptyState'
import type { RoundtableMeta } from '@hip/protocol'
import {
  councilEdges,
  deriveCouncilDiscussionRound,
  mergeCouncilRoster,
  type CouncilRosterSeat,
} from '@/lib/roundtableCouncil'
import { AgentCard } from './AgentCard'
import { CollaborationStructure } from './CollaborationStructure'
import { CouncilEdges } from './CouncilEdges'

export function AgentDashboard() {
  const { t, i18n } = useTranslation()
  const messages: Message[] = useActiveMessages()
  const status = useActiveSessionStatus()
  const live = status === 'running'
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const focusedAgentId = useFocusStore((s) => s.focusedAgentId)

  const turns: GroupedTurn[] = groupAllAgents(messages, status)
  // Only the latest turn / stage — older history is in the main transcript.
  const latest = turns.length > 0 ? turns[turns.length - 1]! : null
  const latestMsg =
    latest != null
      ? messages.find((m) => m.id === latest.messageId) ??
        [...messages].reverse().find((m) => m.role === 'assistant')
      : null
  const rtMeta = latestMsg?.roundtable
  const agents = latest?.agents ?? []
  const roster = mergeCouncilRoster(agents, rtMeta)
  const edges = councilEdges(rtMeta)

  // ── Council-only layout (roundtable multi-agent). Does not affect normal Chat/Code. ──
  if (roster) {
    return (
      <CouncilAgentsView
        latest={latest}
        live={live}
        locale={locale}
        roster={roster}
        edges={edges}
        focusedAgentId={focusedAgentId}
        content={latestMsg?.content ?? ''}
        rtMeta={rtMeta}
      />
    )
  }

  if (!latest) {
    return (
      <div className="flex h-full items-center justify-center p-4" data-testid="agents-empty">
        <EmptyState
          icon={Bot}
          title={t('artifact.agentsEmpty')}
          description={
            live
              ? t('artifact.agentsEmptyLive', {
                  defaultValue: 'Agents will appear here as the turn starts…',
                })
              : t('artifact.agentsEmptyDesc')
          }
        />
      </div>
    )
  }

  // ── Default Agents layout (unchanged for normal Chat / Code / task sub-agents) ──
  const turnLive = live
  const liveRunning = agents.find((a) => a.status === 'running')
  const liveTool = liveRunning?.tools.find((tc) => tc.status === 'running')
  const supervisor = agents.find((a) => a.role === 'supervisor')
  const children = agents.filter((a) => a.role !== 'supervisor')
  const childCount = children.length

  const turnMeta = [
    t('artifact.turn', { n: latest.turnIndex }),
    formatClockTime(latest.timestamp, locale),
    childCount > 0 ? t('artifact.subAgentCount', { count: childCount }) : null,
    liveRunning
      ? t('artifact.agentsLiveRunning', {
          defaultValue: 'Running: {{name}}',
          name: liveRunning.name || liveRunning.role,
        })
      : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="agents-dashboard">
      <div className="flex h-8 shrink-0 items-center justify-between gap-2 px-3">
        <p className="min-w-0 truncate text-caption font-medium text-ink-tertiary">{turnMeta}</p>
        {live && liveRunning && (
          <span className="flex shrink-0 items-center gap-1.5 text-caption text-accent">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" aria-hidden />
            live
          </span>
        )}
      </div>

      {live && liveRunning && (
        <div
          className="flex shrink-0 items-center gap-2 px-3 pb-2 text-meta"
          data-testid="agent-live-strip"
        >
          <span className="min-w-0 flex-1 truncate text-ink-secondary">
            <span className="font-medium text-ink">
              {liveRunning.taskInput?.trim() || liveRunning.name?.trim() || liveRunning.role}
            </span>
            {liveTool ? <span className="text-ink-tertiary"> · {liveTool.name}</span> : null}
          </span>
        </div>
      )}

      <div
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-2.5 pb-3"
        data-testid="agents-live-turn"
      >
        {children.length > 0 && <CollaborationStructure agents={agents} live={turnLive} />}

        {supervisor && (
          <div
            data-focus-highlight={focusedAgentId === supervisor.agentId ? 'true' : undefined}
            className={cn(focusedAgentId === supervisor.agentId && 'text-ink')}
          >
            <AgentCard agent={supervisor} live={turnLive} />
          </div>
        )}

        {children.length > 0 ? (
          <div className="flex flex-col gap-1">
            <div className="px-1.5 pt-1 text-caption font-medium text-ink-tertiary">
              {t('artifact.subAgents')}
            </div>
            {children.map((agent) => (
              <div
                key={agent.agentId}
                data-focus-highlight={focusedAgentId === agent.agentId ? 'true' : undefined}
              >
                <AgentCard agent={agent} live={turnLive} />
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** Compact roundtable council roster — no tree / live-stage / supervisor chrome. */
function CouncilAgentsView({
  latest,
  live,
  locale,
  roster,
  edges,
  focusedAgentId,
  content,
  rtMeta,
}: {
  latest: GroupedTurn | null
  live: boolean
  locale: string
  roster: CouncilRosterSeat[]
  edges: ReturnType<typeof councilEdges>
  focusedAgentId: string | null
  content: string
  rtMeta?: RoundtableMeta | null
}) {
  const { t } = useTranslation()
  const speaking = roster.filter((s) => s.status === 'running')
  const spoken = roster.filter((s) => s.status !== 'waiting').length
  // Discussion round (1..N), not the chat turn index (always 1 for a single meeting).
  const discussion = deriveCouncilDiscussionRound(rtMeta, content)
  const roundLabel =
    discussion && discussion.current > 0
      ? discussion.planned != null && discussion.planned > 0
        ? t('chat.roundtable.councilRoundOf', {
            n: discussion.current,
            total: discussion.planned,
          })
        : t('chat.roundtable.councilRound', { n: discussion.current })
      : discussion?.planned != null
        ? t('chat.roundtable.councilRoundPlanned', { total: discussion.planned })
        : null

  const turnMeta = [
    t('chat.roundtable.councilLabel'),
    roundLabel,
    latest ? formatClockTime(latest.timestamp, locale) : null,
    t('chat.roundtable.councilProgress', {
      spoken,
      total: roster.length,
    }),
    speaking.length === 1
      ? t('artifact.agentsLiveRunning', {
          defaultValue: 'Running: {{name}}',
          name: speaking[0]!.agent?.name || t(speaking[0]!.nameKey),
        })
      : speaking.length > 1
        ? t('chat.roundtable.liveStage', { count: speaking.length })
        : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="agents-dashboard">
      <div className="flex h-8 shrink-0 items-center justify-between gap-2 px-3">
        <p className="min-w-0 truncate text-caption font-medium text-ink-tertiary">{turnMeta}</p>
        {live && speaking.length > 0 && (
          <span className="flex shrink-0 items-center gap-1.5 text-caption text-accent">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" aria-hidden />
            live
          </span>
        )}
      </div>

      <div
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto px-2.5 pb-3"
        data-testid="agents-live-turn"
      >
        {edges.length > 0 && <CouncilEdges edges={edges} />}

        <div className="flex flex-col gap-0.5" data-testid="council-roster">
          {roster.map((seat) => (
            <CouncilSeatRow
              key={seat.agentId}
              seat={seat}
              live={live}
              focused={focusedAgentId === seat.agentId}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function CouncilSeatRow({
  seat,
  live,
  focused,
}: {
  seat: CouncilRosterSeat
  live: boolean
  focused: boolean
}) {
  const { t } = useTranslation()
  const waiting = seat.status === 'waiting'
  const name = seat.agent?.name || t(seat.nameKey)

  if (waiting) {
    return (
      <div
        data-testid={`council-seat-${seat.persona}`}
        data-focus-highlight={focused ? 'true' : undefined}
        className="flex min-h-[var(--trail-min-h)] items-center gap-2 px-1.5 py-1 opacity-55"
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ink-tertiary/40" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-meta font-medium text-ink-secondary">
          {name}
        </span>
        <span className="shrink-0 text-caption text-ink-tertiary">
          {t('chat.roundtable.seatWaiting')}
        </span>
      </div>
    )
  }

  const base = seat.agent
  if (!base) {
    // Defensive: non-waiting seats always have a run in mergeCouncilRoster.
    return null
  }
  const agent: TurnAgent = {
    ...base,
    name: base.name || name,
    // Avoid "Delegated by Supervisor · …" noise for council seats.
    taskInput: undefined,
  }

  return (
    <div
      data-testid={`council-seat-${seat.persona}`}
      data-focus-highlight={focused ? 'true' : undefined}
      className={cn(focused && 'text-ink')}
    >
      <AgentCard agent={agent} live={live} />
    </div>
  )
}
