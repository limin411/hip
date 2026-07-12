/**
 * UI bridge so terminal context-menu "Restart" reuses TerminalView's existing restart handler
 * (ptyKill + clearSession + bootKey). No domain logic here.
 */

type Restarter = (sessionId: string) => void | Promise<void>

let restarter: Restarter | null = null

/** TerminalView registers its restart while mounted. */
export function bindTerminalRestarter(fn: Restarter | null): void {
  restarter = fn
}

/** Provider run() entry — no-ops if Terminal is not mounted. */
export async function requestTerminalRestart(sessionId: string): Promise<void> {
  await restarter?.(sessionId)
}
