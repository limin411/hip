import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useTerminalStore } from '@/store/terminalStore'

export interface PtyOpenResult {
  reused: boolean
}

export interface PtyDataPayload {
  sessionId: string
  data: string // base64
}

export interface PtyExitPayload {
  sessionId: string
  code: number | null
}

/** Decode base64 PTY bytes to a JS string (lossy UTF-8). */
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
 */
export async function startPtyBridge(): Promise<() => void> {
  const u1: UnlistenFn = await listen<PtyDataPayload>('pty:data', (e) => {
    const { sessionId, data } = e.payload
    const text = decodePtyDataB64(data)
    if (text) useTerminalStore.getState().appendRing(sessionId, text)
  })
  const u2: UnlistenFn = await listen<PtyExitPayload>('pty:exit', (e) => {
    useTerminalStore.getState().setExit(e.payload.sessionId, e.payload.code)
  })
  return () => {
    u1()
    u2()
  }
}
