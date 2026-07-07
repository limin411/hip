import type { BaseMessage } from '@langchain/core/messages'

export interface SlidingWindowConfig {
  /** Max number of recent turns to keep fully intact. */
  recentTurns: number
  /** Max total messages before the sliding window kicks in. */
  maxMessages: number
  /** When true, the first user message (task definition) is always preserved. */
  preserveFirstMessage: boolean
}

const DEFAULT: SlidingWindowConfig = {
  recentTurns: 5,
  maxMessages: 50,
  preserveFirstMessage: true,
}

/**
 * Apply a sliding window to a message array.
 *
 * Strategy: when the message count exceeds `maxMessages`, keep the first user
 * message (the task definition) plus the last N turns intact, and return the
 * remaining "middle" messages as `removed` for summarization.
 *
 * A "turn" starts with a HumanMessage and includes everything after it up to
 * (but not including) the next HumanMessage, or the end of the array.
 *
 * @returns `{ kept, removed }` — both are sub-arrays of the original `messages`.
 *          When under the limit, `kept` is a shallow copy of `messages` and
 *          `removed` is empty.
 */
export function applySlidingWindow(
  messages: BaseMessage[],
  config: Partial<SlidingWindowConfig> = {},
): { kept: BaseMessage[]; removed: BaseMessage[] } {
  const cfg = { ...DEFAULT, ...config }

  if (messages.length <= cfg.maxMessages) {
    return { kept: [...messages], removed: [] }
  }

  const kept: BaseMessage[] = []
  const removed: BaseMessage[] = []

  // 1. Preserve the first human message (task definition) if configured
  let startIdx = 0
  if (cfg.preserveFirstMessage && messages.length > 0 && messages[0].getType() === 'human') {
    kept.push(messages[0])
    startIdx = 1
  }

  // 2. Build turns from remaining messages
  // A turn starts with a HumanMessage and includes all subsequent messages
  // until the next HumanMessage (or the end).
  const turns: BaseMessage[][] = []
  let currentTurn: BaseMessage[] = []

  for (let i = startIdx; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.getType() === 'human' && currentTurn.length > 0) {
      turns.push(currentTurn)
      currentTurn = []
    }
    currentTurn.push(msg)
  }
  if (currentTurn.length > 0) {
    turns.push(currentTurn)
  }

  // 3. Keep the last N turns, remove the rest
  const turnsToKeep = Math.min(cfg.recentTurns, turns.length)
  const keepFromIndex = Math.max(0, turns.length - turnsToKeep)

  for (let i = 0; i < turns.length; i++) {
    if (i >= keepFromIndex) {
      kept.push(...turns[i])
    } else {
      removed.push(...turns[i])
    }
  }

  return { kept, removed }
}
