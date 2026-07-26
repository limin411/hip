/** Dual-write session event persistence + turn finalize helpers. */
import type {
  ServerMessage,
  SessionConfig,
  AgentRun,
  SessionEvent,
  TimelineStep,
  TurnUsage,
  MemoryCitation,
  RoundtableMeta,
} from '@hip/protocol'
import { AIMessage, AIMessageChunk, type BaseMessage } from '@langchain/core/messages'
import { contentFromTimeline, trajectoryToRuns, trajectoryToTimeline, type TraceRun } from './tool-trace.js'
import { verifyWrites } from './verify.js'
import { sumUsage } from './usage.js'
import type { SessionStore } from '../persistence/store.js'
import type { EventStore, SnapshotStore } from '../persistence/event-store.js'
import { saveSessionSnapshot } from '../persistence/event-store.js'
import { projectEvent } from '../persistence/message-projector.js'
import { sessionEventToEventData } from './session-message-codec.js'
import { logInfo } from '../debug-logger.js'
import { parseMemoryCitations, bumpMemoryUseCounts } from '../memory/citations.js'
import type { MemoryService } from '../memory/service.js'

type SendFn = (msg: ServerMessage) => void

export interface PersistDeps {
  id: string
  store?: SessionStore
  eventStore?: EventStore
  snapshotStore?: SnapshotStore
  config: SessionConfig
  messages: BaseMessage[]
  /** Optional; used to bump memory use_count on citation parse at finalize. */
  memoryService?: MemoryService
  /** Memory ids injected this turn — gate for inline [mem:id] citations. */
  memoryIdsInjectedThisTurn?: Set<string>
}

