/** Count visible session rows (sidebar). Prefer over removed title-bar session-tab. */
export async function countSessions(): Promise<number> {
  // Match primary session buttons only (not expand/badge/group).
  const rows = await browser.$$('[data-session-tab="true"]')
  return rows.length
}

export async function waitForSessionCount(
  min: number,
  timeoutMs = 30000,
): Promise<void> {
  await browser.waitUntil(async () => (await countSessions()) >= min, {
    timeout: timeoutMs,
    interval: 300,
    timeoutMsg: `expected at least ${min} session row(s)`,
  })
}

export function sessionTabSelector(): string {
  // Dual-compat: attribute marker on sidebar session buttons.
  return '[data-session-tab="true"]'
}
