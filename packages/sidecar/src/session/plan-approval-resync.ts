/**
 * Plan approval resync (design D4c.1 / PR-1.1).
 *
 * When a session is paused for plan approval, we persist a small marker on
 * SessionConfig so reload / ensureSession can restore awaitingResume + UI.
 * Full LangChain message history is rebuilt via Session.hydrate().
 */
import type { PlanItem, SessionConfig, ServerMessage } from '@hip/protocol'

type SendFn = (msg: ServerMessage) => void

export const PLAN_APPROVAL_PAUSE_KEY = '__hipPlanApprovalPause' as const

export type PlanApprovalPauseMarker = {
  turnId: string
  plan: PlanItem[]
  question: string
}

export type ConfigWithPlanPause = SessionConfig & {
  [PLAN_APPROVAL_PAUSE_KEY]?: PlanApprovalPauseMarker
}

export function readPlanApprovalPause(config: SessionConfig | undefined | null): PlanApprovalPauseMarker | null {
  if (!config || typeof config !== 'object') return null
  const raw = (config as ConfigWithPlanPause)[PLAN_APPROVAL_PAUSE_KEY]
  if (!raw || typeof raw !== 'object') return null
  if (typeof raw.turnId !== 'string' || !raw.turnId) return null
  const plan = Array.isArray(raw.plan) ? raw.plan : []
  const question = typeof raw.question === 'string' && raw.question ? raw.question : 'Approve this plan?'
  return { turnId: raw.turnId, plan: plan as PlanItem[], question }
}

/** Strip internal pause marker before echoing config to the UI. */
export function stripPlanApprovalPause(config: SessionConfig): SessionConfig {
  if (!(PLAN_APPROVAL_PAUSE_KEY in (config as ConfigWithPlanPause))) return config
  const { [PLAN_APPROVAL_PAUSE_KEY]: _drop, ...rest } = config as ConfigWithPlanPause
  return rest
}

export function withPlanApprovalPause(
  config: SessionConfig,
  marker: PlanApprovalPauseMarker,
): SessionConfig {
  return { ...config, [PLAN_APPROVAL_PAUSE_KEY]: marker } as SessionConfig
}

export function withoutPlanApprovalPause(config: SessionConfig): SessionConfig {
  return stripPlanApprovalPause(config)
}

/**
 * After session:loaded (which clears FE pending), replay plan:published + interrupt
 * so the sticky approval panel returns.
 */
export function emitPlanApprovalResync(
  send: SendFn,
  sessionId: string,
  marker: PlanApprovalPauseMarker,
): void {
  const msgs: ServerMessage[] = [
    {
      type: 'plan:published',
      sessionId,
      turnId: marker.turnId,
      plan: marker.plan ?? [],
    },
    {
      type: 'agent:interrupt',
      sessionId,
      turnId: marker.turnId,
      agentId: 'supervisor',
      question: marker.question,
      context: JSON.stringify({ kind: 'plan_approval', plan: marker.plan ?? [] }),
    },
  ]
  for (const m of msgs) send(m)
}
