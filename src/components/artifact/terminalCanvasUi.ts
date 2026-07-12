/**
 * UI bridge so terminal canvas context-menu actions (copy selection / paste)
 * reach the live xterm instance without putting term refs in the registry payload.
 * Bound by TerminalView while the xterm host is mounted.
 */

export type TerminalCanvasApi = {
  getSelection: () => string
  hasSelection: () => boolean
  /** Paste text into the terminal (prefer xterm.paste for bracketed-paste). */
  paste: (text: string) => void
}

let api: TerminalCanvasApi | null = null

/** TerminalView registers while xterm is open. */
export function bindTerminalCanvas(next: TerminalCanvasApi | null): void {
  api = next
}

export function terminalCanvasHasSelection(): boolean {
  return api?.hasSelection() ?? false
}

export function getTerminalCanvasSelection(): string {
  return api?.getSelection() ?? ''
}

/** No-ops if Terminal is not mounted. */
export function pasteToTerminalCanvas(text: string): void {
  api?.paste(text)
}
