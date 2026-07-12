/**
 * Order bulk Path-A closes to reduce flicker / wasted session:load IPC.
 * closeSession(active) selects another open tab mid-loop; closing non-active
 * first, then active last, avoids loading tabs that are about to be deleted.
 */
export function orderBulkCloseIds(
  sessionIds: string[],
  activeSessionId: string | null | undefined,
): string[] {
  if (!activeSessionId || !sessionIds.includes(activeSessionId)) {
    return sessionIds.slice()
  }
  const nonActive = sessionIds.filter((id) => id !== activeSessionId)
  return [...nonActive, activeSessionId]
}
