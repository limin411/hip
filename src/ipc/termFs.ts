// src/ipc/termFs.ts — Local managed-terminal tree rooted at launch cwd.
import { invoke } from '@tauri-apps/api/core'

/** Same shape as SFTP / protocol FsEntry (camelCase wire). */
export interface TermFsEntry {
  name: string
  path: string
  isDir: boolean
  size?: number
}

export interface TermFsLsResult {
  /** Canonical absolute directory that was listed. */
  path: string
  entries: TermFsEntry[]
}

/**
 * List a directory under the managed local terminal's launch cwd.
 * Requires an open local PTY session (`tm_*`); rejects path escape after canonicalize.
 */
export function termFsLs(terminalId: string, path: string): Promise<TermFsLsResult> {
  return invoke<TermFsLsResult>('term_fs_ls', { terminalId, path })
}

export function isTermFsNotReadyError(err: unknown): boolean {
  const msg =
    typeof err === 'string'
      ? err
      : err instanceof Error
        ? err.message
        : err && typeof err === 'object' && 'message' in err
          ? String((err as { message: unknown }).message)
          : String(err ?? '')
  return /no local terminal session|requires managed terminal/i.test(msg)
}

export function isTermFsEscapeError(err: unknown): boolean {
  const msg =
    typeof err === 'string'
      ? err
      : err instanceof Error
        ? err.message
        : err && typeof err === 'object' && 'message' in err
          ? String((err as { message: unknown }).message)
          : String(err ?? '')
  return /path escapes terminal root/i.test(msg)
}
