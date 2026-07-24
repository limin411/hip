import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TurnAgent } from '@/lib/turnAgents'
import { ROLE_COLOR, agentDisplayName } from '@/lib/roleColor'
import { cn } from '@/lib/utils'
import { SubAgentCard } from './SubAgentCard'

/**
 * Parallel sub-agent lanes (craft upgrade PR-4).
 * Local selection only; clear when parent collapses (via remount or open prop).
 */
export function SubAgentLanes({
  agents,
  showTools,
  expanded,
}: {
  agents: TurnAgent[]
  showTools?: boolean
  /** When false, selection is cleared (ActivityBar collapsed). */
  expanded: boolean
}) {
  const { t } = useTranslation()
  const defaultId =
    agents.find((a) => a.status === 'running')?.agentId ?? agents[0]?.agentId ?? null
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(defaultId)

  useEffect(() => {
    if (!expanded) {
      setSelectedAgentId(null)
      return
    }
    setSelectedAgentId((prev) => {
      if (prev && agents.some((a) => a.agentId === prev)) return prev
      return agents.find((a) => a.status === 'running')?.agentId ?? agents[0]?.agentId ?? null
    })
  }, [expanded, agents])

  if (agents.length < 2) {
    const only = agents[0]
    if (!only) return null
    return <SubAgentCard agent={only} showTools={showTools} />
  }

  if (!expanded) return null

  const selected =
    agents.find((a) => a.agentId === selectedAgentId) ?? agents[0]!

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const delta = e.key === 'ArrowRight' ? 1 : -1
    const next = (index + delta + agents.length) % agents.length
    setSelectedAgentId(agents[next]!.agentId)
  }

  return (
    <div className="min-w-0" data-testid="subagent-lanes">
      <div
        role="tablist"
        aria-label={t('chat.subagent.lanesAria')}
        className="mb-1.5 flex flex-wrap gap-1"
        data-testid="subagent-lane-strip"
      >
        {agents.map((a, i) => {
          const selectedLane = a.agentId === selected.agentId
          const rail = ROLE_COLOR[a.role] ?? ROLE_COLOR.subagent
          const running = a.status === 'running'
          return (
            <button
              key={a.agentId}
              type="button"
              role="tab"
              aria-selected={selectedLane}
              tabIndex={selectedLane ? 0 : -1}
              data-testid={`subagent-lane-${a.agentId}`}
              onClick={() => setSelectedAgentId(a.agentId)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn(
                'inline-flex max-w-[10rem] items-center gap-1.5 rounded-md px-2 py-1 text-meta transition-colors duration-chrome',
                selectedLane
                  ? 'bg-state-hover text-ink'
                  : 'text-ink-tertiary hover:bg-state-hover hover:text-ink-secondary',
              )}
            >
              <span
                className={cn(
                  'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
                  running && 'animate-pulse',
                )}
                style={{ background: rail }}
                aria-hidden
              />
              <span className="min-w-0 truncate">{agentDisplayName(a, t)}</span>
            </button>
          )
        })}
      </div>
      <div
        role="tabpanel"
        aria-labelledby={selected.agentId}
        data-testid="subagent-lane-panel"
      >
        <SubAgentCard
          agent={selected}
          showTools={!!showTools || selected.status === 'running'}
        />
      </div>
    </div>
  )
}
