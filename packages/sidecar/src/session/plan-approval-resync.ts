/**
 * Plan approval resync (design D4c.1 / PR-1.1 / PR-PA1).
 *
 * When a session is paused for plan approval, we persist a small marker on
 * SessionConfig so reload / ensureSession can restore awaitingResume + UI.
 * Full LangChain message history is rebuilt via Session.hydrate().
 *
 * Markdown (plan.md body) lives on the durable marker + plan:published only;
 * interrupt context stays lean { kind, plan } (KD-PA-5).
 */
import type { PlanItem, SessionConfig, ServerMessage } from '@hip/protocol'
import { PLAN_APPROVAL_QUESTION_TOKEN } from './plan-approval-constants.js'

type SendFn = (msg: ServerMessage) => void

export const PLAN_APPROVAL_PAUSE_KEY = '__hipPlanApprovalPause' as const

export type PlanApprovalPauseMarker = {
  turnId: string
  plan: PlanItem[]
  question: string
  /** Clipped plan.md body (optional; may be absent for todos-only planAutoReady). */
  markdown?: string
  planPath?: string
  markdownTruncated?: boolean
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
  const question =
    typeof raw.question === 'string' && raw.question ? raw.question : PLAN_APPROVAL_QUESTION_TOKEN
  const marker: PlanApprovalPauseMarker = { turnId: raw.turnId, plan: plan as PlanItem[], question }
  if (typeof raw.markdown === 'string' && raw.markdown.trim()) {
    marker.markdown = raw.markdown
    if (raw.markdownTruncated === true) marker.markdownTruncated = true
  }
  if (typeof raw.planPath === 'string' && raw.planPath) {
    marker.planPath = raw.planPath
  }
  return marker
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
 * Merge a rebuilt marker with an existing durable one, preferring existing
 * markdown fields so a plan-only rebuild never strips a rich marker (KD-PA-12).
 */
export function mergePlanApprovalPauseMarker(
  durable: PlanApprovalPauseMarker | null | undefined,
  next: PlanApprovalPauseMarker,
): PlanApprovalPauseMarker {
  const markdown = next.markdown?.trim()
    ? next.markdown
    : durable?.markdown?.trim()
      ? durable.markdown
      : undefined
  const planPath = next.planPath || durable?.planPath
  const markdownTruncated =
    markdown && next.markdown?.trim()
      ? Boolean(next.markdownTruncated)
      : markdown && durable?.markdown?.trim()
        ? Boolean(durable.markdownTruncated)
        : undefined

  return {
    turnId: next.turnId || durable?.turnId || next.turnId,
    plan: next.plan?.length ? next.plan : (durable?.plan ?? next.plan ?? []),
    question: next.question || durable?.question || next.question,
    ...(markdown?.trim() ? { markdown, markdownTruncated: Boolean(markdownTruncated) } : {}),
    ...(planPath ? { planPath } : {}),
  }
}

/**
 * After session:loaded (which clears FE pending), replay plan:published + interrupt
 * so the sticky approval panel returns. plan:published carries markdown when present;
 * interrupt context stays lean (KD-PA-5).
 */
export function emitPlanApprovalResync(
  send: SendFn,
  sessionId: string,
  marker: PlanApprovalPauseMarker,
): void {
  const markdown = marker.markdown?.trim() ? marker.markdown : undefined
  const published: Extract<ServerMessage, { type: 'plan:published' }> = {
    type: 'plan:published',
    sessionId,
    turnId: marker.turnId,
    plan: marker.plan ?? [],
    ...(markdown
      ? { markdown, markdownTruncated: Boolean(marker.markdownTruncated) }
      : {}),
    ...(marker.planPath ? { planPath: marker.planPath } : {}),
  }
  const msgs: ServerMessage[] = [
    published,
    {
      type: 'agent:interrupt',
      sessionId,
      turnId: marker.turnId,
      agentId: 'supervisor',
      question: marker.question,
      // Lean context — no markdown (KD-PA-5)
      context: JSON.stringify({ kind: 'plan_approval', plan: marker.plan ?? [] }),
    },
  ]
  for (const m of msgs) send(m)
}
