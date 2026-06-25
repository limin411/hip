import type { EventStore, SessionEvent } from '../persistence/event-store.js'
import type { ReplayResult, ReplayMessage, ReplayToolCallSummary } from '@hip/protocol'

interface ParsedToolCall {
  callId: string
  name: string
  input: unknown
  output?: string
  error?: string
}

interface TurnGroup {
  userMessageEvent: SessionEvent | null
  responseEvents: SessionEvent[]
  turnId: string | null
}

export class SessionReplay {
  constructor(private readonly eventStore: EventStore) {}

  async replayTurn(sessionId: string, turnIndex: number): Promise<ReplayResult> {
    const events = this.eventStore.loadEvents(sessionId)

    if (events.length === 0) {
      throw new Error(`No events found for session ${sessionId}`)
    }

    // Phase 1: Identify turn boundaries.
    // A turn starts with a user_message event. Response events are those
    // between two user_message events (or after the last one).
    const userIndices: number[] = []
    for (let i = 0; i < events.length; i++) {
      if (events[i].type === 'user_message') userIndices.push(i)
    }

    if (userIndices.length === 0) {
      return { messages: [], toolCalls: [] }
    }

    if (turnIndex < 0 || turnIndex >= userIndices.length) {
      return { messages: [], toolCalls: [] }
    }

    // Phase 2: Extract the requested turn's events.
    const userIdx = userIndices[turnIndex]
    const nextUserIdx = turnIndex + 1 < userIndices.length ? userIndices[turnIndex + 1] : events.length

    const turnEvents = events.slice(userIdx, nextUserIdx)

    // Phase 3: Extract the turn's stepId from the first response event that carries one.
    let turnStepId: string | null = null
    for (const e of turnEvents) {
      const sid = extractStepId(e)
      if (sid !== null) {
        turnStepId = sid
        break
      }
    }

    // Phase 4: Reconstruct messages up to the start of this turn.
    const messages = buildMessagesUpTo(events, userIdx)

    // Phase 5: Extract agent response and tool calls for this turn.
    let agentResponse: string | undefined
    const toolCalls: ReplayToolCallSummary[] = []
    const seenToolCalls = new Map<string, ParsedToolCall>()

    for (const e of turnEvents) {
      // Only process events that belong to this turn's stepId.
      const sid = extractStepId(e)
      if (sid !== null && sid !== turnStepId) continue

      switch (e.type) {
        case 'text_ended':
          if (typeof e.data.content === 'string') {
            agentResponse = e.data.content
          }
          break
        case 'tool_called': {
          const callId = String(e.data.callId ?? '')
          const name = String(e.data.name ?? '')
          seenToolCalls.set(callId, {
            callId,
            name,
            input: tryParseInput(e.data.input),
          })
          break
        }
        case 'tool_success': {
          const callId = String(e.data.callId ?? '')
          const tc = seenToolCalls.get(callId)
          if (tc) tc.output = String(e.data.output ?? '')
          break
        }
        case 'tool_failed': {
          const callId = String(e.data.callId ?? '')
          const tc = seenToolCalls.get(callId)
          if (tc) tc.error = String(e.data.error ?? '')
          break
        }
      }
    }

    for (const tc of seenToolCalls.values()) {
      toolCalls.push({
        name: tc.name,
        input: tc.input,
        ...(tc.output !== undefined ? { output: tc.output } : {}),
        ...(tc.error !== undefined ? { error: tc.error } : {}),
      })
    }

    return { messages, ...(agentResponse !== undefined ? { agentResponse } : {}), toolCalls }
  }
}

function extractStepId(event: SessionEvent): string | null {
  const stepId = event.data.stepId
  if (typeof stepId === 'string' && stepId.length > 0) return stepId

  // user_message events don't carry stepId, but their messageId identifies the user input.
  // step_started/step_ended store stepId directly.
  return null
}

function buildMessagesUpTo(events: SessionEvent[], upToIndex: number): ReplayMessage[] {
  const messages: ReplayMessage[] = []
  const seenStepIds = new Set<string>()
  let pendingUserContent: string | null = null

  for (let i = 0; i < upToIndex; i++) {
    const e = events[i]

    if (e.type === 'user_message') {
      // Flush any pending user message
      if (pendingUserContent !== null) {
        messages.push({ type: 'human', content: pendingUserContent })
        pendingUserContent = null
      }
      if (typeof e.data.content === 'string') {
        pendingUserContent = e.data.content
      }
      continue
    }

    // Collect the stepId for response grouping.
    const sid = extractStepId(e)
    if (sid === null) continue
    if (seenStepIds.has(sid)) continue

    if (e.type === 'text_ended') {
      // Flush the pending user message first.
      if (pendingUserContent !== null) {
        messages.push({ type: 'human', content: pendingUserContent })
        pendingUserContent = null
      }
      seenStepIds.add(sid)
      const content = typeof e.data.content === 'string' ? e.data.content : ''
      messages.push({ type: 'ai', content })
    }
  }

  // Flush any remaining user message
  if (pendingUserContent !== null) {
    messages.push({ type: 'human', content: pendingUserContent })
  }

  return messages
}

function tryParseInput(input: unknown): unknown {
  if (typeof input === 'string') {
    try {
      return JSON.parse(input)
    } catch {
      return input
    }
  }
  return input
}