export function emitSessionEvent(
  deps: PersistDeps,
  event: SessionEvent,
  context?: {
    stepId?: string
    usage?: TurnUsage
    runs?: AgentRun[]
    assistant?: {
      id: string
      sessionId: string
      agentId: string
      content: string
      timestamp: number
      stopped?: boolean
      timeline?: TimelineStep[]
      memoryCitations?: MemoryCitation[]
      roundtable?: RoundtableMeta
    } | null
  },
): void {
  if (!deps.store || !deps.eventStore) return
  const db = deps.store.getDb()
  db.exec('BEGIN')
  try {
    switch (event.type) {
      case 'user_message':
        deps.store.insertMessage({
          id: event.messageId,
          sessionId: event.sessionId,
          role: 'user',
          agentId: null,
          content: event.content,
          timestamp: event.timestamp,
          attachments: event.attachments,
        })
        deps.store.touchSession(event.sessionId, event.timestamp)
        break
      case 'step_ended':
        if (event.agentId === 'supervisor' && context?.assistant !== undefined) {
          deps.store.insertTurnBody(context.assistant, event.sessionId, context.runs ?? [])
        }
        break
    }

    const data = sessionEventToEventData(event, context)
    const published = deps.eventStore.append(event.sessionId, event.type, data)
    projectEvent(db, published)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

export function finalizeAndPersistTurn(
  deps: PersistDeps,
  send: SendFn,
  turnId: string,
  supervisorText: string,
  trajectory: Map<string, TraceRun>,
  stopped: boolean,
  usageByAgent?: Map<string, TurnUsage>,
  targetMessages: BaseMessage[] = deps.messages,
  extras?: { roundtable?: RoundtableMeta },
): string {
  // Authoritative body: join supervisor text steps when present (KD-17); else legacy supervisorText
  // (ACP / turns without TextBurstTracker). Preserve stop/error suffixes the caller appended.
  const timeline = trajectoryToTimeline(trajectory)
  const joined = contentFromTimeline(timeline)
  const hasTextSteps = timeline.some((s) => s.kind === 'text')
  let bodySource = supervisorText
  if (hasTextSteps) {
    if (supervisorText.startsWith(joined) && supervisorText.length >= joined.length) {
      bodySource = supervisorText // includes optional cancelled/timeout/error suffix
    } else {
      bodySource = joined
    }
  }
  const { citations, strippedContent } = parseMemoryCitations(
    bodySource,
    deps.memoryIdsInjectedThisTurn,
  )
  const memoryCitations = citations.length ? citations : undefined
  if (memoryCitations && deps.memoryService) {
    bumpMemoryUseCounts(deps.memoryService.store, memoryCitations.map((c) => c.memoryId))
  }
  const { correction } = verifyWrites(trajectory, strippedContent, deps.config.language ?? 'en')
  const finalText = correction ? `${strippedContent}\n\n${correction}` : strippedContent
  const last = targetMessages[targetMessages.length - 1]
  // Replace the last AI message when it matches either the raw (pre-strip) or stripped body.
  if (
    (last instanceof AIMessage || last instanceof AIMessageChunk) &&
    typeof last.content === 'string' &&
    (last.content === supervisorText || last.content === bodySource || last.content === strippedContent) &&
    finalText
  ) {
    targetMessages[targetMessages.length - 1] = new AIMessage(finalText)
  } else if (finalText) {
    targetMessages.push(new AIMessage(finalText))
  }
  const ts = Date.now()
  const runs: AgentRun[] = trajectoryToRuns(trajectory).map((r) => {
    const u = usageByAgent?.get(r.agentId)
    return { ...r, messageId: turnId, ...(u ? { usage: u } : {}) }
  })
  const turnUsage = sumUsage(runs.map((r) => r.usage))
  const toolCalls = runs.flatMap((r) => r.toolCalls ?? []).sort((a, b) => a.seq - b.seq)
  if (deps.store) {
    emitSessionEvent(deps, { type: 'text_ended', sessionId: deps.id, messageId: turnId, content: finalText, timestamp: ts })
    // Always persist an assistant row when the turn produced text OR tool/timeline work.
    // Previously empty finalText (tool-only artifact turns) passed assistant:null, so
    // agent_runs.message_id stayed NULL and loadMessages dropped toolCalls on reload —
    // Chat ArtifactCards vanished after reopening the session.
    const hasWork = !!finalText || runs.length > 0 || timeline.length > 0
    emitSessionEvent(
      deps,
      { type: 'step_ended', sessionId: deps.id, turnId, agentId: 'supervisor', timestamp: ts },
      {
        usage: turnUsage,
        runs,
        assistant: hasWork
          ? {
              id: turnId,
              sessionId: deps.id,
              agentId: 'supervisor',
              content: finalText,
              timestamp: ts,
              stopped,
              timeline,
              ...(memoryCitations ? { memoryCitations } : {}),
              ...(extras?.roundtable ? { roundtable: extras.roundtable } : {}),
            }
          : null,
      },
    )
    deps.store.touchSession(deps.id, ts)
    if (deps.snapshotStore) {
      const latestSeq = deps.eventStore?.latestSeq(deps.id) ?? 0
      saveSessionSnapshot(deps.snapshotStore, deps.id, latestSeq, {
        messages: targetMessages,
        config: deps.config,
        usageByAgent: usageByAgent ? Object.fromEntries(usageByAgent) : undefined,
      })
    }
  }
  logInfo('session', 'message:complete', { sessionId: deps.id, turnId, textLen: finalText.length, stopped })
  send({
    type: 'message:complete',
    sessionId: deps.id,
    message: {
      id: turnId,
      role: 'assistant',
      content: finalText,
      agentId: 'supervisor',
      timestamp: ts,
      timeline,
      toolCalls,
      agentRuns: runs,
      ...(turnUsage ? { usage: turnUsage } : {}),
      ...(stopped ? { stopped: true } : {}),
      ...(memoryCitations ? { memoryCitations } : {}),
      ...(extras?.roundtable ? { roundtable: extras.roundtable } : {}),
    },
  })
  return finalText
}
