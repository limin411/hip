import type { ServerMessage } from '@hip/protocol'
import { logInfo } from '../debug-logger.js'

type ForcePlanHost = {
  id: string
  _config: { forcePlan?: boolean }
  configMgr: { setForcePlan: (forcePlan: boolean) => boolean }
  store?: { updateConfig: (sessionId: string, configJson: string) => void }
}

type SendFn = (msg: ServerMessage) => void

/**
 * One-shot forcePlan: clear so the next turn is not re-gated into PlanMode.
 * Called on plan ready (submit), approve/reject, and soft-approve resume.
 */
export function clearForcePlanFlag(host: ForcePlanHost, send: SendFn, reason = 'plan_gate'): void {
  if (!host._config.forcePlan) {
    logInfo('session', 'forcePlan:clear_skip', { sessionId: host.id, reason, alreadyClear: true })
    return
  }
  const applied = host.configMgr.setForcePlan(false)
  if (!applied) {
    // Should be rare now (clear is allowed while running); still surface for postmortems.
    logInfo('session', 'forcePlan:clear_failed', {
      sessionId: host.id,
      reason,
      stillForcePlan: Boolean(host._config.forcePlan),
    })
    return
  }
  if (host.store) {
    try {
      host.store.updateConfig(host.id, JSON.stringify(host._config))
    } catch {
      // best-effort persist
    }
  }
  send({ type: 'session:forcePlan', sessionId: host.id, forcePlan: false })
  logInfo('session', 'forcePlan:cleared', { sessionId: host.id, reason })
}
