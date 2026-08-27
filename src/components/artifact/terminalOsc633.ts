/**
 * OSC 633 VSCode Terminal Integration support for xterm.js.
 *
 * OSC 633 is used by VSCode/Cursor terminal for shell integration:
 * - 633;A — Command start
 * - 633;B — Command end (success)
 * - 633;C — Command end (failure)
 * - 633;D;exit_code — Command end with exit code
 * - 633;E;command — Command line content
 * - 633;P;property=value — Terminal properties
 *
 * When registered, these sequences are consumed (not printed to terminal)
 * and optionally forwarded to VSCode terminal API if available.
 */

import type { Terminal as XTerm } from '@xterm/xterm'

/** OSC 633 event types */
export interface Osc633Events {
  onCommandStart?: () => void
  onCommandEnd?: (exitCode: number | null) => void
  onCommandLine?: (command: string) => void
  onProperty?: (property: string, value: string) => void
}

/**
 * Register OSC 633 handler on xterm.js terminal.
 *
 * This handler consumes OSC 633 sequences so they are not printed
 * as raw text to the terminal. Optionally forwards events via callbacks.
 *
 * @param term - xterm.js Terminal instance
 * @param events - Optional event callbacks
 * @returns Object with dispose method
 */
export function registerOsc633Handler(
  term: XTerm,
  events?: Osc633Events,
): {
  dispose: () => void
} {
  // Register OSC handler for 633
  const oscHandler = term.parser.registerOscHandler(633, (data: string): boolean => {
    // Parse: "command;payload" where command is A/B/C/E/P
    const separatorIndex = data.indexOf(';')
    const command = separatorIndex === -1 ? data : data.slice(0, separatorIndex)
    const payload = separatorIndex === -1 ? '' : data.slice(separatorIndex + 1)

    switch (command) {
      case 'A':
        // Command start
        console.debug('[OSC633] Command start')
        events?.onCommandStart?.()
        break

      case 'B':
        // Command end (success)
        console.debug('[OSC633] Command end (success)')
        events?.onCommandEnd?.(0)
        break

      case 'C':
        // Command end (failure)
        console.debug('[OSC633] Command end (failure)')
        events?.onCommandEnd?.(1)
        break

      case 'D':
        // Command end with exit code
        {
          const exitCode = parseInt(payload, 10)
          if (!isNaN(exitCode)) {
            console.debug('[OSC633] Command end with exit code:', exitCode)
            events?.onCommandEnd?.(exitCode)
          }
        }
        break

      case 'E':
        // Command line content
        console.debug('[OSC633] Command line:', payload)
        events?.onCommandLine?.(payload)
        break

      case 'P':
        // Terminal property
        {
          const eqIndex = payload.indexOf('=')
          if (eqIndex !== -1) {
            const property = payload.slice(0, eqIndex)
            const value = payload.slice(eqIndex + 1)
            console.debug('[OSC633] Property:', property, '=', value)
            events?.onProperty?.(property, value)
          }
        }
        break

      default:
        console.debug('[OSC633] Unknown command:', command, payload)
        break
    }

    // Return true to indicate the sequence was handled
    // (prevents it from being printed as raw text)
    return true
  })

  return {
    dispose: () => {
      oscHandler.dispose()
    },
  }
}

/**
 * Check if OSC 633 sequences are present in the output.
 * Useful for detecting if a terminal supports shell integration.
 */
export function hasOsc633Markers(output: string): boolean {
  return /\x1b\]633;[A-E]/.test(output)
}

/**
 * Strip OSC 633 sequences from output text.
 * Useful for displaying clean output without integration markers.
 */
export function stripOsc633Markers(text: string): string {
  return text.replace(/\x1b\]633;[A-E][^\x1b\x07]*\x1b\\/g, '')
}
