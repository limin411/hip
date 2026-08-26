/**
 * OSC 8 Hyperlink support for xterm.js.
 *
 * Spec: docs/design/terminal-capability-upgrade/terminal-capability-upgrade-spec.md §T2.1
 *
 * OSC 8 allows terminal applications to create clickable hyperlinks.
 * Format: OSC 8 ; params ; URI ST <text> OSC 8 ; ; ST
 *
 * Benefits:
 * - URLs in ls, git log, npm outdated etc. become clickable
 * - Consistent with Kitty/Alacritty/WezTerm behavior
 */

import type { Terminal as XTerm } from '@xterm/xterm'

/** Parsed hyperlink from OSC 8 sequence */
export interface Hyperlink {
  /** Unique id for this link instance */
  id: string
  /** The URI (http://, https://, file://, etc.) */
  uri: string
  /** Optional parameters (e.g., "id=foo") */
  params: Map<string, string>
  /** Start position in the terminal buffer */
  startLine: number
  startCol: number
  /** End position (updated as text is written) */
  endLine: number
  endCol: number
}

/** Link decoration state */
interface LinkDecoration {
  link: Hyperlink
  decoration: { dispose: () => void }
  element?: HTMLElement
}

/** Generate unique link id */
let linkIdCounter = 0
function generateLinkId(): string {
  return `osc8-${++linkIdCounter}-${Date.now()}`
}

/**
 * Parse OSC 8 parameters string.
 * Format: "key1=value1:key2=value2" or empty
 */
function parseOsc8Params(paramsStr: string): Map<string, string> {
  const params = new Map<string, string>()
  if (!paramsStr) return params

  for (const pair of paramsStr.split(':')) {
    const eqIndex = pair.indexOf('=')
    if (eqIndex > 0) {
      params.set(pair.slice(0, eqIndex), pair.slice(eqIndex + 1))
    }
  }
  return params
}

/**
 * Check if a URI is safe to open.
 * Only allows http, https, mailto, and file protocols.
 */
export function isUriSafe(uri: string): boolean {
  try {
    const url = new URL(uri)
    return ['http:', 'https:', 'mailto:', 'file:'].includes(url.protocol)
  } catch {
    // Invalid URL
    return false
  }
}

/**
 * Register OSC 8 handler on xterm.js terminal.
 *
 * @param term - xterm.js Terminal instance
 * @param onLinkClick - Callback when a link is clicked
 * @returns Cleanup function to dispose all link state
 */
export function registerOsc8Handler(
  term: XTerm,
  onLinkClick: (uri: string) => void,
): { dispose: () => void } {
  const links = new Map<string, Hyperlink>()
  const decorations = new Map<string, LinkDecoration>()
  let currentLink: Hyperlink | null = null
  let currentLine = 0
  let currentCol = 0

  // Track cursor position for link boundaries
  const cursorTracker = term.onCursorMove(() => {
    const buffer = term.buffer.active
    currentLine = buffer.cursorY
    currentCol = buffer.cursorX
  })

  // Register OSC handler
  const oscHandler = term.parser.registerOscHandler(8, (data: string): boolean => {
    // Parse: "params;URI" or just ";" (end of link)
    const separatorIndex = data.indexOf(';')
    if (separatorIndex === -1) return true

    const paramsStr = data.slice(0, separatorIndex)
    const uri = data.slice(separatorIndex + 1)

    if (!uri) {
      // End of link - finalize current link
      if (currentLink) {
        currentLink.endLine = currentLine
        currentLink.endCol = currentCol
        currentLink = null
      }
      return true
    }

    // Start of new link
    const id = generateLinkId()
    const params = parseOsc8Params(paramsStr)

    currentLink = {
      id,
      uri,
      params,
      startLine: currentLine,
      startCol: currentCol,
      endLine: currentLine,
      endCol: currentCol,
    }

    links.set(id, currentLink)
    return true
  })

  // Add link provider for hover detection
  const linkProvider = term.registerLinkProvider({
    provideLinks(bufferLineNumber, callback) {
      const lineLinks: Array<{
        text: string
        range: { start: { x: number; y: number }; end: { x: number; y: number } }
        activate: (event: MouseEvent, text: string) => void
      }> = []

      // Find links that span this line
      for (const link of links.values()) {
        if (
          (link.startLine <= bufferLineNumber && link.endLine >= bufferLineNumber) ||
          (link.startLine === bufferLineNumber)
        ) {
          // Calculate x range for this line
          const startX = link.startLine === bufferLineNumber ? link.startCol : 0
          const endX = link.endLine === bufferLineNumber ? link.endCol : term.cols

          // Get the text content
          const buffer = term.buffer.active
          const line = buffer.getLine(bufferLineNumber)
          if (!line) continue

          const text = line.translateToString(true, startX, endX)
          if (!text) continue

          lineLinks.push({
            text,
            range: {
              start: { x: startX + 1, y: bufferLineNumber },
              end: { x: endX, y: bufferLineNumber },
            },
            activate: (_event, _text) => {
              if (isUriSafe(link.uri)) {
                onLinkClick(link.uri)
              }
            },
          })
        }
      }

      callback(lineLinks)
    },
  })

  return {
    dispose: () => {
      cursorTracker.dispose()
      oscHandler.dispose()
      linkProvider.dispose()
      links.clear()
      decorations.forEach((d) => d.decoration.dispose())
      decorations.clear()
    },
  }
}

/**
 * Open a URI safely.
 * Uses Tauri shell opener for http/https, or system default for mailto.
 */
export async function openUri(uri: string): Promise<void> {
  if (!isUriSafe(uri)) {
    console.warn('[OSC8] Blocked unsafe URI:', uri)
    return
  }

  try {
    // Try Tauri shell opener first
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl(uri)
  } catch {
    // Fallback to window.open
    window.open(uri, '_blank', 'noopener,noreferrer')
  }
}
