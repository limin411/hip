// src/ipc/ssh.ts — SSH terminal IPC + host-key TOFU helpers.
import { invoke } from '@tauri-apps/api/core'

export interface SshOpenResult {
  reused: boolean
  generation: number
}

/** Structured host-key mismatch from Rust `ssh_open` (JSON error string). */
export interface HostKeyMismatchError {
  code: 'host_key_mismatch'
  hostname: string
  port: number
  fingerprint: string
  previousFingerprint?: string
  /** OpenSSH public key line of the *new* server key (for trust update). */
  publicKey: string
}

export function isHostKeyMismatchError(v: unknown): v is HostKeyMismatchError {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    o.code === 'host_key_mismatch' &&
    typeof o.hostname === 'string' &&
    typeof o.port === 'number' &&
    typeof o.fingerprint === 'string' &&
    typeof o.publicKey === 'string'
  )
}

/** Extract a usable message / structured payload from a Tauri invoke failure. */
export function parseSshInvokeError(err: unknown): {
  message: string
  hostKeyMismatch?: HostKeyMismatchError
} {
  const message =
    typeof err === 'string'
      ? err
      : err instanceof Error
        ? err.message
        : err && typeof err === 'object' && 'message' in err
          ? String((err as { message: unknown }).message)
          : String(err ?? 'SSH error')

  // Tauri often surfaces the Err(String) directly as the message.
  const candidates = [message]
  // Sometimes wrapped as `…: {json}`
  const brace = message.indexOf('{')
  if (brace >= 0) candidates.push(message.slice(brace))

  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c) as unknown
      if (isHostKeyMismatchError(parsed)) {
        return { message, hostKeyMismatch: parsed }
      }
    } catch {
      /* not JSON */
    }
  }
  return { message }
}

export function sshOpen(
  terminalId: string,
  hostId: string,
  cols: number,
  rows: number,
): Promise<SshOpenResult> {
  return invoke<SshOpenResult>('ssh_open', { terminalId, hostId, cols, rows })
}

export function sshWrite(terminalId: string, data: string): Promise<void> {
  return invoke('ssh_write', { terminalId, data })
}

export function sshResize(terminalId: string, cols: number, rows: number): Promise<void> {
  return invoke('ssh_resize', { terminalId, cols, rows })
}

export function sshClose(terminalId: string): Promise<void> {
  return invoke('ssh_close', { terminalId })
}

export function sshList(): Promise<string[]> {
  return invoke<string[]>('ssh_list')
}

export interface InteractiveTerminalEntry {
  id: string
  kind: 'pty' | 'ssh' | string
}

export function interactiveTerminalList(): Promise<InteractiveTerminalEntry[]> {
  return invoke<InteractiveTerminalEntry[]>('interactive_terminal_list')
}

export interface KnownHostEntry {
  publicKey: string
  fingerprintSha256: string
  updatedAt: number
}

export function sshKnownHostsGet(
  hostname: string,
  port: number,
): Promise<KnownHostEntry | null> {
  return invoke<KnownHostEntry | null>('ssh_known_hosts_get', { hostname, port })
}

export function sshTrustHost(
  hostname: string,
  port: number,
  publicKey: string,
  fingerprintSha256: string,
): Promise<void> {
  return invoke('ssh_trust_host', {
    hostname,
    port,
    publicKey,
    fingerprintSha256,
  })
}

export function sshRemoveHostKey(hostname: string, port: number): Promise<void> {
  return invoke('ssh_remove_host_key', { hostname, port })
}
