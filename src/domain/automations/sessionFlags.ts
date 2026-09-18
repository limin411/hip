import type { Automation } from './types'

/**
 * Conversation ids that own an **enabled** scheduled task.
 *
 * Matches the composer's ownership rule (`useScheduledTask`): an automation is
 * conversation-scoped by `sessionId`, and only an enabled one will ever fire.
 * Disabled tasks stay invisible — showing them would mark conversations that
 * nothing is scheduled for.
 *
 * Returns a Set so callers (sidebar rows) can test membership per row instead of
 * scanning the catalog once per session.
 */
export function scheduledSessionIds(automations: readonly Automation[]): Set<string> {
  const ids = new Set<string>()
  for (const a of automations) {
    if (a.enabled && a.sessionId) ids.add(a.sessionId)
  }
  return ids
}
