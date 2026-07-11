/** Session ids waiting for a user-facing toast on the next fs:diff:result. */

const pendingUserDiffToasts = new Set<string>()

export function markUserDiffRequest(sessionId: string): void {
  pendingUserDiffToasts.add(sessionId)
}

/** Returns true once if this result should show a user toast (consumes the mark). */
export function consumeUserDiffRequest(sessionId: string): boolean {
  if (!pendingUserDiffToasts.has(sessionId)) return false
  pendingUserDiffToasts.delete(sessionId)
  return true
}
