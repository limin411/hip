/**
 * Terminal keybindings default table (P0.2, spec docs/design/doc-terminal-capability-gap/).
 *
 * Pure matching — no DOM/xterm dependency, table-driven unit tests.
 * Prefix is `Cmd` on macOS / `Ctrl` elsewhere; we accept both prefixes so a
 * Ctrl+Shift+C habit works on macOS too. IME composition is never intercepted.
 *
 * NOTE: on macOS the physical `⌘⇧=` produces `key === '+'` in WebKit; accept both.
 */

export type TerminalKeyAction =
  | 'copy'
  | 'paste'
  | 'clear'
  | 'search'
  | 'font-up'
  | 'font-down'
  | 'font-reset'
  | 'scroll-top'
  | 'scroll-bottom'
  | 'restart'

/** Minimal KeyboardEvent shape — enough for unit tests without a DOM event. */
export type TerminalKeyEventLike = {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  isComposing?: boolean
}

const modPressed = (e: TerminalKeyEventLike) => e.metaKey || e.ctrlKey

/** Match a keydown event to a terminal action; null = let xterm handle it. */
export function matchTerminalKey(e: TerminalKeyEventLike): TerminalKeyAction | null {
  if (e.isComposing) return null
  if (!modPressed(e)) return null

  const key = e.key.toLowerCase()

  if (e.shiftKey && key === 'c') return 'copy'
  if (e.shiftKey && key === 'v') return 'paste'
  if (e.shiftKey && key === 'r') return 'restart'
  if (e.shiftKey && key === 'arrowup') return 'scroll-top'
  if (e.shiftKey && key === 'arrowdown') return 'scroll-bottom'

  // ⌘⇧= / ⌘⇧+ → increase (WebKit reports '+' for Shift+=; also accept '=').
  if (e.shiftKey && (key === '=' || key === '+')) return 'font-up'
  if (e.shiftKey && key === '-') return 'font-down'
  if (!e.shiftKey && key === '0') return 'font-reset'

  if (!e.shiftKey && key === 'l') return 'clear'
  if (!e.shiftKey && key === 'f') return 'search'

  return null
}
