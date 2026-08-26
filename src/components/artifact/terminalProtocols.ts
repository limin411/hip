/**
 * Terminal protocol handlers (OSC 8, OSC 52, Synchronized Output, Shell Integration).
 *
 * Spec: docs/design/terminal-capability-upgrade/terminal-capability-upgrade-spec.md §T2
 *
 * This module provides a unified interface for loading all terminal protocol handlers.
 */

import type { Terminal as XTerm } from '@xterm/xterm'
import {
  registerOsc8Handler,
  openUri,
} from './terminalOsc8'
import {
  registerOsc52Handler,
  type ClipboardReadPolicy,
  type ClipboardReadConfirmCallback,
} from './terminalOsc52'
import {
  verifySyncOutputSupport,
} from './terminalSyncOutput'
import { useHipConfigStore } from '@/store/hipConfigStore'

/** Loaded protocol handlers */
export interface LoadedProtocols {
  osc8?: { dispose: () => void }
  osc52?: {
    dispose: () => void
    respondToRead: (requestId: string, data: string | null) => void
  }
  syncOutput?: { dispose: () => void }
}

/** Protocol configuration from hip.toml */
interface ProtocolConfig {
  hyperlinks: boolean
  clipboardRead: ClipboardReadPolicy
}

/** Get protocol configuration */
function getProtocolConfig(): ProtocolConfig {
  const config = useHipConfigStore.getState().config
  const terminal = config.terminal

  return {
    hyperlinks: true, // Always enabled
    clipboardRead: (terminal?.clipboardRead as ClipboardReadPolicy) ?? 'ask',
  }
}

/**
 * Load all terminal protocol handlers.
 *
 * @param term - xterm.js Terminal instance
 * @param options - Optional callbacks
 * @returns Loaded protocol handlers for disposal
 */
export async function loadTerminalProtocols(
  term: XTerm,
  options?: {
    onLinkClick?: (uri: string) => void
    onClipboardReadConfirm?: ClipboardReadConfirmCallback
  },
): Promise<LoadedProtocols> {
  const config = getProtocolConfig()
  const protocols: LoadedProtocols = {}

  // OSC 8 Hyperlinks
  if (config.hyperlinks) {
    try {
      const onLink = options?.onLinkClick ?? openUri
      protocols.osc8 = registerOsc8Handler(term, onLink)
      console.debug('[terminal] OSC 8 hyperlinks registered')
    } catch (e) {
      console.warn('[terminal] Failed to register OSC 8 handler:', e)
    }
  }

  // OSC 52 Clipboard
  try {
    protocols.osc52 = registerOsc52Handler(
      term,
      config.clipboardRead,
      options?.onClipboardReadConfirm,
    )
    console.debug('[terminal] OSC 52 clipboard registered')
  } catch (e) {
    console.warn('[terminal] Failed to register OSC 52 handler:', e)
  }

  // Synchronized Output - built-in to xterm.js 5.5.0+, no handler needed
  // Just verify support
  if (verifySyncOutputSupport(term)) {
    console.debug('[terminal] Synchronized Output (DECSET 2026) supported')
  }

  return protocols
}

/**
 * Dispose all loaded protocol handlers.
 */
export function disposeTerminalProtocols(protocols: LoadedProtocols): void {
  protocols.osc8?.dispose()
  protocols.osc52?.dispose()
  protocols.syncOutput?.dispose()
}

/**
 * Check if a URI is safe to open (re-export from osc8).
 */
export { isUriSafe } from './terminalOsc8'

/**
 * Open a URI safely (re-export from osc8).
 */
export { openUri } from './terminalOsc8'

/**
 * Create a synchronized update wrapper (re-export from syncOutput).
 */
export { createSyncUpdate } from './terminalSyncOutput'

/**
 * Respond to a clipboard read request (re-export from osc52).
 */
export type { ClipboardReadConfirmCallback } from './terminalOsc52'
