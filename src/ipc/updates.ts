// src/ipc/updates.ts
// Typed wrappers over the Rust `updates_*` commands (Settings → General →
// Version & updates). Never fetch GitHub from the frontend — CSP forbids it and
// the Rust layer owns UA / ETag / allowlist / proxy.
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export type UpdateCheckStatus =
  | 'up_to_date'
  | 'update_available'
  | 'current_ahead'
  | 'no_matching_asset'
  | 'error'

export interface AppVersionInfo {
  version: string
  debugBuild: boolean
  os: string
  arch: string
}

export interface UpdateAsset {
  name: string
  size: number
  contentType?: string
  browserDownloadUrl: string
  /** Lowercase hex. Missing ⇒ the UI must refuse to download. */
  sha256?: string
}

export interface UpdateCheckResult {
  status: UpdateCheckStatus
  currentVersion: string
  latestTag?: string
  latestVersion?: string
  publishedAt?: string
  notesExcerpt?: string
  htmlUrl?: string
  asset?: UpdateAsset
  cacheHit: boolean
  checkedAt: string
  latencyMs: number
  errorKind?: string
  errorMessage?: string
  /** Only on 429; the check button stays disabled for this many seconds. */
  retryAfterSec?: number
  debugBuild: boolean
}

export interface UpdateProgress {
  phase: 'downloading' | 'verifying' | 'ready' | 'error' | 'cancelled'
  downloaded: number
  total?: number
  assetName: string
  errorKind?: string
}

export async function updatesAppInfo(): Promise<AppVersionInfo> {
  return invoke<AppVersionInfo>('updates_app_info')
}

export async function updatesCheck(force?: boolean): Promise<UpdateCheckResult> {
  return invoke<UpdateCheckResult>('updates_check', { force })
}

export async function updatesDownload(
  tag: string,
  assetName: string,
): Promise<{ path: string }> {
  return invoke<{ path: string }>('updates_download', { tag, assetName })
}

export async function updatesCancelDownload(): Promise<void> {
  return invoke<void>('updates_cancel_download')
}

export async function updatesOpenInstaller(path: string): Promise<void> {
  return invoke<void>('updates_open_installer', { path })
}

export async function updatesOpenReleasePage(url: string): Promise<void> {
  return invoke<void>('updates_open_release_page', { url })
}

/** Emitted by `updates_download` only. Host + settings subscribe; store is the single writer. */
export async function listenUpdatesProgress(
  cb: (p: UpdateProgress) => void,
): Promise<UnlistenFn> {
  return listen<UpdateProgress>('updates://progress', (ev) => cb(ev.payload))
}

/** Emitted by the Rust wake loop only (never the check command, KD-13). */
export async function listenUpdatesAvailable(
  cb: (r: UpdateCheckResult) => void,
): Promise<UnlistenFn> {
  return listen<UpdateCheckResult>('updates://available', (ev) => cb(ev.payload))
}
