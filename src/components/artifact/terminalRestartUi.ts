/**
 * UI bridge so terminal context-menu "Restart" reuses the surface's restart handler
 * (ptyKill + clearSession + remount). No domain logic here.
 *
 * D6a: keyed by terminalId — no silent global default when id is missing.
 *
 * Ownership: at most one binder per terminalId. Unmount previous surface before
 * mounting the next (same focus protocol as terminalCanvasUi). bind(id, null)
 * deletes by id — overlapping binders for one id would let the first unbind
 * clear the second registration.
 */

type Restarter = () => void | Promise<void>

const restarters = new Map<string, Restarter>()

/**
 * XtermSurface registers restart while mounted for this terminalId.
 * Pass null only from the surface that previously bound this id (on unmount).
 */
export function bindTerminalRestarter(terminalId: string, fn: Restarter | null): void {
  if (fn) restarters.set(terminalId, fn)
  else restarters.delete(terminalId)
}

/** Provider run() entry — no-ops if that terminal is not mounted. */
export async function requestTerminalRestart(terminalId: string): Promise<void> {
  await restarters.get(terminalId)?.()
}
