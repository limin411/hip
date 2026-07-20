/**
 * UI bridge so terminal canvas context-menu actions (copy selection / paste)
 * reach the live xterm instance without putting term refs in the registry payload.
 * Bound by XtermSurface while the xterm host is mounted.
 *
 * D6a: keyed by terminalId — no silent global default when id is missing.
 *
 * Ownership: at most one binder per terminalId. Focus protocol requires unmounting
 * the previous XtermSurface (bind(id, null)) before mounting the next for the same
 * or another id. bind(id, null) deletes by id with no ownership token — overlapping
 * mounts for one id would let the first unbind clear the second registration.
 */

export type TerminalCanvasApi = {
  getSelection: () => string
  hasSelection: () => boolean
  /** Paste text into the terminal (prefer xterm.paste for bracketed-paste). */
  paste: (text: string) => void
}

const apis = new Map<string, TerminalCanvasApi>()

/**
 * XtermSurface registers while xterm is open for this terminalId.
 * Pass null only from the surface that previously bound this id (on unmount).
 */
export function bindTerminalCanvas(terminalId: string, api: TerminalCanvasApi | null): void {
  if (api) apis.set(terminalId, api)
  else apis.delete(terminalId)
}

export function terminalCanvasHasSelection(terminalId: string): boolean {
  return apis.get(terminalId)?.hasSelection() ?? false
}

export function getTerminalCanvasSelection(terminalId: string): string {
  return apis.get(terminalId)?.getSelection() ?? ''
}

/** No-ops if that terminal's canvas is not mounted. */
export function pasteToTerminalCanvas(terminalId: string, text: string): void {
  apis.get(terminalId)?.paste(text)
}
