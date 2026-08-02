// src/ipc/sftp.ts — SFTP tree + transfer bound to an alive SSH terminal.
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { nanoid } from 'nanoid'

export interface SftpEntry {
  name: string
  path: string
  isDir: boolean
  size?: number
}

export interface SftpLsResult {
  /** Normalized absolute remote directory path. */
  path: string
  entries: SftpEntry[]
}

export type SftpProgressPhase =
  | 'started'
  | 'progress'
  | 'completed'
  | 'cancelled'
  | 'error'
  | string

export interface SftpProgressEvent {
  terminalId: string
  opId: string
  phase: SftpProgressPhase
  bytes: number
  total?: number
  message?: string
}

export function mintSftpOpId(): string {
  return `sftp_${nanoid(10)}`
}

export function sftpLs(terminalId: string, path: string): Promise<SftpLsResult> {
  return invoke<SftpLsResult>('sftp_ls', { terminalId, path })
}

export function sftpMkdir(terminalId: string, path: string): Promise<void> {
  return invoke('sftp_mkdir', { terminalId, path })
}

/** Read a remote text file via SFTP (read-only, capped; spec §5.1 sftp_read). */
export function sftpReadFile(
  terminalId: string,
  path: string,
  maxBytes?: number,
): Promise<string> {
  return invoke<string>('sftp_read_file', {
    terminalId,
    path,
    maxBytes: maxBytes ?? 256 * 1024,
  })
}

export function sftpRemove(terminalId: string, path: string, isDir: boolean): Promise<void> {
  return invoke('sftp_remove', { terminalId, path, isDir })
}

export function sftpDownload(
  terminalId: string,
  remotePath: string,
  localPath: string,
  opts?: { force?: boolean; opId?: string },
): Promise<void> {
  const opId = opts?.opId ?? mintSftpOpId()
  return invoke('sftp_download', {
    terminalId,
    remotePath,
    localPath,
    force: opts?.force ?? false,
    opId,
  })
}

export function sftpUpload(
  terminalId: string,
  localPath: string,
  remotePath: string,
  opts?: { force?: boolean; opId?: string },
): Promise<void> {
  const opId = opts?.opId ?? mintSftpOpId()
  return invoke('sftp_upload', {
    terminalId,
    localPath,
    remotePath,
    force: opts?.force ?? false,
    opId,
  })
}

export function sftpCancel(terminalId: string, opId: string): Promise<void> {
  return invoke('sftp_cancel', { terminalId, opId })
}

/** Subscribe to transfer progress events. Returns unlisten. */
export async function listenSftpProgress(
  handler: (ev: SftpProgressEvent) => void,
): Promise<UnlistenFn> {
  return listen<SftpProgressEvent>('sftp:progress', (e) => {
    if (e.payload) handler(e.payload)
  })
}

export function isAlreadyExistsError(err: unknown): boolean {
  const msg =
    typeof err === 'string'
      ? err
      : err instanceof Error
        ? err.message
        : err && typeof err === 'object' && 'message' in err
          ? String((err as { message: unknown }).message)
          : String(err ?? '')
  return msg.includes('AlreadyExists')
}

export function isSessionClosedError(err: unknown): boolean {
  const msg =
    typeof err === 'string'
      ? err
      : err instanceof Error
        ? err.message
        : err && typeof err === 'object' && 'message' in err
          ? String((err as { message: unknown }).message)
          : String(err ?? '')
  return /session is closed|SessionClosed|no ssh session/i.test(msg)
}
