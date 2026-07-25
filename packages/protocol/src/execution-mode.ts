/**
 * Collaboration / interruption policy for a code turn.
 * Autopilot is only valid when permissionMode === 'full'.
 */
import type { PermissionMode } from './session-core.js'

export type ExecutionMode = 'interactive' | 'plan' | 'autopilot'

export const EXECUTION_MODES: readonly ExecutionMode[] = ['interactive', 'plan', 'autopilot'] as const

export function isExecutionMode(v: unknown): v is ExecutionMode {
  return v === 'interactive' || v === 'plan' || v === 'autopilot'
}

/**
 * Resolve effective execution mode from config fields.
 * Legacy: missing executionMode ⇒ forcePlan ? plan : interactive.
 * Invariant: autopilot requires permissionMode === 'full' (else coerce to interactive).
 */
export function resolveExecutionMode(cfg: {
  executionMode?: ExecutionMode
  forcePlan?: boolean
  permissionMode?: PermissionMode
}): ExecutionMode {
  let mode: ExecutionMode
  if (isExecutionMode(cfg.executionMode)) {
    mode = cfg.executionMode
  } else {
    mode = cfg.forcePlan ? 'plan' : 'interactive'
  }
  if (mode === 'autopilot' && (cfg.permissionMode ?? 'edit') !== 'full') {
    return 'interactive'
  }
  return mode
}

export function canSelectAutopilot(permissionMode: PermissionMode | undefined): boolean {
  return (permissionMode ?? 'edit') === 'full'
}

export function forcePlanFromExecutionMode(mode: ExecutionMode): boolean {
  return mode === 'plan'
}

export function isAutopilot(mode: ExecutionMode): boolean {
  return mode === 'autopilot'
}

/** Dual-write patch when setting execution mode (caller enforces autopilot+full). */
export function executionModeConfigPatch(mode: ExecutionMode): {
  executionMode: ExecutionMode
  forcePlan: boolean
  disablePlan?: false
} {
  if (mode === 'plan') {
    return { executionMode: 'plan', forcePlan: true, disablePlan: false }
  }
  return { executionMode: mode, forcePlan: false }
}
