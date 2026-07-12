import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { HookEvent } from '@hip/protocol'
import { cn } from '@/lib/utils'
import { HOOK_EVENT_DESC_KEYS, type LifecyclePhaseId } from './hookCatalog'

type NodeDef = {
  event: HookEvent
  /** Optional short label override; defaults to event name */
  short?: string
}

type PhaseDef = {
  id: LifecyclePhaseId
  nodes: NodeDef[]
  /** Nested tool-loop nodes rendered as a sub-flow */
  toolLoop?: NodeDef[]
}

const PHASES: PhaseDef[] = [
  {
    id: 'session',
    nodes: [{ event: 'SessionStart' }],
  },
  {
    id: 'turn',
    nodes: [
      { event: 'UserPromptSubmit' },
      { event: 'TurnStart' },
    ],
    toolLoop: [
      { event: 'PreToolUse' },
      { event: 'PermissionRequest' },
      { event: 'PostToolUse' },
      { event: 'PostToolUseFailure' },
    ],
  },
  {
    id: 'turnEnd',
    nodes: [
      { event: 'Stop' },
      { event: 'TurnComplete' },
    ],
  },
  {
    id: 'activity',
    nodes: [
      { event: 'ActivityStart' },
      { event: 'ActivityBudgetRequest' },
      { event: 'ActivityEnd' },
    ],
  },
]

const PHASE_TITLE_KEYS = {
  session: 'settings.hooks.diagram.phaseSession',
  turn: 'settings.hooks.diagram.phaseTurn',
  turnEnd: 'settings.hooks.diagram.phaseTurnEnd',
  activity: 'settings.hooks.diagram.phaseActivity',
} as const

function FlowArrow({ className }: { className?: string }) {
  return (
    <div className={cn('flex justify-center py-1 text-ink-tertiary', className)} aria-hidden>
      <svg width="16" height="20" viewBox="0 0 16 20" fill="none">
        <path
          d="M8 2v14M8 16l-4-4M8 16l4-4"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )
}

function HookNode({
  event,
  configured,
  short,
}: {
  event: HookEvent
  configured: boolean
  short?: string
}) {
  const { t } = useTranslation()
  const title = t(HOOK_EVENT_DESC_KEYS[event])
  return (
    <div
      className={cn(
        'group relative min-w-0 rounded-md border px-2.5 py-1.5 text-center transition-colors',
        configured
          ? 'border-accent/50 bg-accent/10 text-accent-strong shadow-sm ring-1 ring-accent/20'
          : 'border-border bg-surface text-ink-secondary',
      )}
      data-testid={`hook-diagram-node-${event}`}
      data-configured={configured ? 'true' : 'false'}
      title={title}
    >
      <code className="block truncate font-mono text-caption font-medium leading-tight">
        {short ?? event}
      </code>
      {configured && (
        <span className="mt-0.5 block text-[10px] font-medium leading-none text-accent">
          {t('settings.hooks.diagram.configuredBadge')}
        </span>
      )}
    </div>
  )
}

export interface HookLifecycleDiagramProps {
  /** Set of HookEvent names that have at least one configured handler. */
  configuredEvents: ReadonlySet<string>
}

/**
 * Visual lifecycle map of hip agent hooks.
 * Highlighted nodes are present in installed plugin declarations (best-effort).
 */
