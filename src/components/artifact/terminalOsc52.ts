/**
 * OSC 52 Clipboard support for xterm.js.
 *
 * Spec: docs/design/terminal-capability-upgrade/terminal-capability-upgrade-spec.md §T2.2
 *
 * OSC 52 allows terminal applications to access the system clipboard.
 * Format: OSC 52 ; Pc ; Pd ST
 *
 * - Pc: clipboard target (c = clipboard, p = primary, s = selection)
 * - Pd: base64-encoded data (empty = read, non-empty = write)
 *
 * Security:
 * - Read requires user confirmation (configurable)
 * - Write is allowed by default
 */

import type { Terminal as XTerm } from '@xterm/xterm'

/** Clipboard policy from hip.toml */
export type ClipboardReadPolicy = 'ask' | 'allow' | 'deny'

/** Default clipboard policy */
const DEFAULT_READ_POLICY: ClipboardReadPolicy = 'ask'

/** Maximum clipboard data size (1MB) */
const MAX_CLIPBOARD_SIZE = 1024 * 1024

/** Pending read request */
interface PendingReadRequest {
  id: string
  target: string
  resolve: (data: string | null) => void
  timestamp: number
}

/** Callback for clipboard read confirmation */
export type ClipboardReadConfirmCallback = (
  request: PendingReadRequest,
) => Promise<boolean>

/**
 * Encode string to base64.
 */
function encodeBase64(str: string): string {
  return btoa(unescape(encodeURIComponent(str)))
}

/**
 * Decode base64 to string.
 */
function decodeBase64(str: string): string {
  return decodeURIComponent(escape(atob(str)))
}

/**
 * Register OSC 52 handler on xterm.js terminal.
 *
 * @param term - xterm.js Terminal instance
 * @param readPolicy - Policy for clipboard read operations
 * @param onReadConfirm - Callback to confirm clipboard read (if policy is 'ask')
 * @returns Object with dispose and writeResponse methods
 */
export function registerOsc52Handler(
  term: XTerm,
  readPolicy: ClipboardReadPolicy = DEFAULT_READ_POLICY,
  onReadConfirm?: ClipboardReadConfirmCallback,
): {
  dispose: () => void
  /** Respond to a pending read request (call after user confirmation) */
  respondToRead: (requestId: string, data: string | null) => void
} {
  const pendingReads = new Map<string, PendingReadRequest>()
  let readIdCounter = 0

  // Register OSC handler
  const oscHandler = term.parser.registerOscHandler(52, async (data: string): Promise<boolean> => {
    // Parse: "Pc;Pd" where Pc is target and Pd is base64 data
    const separatorIndex = data.indexOf(';')
    if (separatorIndex === -1) return true

    const target = data.slice(0, separatorIndex) || 'c'
    const encodedData = data.slice(separatorIndex + 1)

    // Validate target (only c, p, s are standard)
    if (!['c', 'p', 's', ''].includes(target)) {
      console.debug('[OSC52] Ignoring unsupported target:', target)
      return true
    }

    if (!encodedData) {
      // READ request - get clipboard content
      await handleReadRequest(target)
    } else {
      // WRITE request - set clipboard content
      await handleWriteRequest(target, encodedData)
    }
    return true
  })

  async function handleReadRequest(target: string): Promise<void> {
    // Check policy
    if (readPolicy === 'deny') {
      console.debug('[OSC52] Clipboard read denied by policy')
      // Send empty response to indicate denial
      writeOsc52Response(target, '')
      return
    }

    // Generate request ID
    const requestId = `osc52-read-${++readIdCounter}`

    if (readPolicy === 'ask' && onReadConfirm) {
      // Create pending request
      const request: PendingReadRequest = {
        id: requestId,
        target,
        resolve: (data) => {
          if (data !== null) {
            writeOsc52Response(target, encodeBase64(data))
          } else {
            writeOsc52Response(target, '')
          }
        },
        timestamp: Date.now(),
      }

      pendingReads.set(requestId, request)

      // Ask for confirmation
      const confirmed = await onReadConfirm(request)
      if (!confirmed) {
        // User denied
        writeOsc52Response(target, '')
        pendingReads.delete(requestId)
        return
      }
    }

    // Policy is 'allow' or user confirmed
    try {
      const text = await readClipboard()
      if (text) {
        writeOsc52Response(target, encodeBase64(text))
      } else {
        writeOsc52Response(target, '')
      }
    } catch (e) {
      console.error('[OSC52] Failed to read clipboard:', e)
      writeOsc52Response(target, '')
    }

    pendingReads.delete(requestId)
  }

  async function handleWriteRequest(target: string, encodedData: string): Promise<void> {
    try {
      const data = decodeBase64(encodedData)

      // Check size limit
      if (data.length > MAX_CLIPBOARD_SIZE) {
        console.warn('[OSC52] Clipboard data too large:', data.length)
        return
      }

      await writeClipboard(data)
      console.debug('[OSC52] Wrote to clipboard:', target)
    } catch (e) {
      console.error('[OSC52] Failed to write clipboard:', e)
    }
  }

  function writeOsc52Response(target: string, encodedData: string): void {
    // Send response: OSC 52 ; Pc ; Pd ST
    const response = `\x1b]52;${target};${encodedData}\x1b\\`
    term.write(response)
  }

  return {
    dispose: () => {
      oscHandler.dispose()
      pendingReads.clear()
    },
    respondToRead: (requestId: string, data: string | null) => {
      const request = pendingReads.get(requestId)
      if (request) {
        request.resolve(data)
        pendingReads.delete(requestId)
      }
    },
  }
}

/**
 * Read text from system clipboard.
 */
async function readClipboard(): Promise<string | null> {
  try {
    // Try Tauri clipboard first
    const { readText } = await import('@/ipc/clipboard')
    return await readText()
  } catch {
    // Fallback to browser API
    if (navigator.clipboard?.readText) {
      return await navigator.clipboard.readText()
    }
    return null
  }
}

/**
 * Write text to system clipboard.
 */
async function writeClipboard(text: string): Promise<void> {
  try {
    // Try Tauri clipboard first
    const { copyText } = await import('@/ipc/clipboard')
    await copyText(text)
  } catch {
    // Fallback to browser API
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
    }
  }
}
