import type { PermissionOption } from '@hip/protocol'
import type { HitlMode } from '../types.js'

/**
 * Pick optionId for hitl=auto (design OptionId algorithm).
 * Returns null if no allow-like option → treat as fail.
 */
export function pickAllowOptionId(options: PermissionOption[] | undefined): string | null {
  if (!options?.length) return null
  const byKind = options.find((o) => typeof o.kind === 'string' && o.kind.startsWith('allow'))
  if (byKind?.optionId) return byKind.optionId
  const allowIds = new Set(['allow_once', 'allow', 'once', 'approve'])
  const byId = options.find((o) => allowIds.has(o.optionId))
  if (byId) return byId.optionId
  return null
}

export function parseInterruptContextKind(context?: string): string | undefined {
  if (!context?.trim()) return undefined
  try {
    const obj = JSON.parse(context) as unknown
    if (obj && typeof obj === 'object' && typeof (obj as { kind?: unknown }).kind === 'string') {
      return (obj as { kind: string }).kind
    }
  } catch {
    /* not JSON */
  }
  return undefined
}

export interface HitlDecision {
  /** wait = leave request open for another client (GUI); do not finish the turn. */
  action: 'allow' | 'block' | 'await_user' | 'prompt' | 'wait'
  optionId?: string
  status?: 'hitl_blocked' | 'awaiting_user'
  reason?: string
}

/** Mid-turn permission:request policy. */
export function decidePermissionHitl(
  hitl: HitlMode,
  options: PermissionOption[] | undefined,
  isTty: boolean,
  /** When true (product attach + gui client present), wait for any client — do not steal TTY first. */
  guiPresent = false,
): HitlDecision {
  if (hitl === 'fail') {
    return { action: 'block', status: 'hitl_blocked', reason: 'permission:request rejected by hitl=fail' }
  }
  if (hitl === 'prompt') {
    if (guiPresent) {
      // Wait for GUI (or any client) permission:respond — CLI does not auto-respond or finish.
      return { action: 'wait', reason: 'waiting for GUI permission response' }
    }
    if (!isTty) {
      return { action: 'block', status: 'awaiting_user', reason: 'hitl=prompt requires TTY or running hip app GUI' }
    }
    return { action: 'prompt' }
  }
  // auto — intentionally bypasses GUI approval (document in README)
  const optionId = pickAllowOptionId(options)
  if (!optionId) {
    return { action: 'block', status: 'hitl_blocked', reason: 'no allow-like permission option' }
  }
  return { action: 'allow', optionId }
}

/** Post-complete agent:interrupt policy. */
export function decideInterruptHitl(
  hitl: HitlMode,
  contextKind: string | undefined,
  planApprovalsUsed: number,
  maxPlanApprovals: number,
  isTty: boolean,
): HitlDecision {
  const isPlan = contextKind === 'plan_approval'

  if (hitl === 'fail') {
    return {
      action: 'block',
      status: 'hitl_blocked',
      reason: isPlan ? 'plan_approval rejected by hitl=fail' : 'interrupt rejected by hitl=fail',
    }
  }

  if (hitl === 'prompt') {
    if (!isTty) {
      return { action: 'block', status: 'awaiting_user', reason: 'hitl=prompt requires TTY for interrupt' }
    }
    return { action: 'prompt' }
  }

  // auto
  if (isPlan) {
    if (planApprovalsUsed < maxPlanApprovals) {
      return { action: 'allow', reason: 'plan_approval auto-approve' }
    }
    return {
      action: 'block',
      status: 'awaiting_user',
      reason: 'maxPlanApprovals exhausted',
    }
  }

  return {
    action: 'block',
    status: 'awaiting_user',
    reason: 'non-plan interrupt under hitl=auto',
  }
}