export function HookLifecycleDiagram({ configuredEvents }: HookLifecycleDiagramProps) {
  const { t } = useTranslation()
  const isOn = (e: HookEvent) => configuredEvents.has(e)
  const configuredCount = PHASES.flatMap((p) => [
    ...p.nodes,
    ...(p.toolLoop ?? []),
  ]).filter((n) => isOn(n.event)).length

  return (
    <div
      className="rounded-lg border border-border bg-surface-subtle p-4"
      data-testid="hook-lifecycle-diagram"
      role="img"
      aria-label={t('settings.hooks.diagram.ariaLabel', { count: configuredCount })}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-meta font-semibold text-ink">{t('settings.hooks.diagram.title')}</div>
          <p className="mt-0.5 text-meta text-ink-tertiary">{t('settings.hooks.diagram.subtitle')}</p>
        </div>
        <div className="flex items-center gap-3 text-meta text-ink-tertiary">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-sm border border-accent/50 bg-accent/10" />
            {t('settings.hooks.diagram.legendConfigured')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-sm border border-border bg-surface" />
            {t('settings.hooks.diagram.legendAvailable')}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-0">
        {/* Session */}
        <PhaseCard phaseId="session" title={t(PHASE_TITLE_KEYS.session)}>
          <div className="grid grid-cols-1 gap-2 sm:max-w-xs">
            {PHASES[0].nodes.map((n) => (
              <HookNode key={n.event} event={n.event} configured={isOn(n.event)} />
            ))}
          </div>
        </PhaseCard>

        <FlowArrow />

        {/* Turn start */}
        <PhaseCard phaseId="turn" title={t(PHASE_TITLE_KEYS.turn)}>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:max-w-md">
            {PHASES[1].nodes.map((n) => (
              <HookNode key={n.event} event={n.event} configured={isOn(n.event)} />
            ))}
          </div>

          <div className="mt-3 rounded-md border border-dashed border-border bg-surface/60 p-3">
            <div className="mb-2 text-caption font-medium text-ink-tertiary">
              {t('settings.hooks.diagram.toolLoop')}
            </div>
            {/* Tool loop: Pre → Permission → branch Post/Fail */}
            <div className="flex flex-col items-stretch gap-1">
              <HookNode event="PreToolUse" configured={isOn('PreToolUse')} />
              <FlowArrow className="py-0.5" />
              <HookNode event="PermissionRequest" configured={isOn('PermissionRequest')} />
              <div className="flex justify-center py-1 text-caption text-ink-tertiary" aria-hidden>
                {t('settings.hooks.diagram.toolRuns')}
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="flex flex-col items-center gap-0.5">
                  <span className="text-[10px] text-success">{t('settings.hooks.diagram.successPath')}</span>
                  <HookNode event="PostToolUse" configured={isOn('PostToolUse')} />
                </div>
                <div className="flex flex-col items-center gap-0.5">
                  <span className="text-[10px] text-danger">{t('settings.hooks.diagram.failurePath')}</span>
                  <HookNode event="PostToolUseFailure" configured={isOn('PostToolUseFailure')} />
                </div>
              </div>
              <p className="mt-2 text-center text-[10px] text-ink-tertiary">
                {t('settings.hooks.diagram.toolLoopHint')}
              </p>
            </div>
          </div>
        </PhaseCard>

        <FlowArrow />

        {/* Turn end */}
        <PhaseCard phaseId="turnEnd" title={t(PHASE_TITLE_KEYS.turnEnd)}>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:max-w-md">
            {PHASES[2].nodes.map((n) => (
              <HookNode key={n.event} event={n.event} configured={isOn(n.event)} />
            ))}
          </div>
        </PhaseCard>

        <FlowArrow />

        {/* Activity sideband */}
        <PhaseCard phaseId="activity" title={t(PHASE_TITLE_KEYS.activity)}>
          <p className="mb-2 text-caption text-ink-tertiary">{t('settings.hooks.diagram.activityHint')}</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {PHASES[3].nodes.map((n) => (
              <HookNode key={n.event} event={n.event} configured={isOn(n.event)} />
            ))}
          </div>
        </PhaseCard>
      </div>
    </div>
  )
}

function PhaseCard({
  phaseId,
  title,
  children,
}: {
  phaseId: LifecyclePhaseId
  title: string
  children: ReactNode
}) {
  return (
    <div
      className="rounded-lg border border-border bg-surface p-3"
      data-testid={`hook-diagram-phase-${phaseId}`}
    >
      <div className="mb-2 text-caption font-semibold uppercase tracking-wide text-ink-tertiary">
        {title}
      </div>
      {children}
    </div>
  )
}
