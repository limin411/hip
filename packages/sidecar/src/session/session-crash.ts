/**
 * Crash recovery for Session (M5 extract — behavior unchanged).
 * Marks running tool calls as interrupted and optionally warm-starts messages from snapshot.
 */
import type { BaseMessage } from '@langchain/core/messages'
import type { SessionEvent } from '@hip/protocol'
import type { SessionStore } from '../persistence/store.js'
import type { EventStore, SnapshotStore } from '../persistence/event-store.js'
import { loadSessionSnapshot, hasValidToolCallPairing } from '../persistence/event-store.js'
import { loadProjection } from '../persistence/message-projector.js'
import { isAssistantStep } from '../persistence/message-types.js'

export type CrashEmitFn = (
  event: SessionEvent,
  context?: { stepId?: string },
) => void

export interface CrashRecoveryDeps {
  sessionId: string
  store?: SessionStore
  eventStore?: EventStore
  snapshotStore?: SnapshotStore
  messages: BaseMessage[]
  emit: CrashEmitFn
}

export function findRunningToolCalls(
  store: SessionStore | undefined,
  sessionId: string,
): Array<{ callId: string; stepId: string }> {
  if (!store) return []
  const rows = loadProjection(store.getDb(), sessionId)
  const running: Array<{ callId: string; stepId: string }> = []
  for (const row of rows) {
    if (!isAssistantStep(row.data)) continue
    for (const tc of row.data.toolCalls) {
      if (tc.status === 'running') running.push({ callId: tc.callId, stepId: row.data.stepId })
    }
  }
  return running
}

/**
 * Silent crash recovery: mark dangling running tools failed, then warm-start
 * messages from a valid snapshot when present.
 */
export function recoverSessionFromCrash(deps: CrashRecoveryDeps): void {
  if (!deps.store || !deps.eventStore || !deps.snapshotStore) return

  const running = findRunningToolCalls(deps.store, deps.sessionId)
  for (const { callId, stepId } of running) {
    deps.emit(
      {
        type: 'tool_failed',
        sessionId: deps.sessionId,
        callId,
        error: 'interrupted by sidecar crash',
        timestamp: Date.now(),
      },
      { stepId },
    )
  }

  const snapshot = loadSessionSnapshot(deps.snapshotStore, deps.sessionId)
  if (
    snapshot != null &&
    snapshot.messages.length > 0 &&
    hasValidToolCallPairing(snapshot.messages)
  ) {
    deps.messages.length = 0
    deps.messages.push(...snapshot.messages)
  }
}
