import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useTerminalStore } from '@/store/terminalStore'

export interface PtyOpenResult {
  reused: boolean
  generation: number
}

export interface PtyDataPayload {
  sessionId: string
  data: string // base64
}

export interface PtyExitPayload {
  sessionId: string
  code: number | null
  generation?: number
}

/** Decode a single base64 chunk with a fresh decoder (tests / one-shot). Prefer stream decoder in bridge. */
export function decodePtyDataB64(b64: string): string {
  try {
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  } catch {
    return ''
  }
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

export function ptyOpen(
  sessionId: string,
  cwd: string,
  cols: number,
  rows: number,
): Promise<PtyOpenResult> {
  return invoke<PtyOpenResult>('pty_open', { sessionId, cwd, cols, rows })
}

export function ptyWrite(sessionId: string, data: string): Promise<void> {
  return invoke('pty_write', { sessionId, data })
}

export function ptyResize(sessionId: string, cols: number, rows: number): Promise<void> {
  return invoke('pty_resize', { sessionId, cols, rows })
}

export function ptyKill(sessionId: string): Promise<void> {
  return invoke('pty_kill', { sessionId })
}

/**
 * App-lifetime bridge. Call once when CODE_TERMINAL is enabled.
 * ONLY mutates terminalStore (appendRing / setExit). Never receives a Terminal.
 * Uses per-session streaming TextDecoder so multi-byte UTF-8 split across events is intact.
 */
export async function startPtyBridge(): Promise<() => void> {
  const decoders = new Map<string, TextDecoder>()

  const u1: UnlistenFn = await listen<PtyDataPayload>('pty:data', (e) => {
    const { sessionId, data } = e.payload
    const bytes = b64ToBytes(data)
    if (!bytes || bytes.length === 0) return
    let dec = decoders.get(sessionId)
    if (!dec) {
      dec = new TextDecoder('utf-8', { fatal: false })
      decoders.set(sessionId, dec)
    }
    const text = dec.decode(bytes, { stream: true })
    if (text) useTerminalStore.getState().appendRing(sessionId, text)
  })
  const u2: UnlistenFn = await listen<PtyExitPayload>('pty:exit', (e) => {
    const { sessionId, code, generation } = e.payload
    // Flush any pending multi-byte sequence for this session.
    const dec = decoders.get(sessionId)
    if (dec) {
      const tail = dec.decode()
      if (tail) useTerminalStore.getState().appendRing(sessionId, tail)
      decoders.delete(sessionId)
    }
    useTerminalStore.getState().setExit(sessionId, code, generation)
  })
  return () => {
    u1()
    u2()
    decoders.clear()
  }
}
