import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useTerminalStore } from '@/store/terminalStore'

export interface PtyOpenResult {
  reused: boolean
  generation: number
}

export interface PtyDataPayload {
  /** Wire field from Rust PTY events. */
  sessionId?: string
  /** Normalized / future SSH field; preferred when present. */
  terminalId?: string
  data: string // base64
}

export interface PtyExitPayload {
  sessionId?: string
  terminalId?: string
  code: number | null
  generation?: number
}

/**
 * Normalize event payload id fields to a single terminal id.
 * PTY wire uses `sessionId`; SSH (PR5) uses `terminalId`. Prefer terminalId when both set.
 */
export function normalizeTerminalId(payload: {
  sessionId?: string
  terminalId?: string
}): string | null {
  return payload.terminalId ?? payload.sessionId ?? null
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
 * App-lifetime bridge. Call once when CODE_TERMINAL || TERMINAL_MANAGEMENT is enabled.
 * ONLY mutates terminalStore (appendRing / setExit). Never receives a Terminal.
 * Uses per-id streaming TextDecoder so multi-byte UTF-8 split across events is intact.
 * Listens `pty:*` only until SSH events land (PR5); normalizeTerminalId accepts both field shapes.
 */
export async function startTerminalBridge(): Promise<() => void> {
  const decoders = new Map<string, TextDecoder>()

  const u1: UnlistenFn = await listen<PtyDataPayload>('pty:data', (e) => {
    const terminalId = normalizeTerminalId(e.payload)
    if (!terminalId) return
    const { data } = e.payload
    const bytes = b64ToBytes(data)
    if (!bytes || bytes.length === 0) return
    // Dev observability: keep-alive rings still append when not attached (D6a).
    if (import.meta.env.DEV) {
      const attached =
        useTerminalStore.getState().attachedTerminalId ??
        useTerminalStore.getState().attachedSessionId
      if (terminalId !== attached) {
        console.debug('[hip] terminal data while unattached', terminalId)
      }
    }
    let dec = decoders.get(terminalId)
    if (!dec) {
      dec = new TextDecoder('utf-8', { fatal: false })
      decoders.set(terminalId, dec)
    }
    const text = dec.decode(bytes, { stream: true })
    if (text) useTerminalStore.getState().appendRing(terminalId, text)
  })
  const u2: UnlistenFn = await listen<PtyExitPayload>('pty:exit', (e) => {
    const terminalId = normalizeTerminalId(e.payload)
    if (!terminalId) return
    const { code, generation } = e.payload
    // Flush any pending multi-byte sequence for this session.
    const dec = decoders.get(terminalId)
    if (dec) {
      const tail = dec.decode()
      if (tail) useTerminalStore.getState().appendRing(terminalId, tail)
      decoders.delete(terminalId)
    }
    useTerminalStore.getState().setExit(terminalId, code, generation)
  })
  return () => {
    u1()
    u2()
    decoders.clear()
  }
}

/** @deprecated Prefer startTerminalBridge (same implementation). */
export const startPtyBridge = startTerminalBridge
