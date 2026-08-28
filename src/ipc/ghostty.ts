import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useTerminalStore } from '@/store/terminalStore'
import { useManagedTerminalStore } from '@/store/managedTerminalStore'

export interface GhosttyOpenResult {
  reused: boolean
  generation: number
}

export interface GhosttyDataPayload {
  session_id: string
  data: string // base64 encoded VT sequences
}

export interface GhosttyExitPayload {
  session_id: string
  code: number | null
  generation: number
}

export function ghosttyOpen(
  sessionId: string,
  cwd: string,
  cols: number,
  rows: number,
): Promise<GhosttyOpenResult> {
  return invoke<GhosttyOpenResult>('ghostty_open', { sessionId, cwd, cols, rows })
}

export function ghosttyWrite(sessionId: string, data: string): Promise<void> {
  return invoke('ghostty_write', { sessionId, data })
}

export function ghosttyResize(sessionId: string, cols: number, rows: number): Promise<void> {
  return invoke('ghostty_resize', { sessionId, cols, rows })
}

export function ghosttyKill(sessionId: string): Promise<void> {
  return invoke('ghostty_kill', { sessionId })
}

export function ghosttyScroll(sessionId: string, delta: number): Promise<void> {
  return invoke('ghostty_scroll', { sessionId, delta })
}

function b64ToBytes(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

/**
 * App-lifetime bridge for Ghostty backend.
 * Listens to `ghostty:*` events and feeds VT sequences into terminalStore.
 * Uses per-id streaming TextDecoder for multi-byte UTF-8.
 */
export async function startGhosttyBridge(): Promise<() => void> {
  const decoders = new Map<string, TextDecoder>()

  const u1: UnlistenFn = await listen<GhosttyDataPayload>('ghostty:data', (e) => {
    const terminalId = e.payload.session_id
    if (!terminalId) return

    const bytes = b64ToBytes(e.payload.data)
    if (!bytes || bytes.length === 0) return

    let dec = decoders.get(terminalId)
    if (!dec) {
      dec = new TextDecoder('utf-8', { fatal: false })
      decoders.set(terminalId, dec)
    }
    const text = dec.decode(bytes, { stream: true })
    if (text) useTerminalStore.getState().appendRing(terminalId, text)
  })

  const u2: UnlistenFn = await listen<GhosttyExitPayload>('ghostty:exit', (e) => {
    const terminalId = e.payload.session_id
    if (!terminalId) return

    const dec = decoders.get(terminalId)
    if (dec) {
      const tail = dec.decode()
      if (tail) useTerminalStore.getState().appendRing(terminalId, tail)
      decoders.delete(terminalId)
    }
    useTerminalStore.getState().setExit(terminalId, e.payload.code, e.payload.generation)
    const managed = useManagedTerminalStore.getState().getTerminal(terminalId)
    if (managed) {
      const sess = useTerminalStore.getState().getSession(terminalId)
      if (
        e.payload.generation !== undefined &&
        sess &&
        sess.generation !== 0 &&
        e.payload.generation !== sess.generation
      ) {
        return // stale exit
      }
      useManagedTerminalStore.getState().setStatus(terminalId, 'disconnected')
    }
  })

  // Bell event — could trigger visual flash in the UI
  const u3: UnlistenFn = await listen<string>('ghostty:bell', (_e) => {
    // Bell is handled by xterm.js directly when it receives BEL character in the VT stream.
    // No additional action needed here.
  })

  // Title event — update terminal chrome title
  const u4: UnlistenFn = await listen<{ session_id: string; title: string }>(
    'ghostty:title',
    (e) => {
      useTerminalStore.getState().setTitle(e.payload.session_id, e.payload.title)
    },
  )

  return () => {
    u1()
    u2()
    u3()
    u4()
    decoders.clear()
  }
}
