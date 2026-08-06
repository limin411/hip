/**
 * Goal attach / wire helpers for Session (M5 extract).
 */
import type { ServerMessage } from '@hip/protocol'
import type { SessionStore } from '../persistence/store.js'
import type { GoalManager } from './goal.js'
import type { Goal } from './goal-types.js'
import { goalToWire } from './goal-types.js'
import { logInfo } from '../debug-logger.js'

export type GoalSendFn = (msg: ServerMessage) => void

/** Wire GoalManager persist + hydrate from SQLite. */
export function attachGoalPersistence(
  goalManager: GoalManager,
  store: SessionStore,
  sessionId: string,
): void {
  goalManager.setPersist((goal) => {
    try {
      store.saveSessionGoal(sessionId, goal ? JSON.stringify(goal) : null)
    } catch (e) {
      logInfo('session', 'goal:persist-failed', {
        sessionId,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  })
  try {
    const raw = store.loadSessionGoal(sessionId)
    if (!raw) return
    const parsed = JSON.parse(raw) as Goal
    if (parsed && typeof parsed.id === 'string' && typeof parsed.description === 'string') {
      goalManager.hydrate(parsed)
    }
  } catch {
    /* ignore corrupt goal */
  }
}

export function emitGoalUpdatedMessage(
  send: GoalSendFn,
  sessionId: string,
  goalManager: GoalManager,
): void {
  send({
    type: 'goal:updated',
    sessionId,
    goal: goalToWire(goalManager.getStatus()),
  })
}
