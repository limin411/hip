/**
 * Anthropic Messages API (and MiniMax / Kimi Anthropic-compatible hosts) only
 * allow system content as a *single* leading system message.
 *
 * hip often injects multiple SystemMessages:
 * - main system prompt
 * - forcePlan / plan reminders
 * - context delta messages (session-context on turn 2+)
 * - cron / doom-loop / max-steps notes
 *
 * Coalesce them so those hosts do not 400 with:
 * "System messages are only permitted as the first passed message."
 */
import { SystemMessage, type BaseMessage } from '@langchain/core/messages'

function systemText(m: BaseMessage): string {
  const c = m.content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) {
    return c
      .map((b) => {
        if (b && typeof b === 'object' && 'type' in b && (b as { type?: string }).type === 'text') {
          return String((b as { text?: string }).text ?? '')
        }
        return typeof b === 'string' ? b : JSON.stringify(b)
      })
      .join('')
  }
  return c == null ? '' : String(c)
}

function isSystemMessage(m: BaseMessage): boolean {
  if (m instanceof SystemMessage) return true
  try {
    return m.getType() === 'system'
  } catch {
    return false
  }
}

/**
 * Merge every system message into one leading SystemMessage; keep other roles in order.
 * No-op when there is already exactly one system message and it is first.
 */
export function coalesceSystemMessages(messages: readonly BaseMessage[]): BaseMessage[] {
  const systems: string[] = []
  const rest: BaseMessage[] = []
  let systemCount = 0
  let firstIsOnlySystem = true

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (isSystemMessage(m)) {
      systemCount++
      if (i !== 0) firstIsOnlySystem = false
      const t = systemText(m).trim()
      if (t) systems.push(t)
    } else {
      if (systemCount > 0 && i > 0 && systemCount !== i) {
        // non-system after we already saw systems — fine
      }
      if (i === 0) firstIsOnlySystem = false
      rest.push(m)
    }
  }

  // Already legal: zero systems, or exactly one system at index 0 and no other systems.
  if (systemCount === 0) return messages as BaseMessage[]
  if (systemCount === 1 && messages[0] && isSystemMessage(messages[0]) && firstIsOnlySystem) {
    return messages as BaseMessage[]
  }

  if (systems.length === 0) return rest
  return [new SystemMessage(systems.join('\n\n')), ...rest]
}
