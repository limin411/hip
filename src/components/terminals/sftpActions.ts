import type { TFunction } from 'i18next'
import { homeDir } from '@tauri-apps/api/path'
import { pickFiles, pickSavePath } from '@/ipc/dialog'
import {
  isAlreadyExistsError,
  mintSftpOpId,
  sftpDownload,
  sftpLs,
  sftpUpload,
  isSessionClosedError,
} from '@/ipc/sftp'
import { useTerminalFsStore } from '@/store/terminalFsStore'
import { useTerminalStore } from '@/store/terminalStore'

const RETRY_MS = 200
/** ~3s — enough for open race; TerminalFileTree also gates on status=running. */
const MAX_RETRIES = 15

// ── Transfer queue ──────────────────────────────────────────────────────────
// Rust enforces hard caps (1 per session, 2 process-wide) by *rejecting* new
// transfers instead of queuing them, so concurrent downloads used to fail
// immediately. We serialize here instead — per-terminal FIFO (matches
// MAX_PER_SESSION_TRANSFERS=1) plus a process-wide slot cap (matches
// MAX_GLOBAL_TRANSFERS=2) — so simultaneous transfers queue (phase 'queued')
// and run in order. Rust caps stay as a safety net for non-UI callers.
const MAX_GLOBAL_TRANSFERS = 2

/** Tail promise per terminal — jobs for the same terminal run one at a time. */
const perTerminalTail = new Map<string, Promise<void>>()
let globalSlots = MAX_GLOBAL_TRANSFERS
const globalWaiters: Array<() => void> = []

function acquireGlobalSlot(): Promise<void> {
  if (globalSlots > 0) {
    globalSlots -= 1
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    globalWaiters.push(resolve)
  })
}

function releaseGlobalSlot(): void {
  const next = globalWaiters.shift()
  if (next) next()
  else globalSlots += 1
}

/** Run `job` after earlier transfers for `terminalId` finish, when a global slot is free. */
function enqueueTransfer(terminalId: string, job: () => Promise<void>): Promise<void> {
  const prev = perTerminalTail.get(terminalId) ?? Promise.resolve()
  const run = prev.then(async () => {
    await acquireGlobalSlot()
    try {
      await job()
    } finally {
      releaseGlobalSlot()
    }
  })
  // Jobs never reject (they record errors into the store), but keep the chain
  // alive regardless so a stray throw cannot strand later queued transfers.
  perTerminalTail.set(
    terminalId,
    run.then(
      () => {},
      () => {},
    ),
  )
  return run
}

function localBasename(localPath: string): string {
  const normalized = localPath.replace(/\\/g, '/')
  const parts = normalized.split('/')
  return parts[parts.length - 1] || localPath
}

/** True while XtermSurface is still booting / ssh_open has not completed. */
function isSshStillOpening(terminalId: string): boolean {
  const status = useTerminalStore.getState().bySession[terminalId]?.status ?? 'idle'
  return status === 'idle' || status === 'starting'
}

async function warnIfConfigPath(localPath: string, message: string): Promise<boolean> {
  try {
    const home = (await homeDir()).replace(/\/+$/, '')
    const norm = localPath.replace(/\\/g, '/')
    const configPrefix = `${home}/.hip/config`
    if (norm === configPrefix || norm.startsWith(`${configPrefix}/`)) {
      return window.confirm(message)
    }
  } catch {
    /* ignore */
  }
  return true
}

/**
 * List a remote dir; set rootPath on first success (Issue 1).
 * Retries "SSH session is closed" while the managed SSH tab is still opening
 * (files rail races XtermSurface ssh_open — Rust returns SESSION_CLOSED for missing).
 */
export async function loadSftpDir(
  terminalId: string,
  path: string,
  attempt = 0,
): Promise<void> {
  const store = useTerminalFsStore.getState()
  store.setLoading(terminalId, path, true)
  store.setDirError(terminalId, path, null)
  try {
    const result = await sftpLs(terminalId, path)
    if (!store.getSlice(terminalId).rootPath) {
      store.setRootPath(terminalId, result.path)
    }
    store.setEntries(terminalId, result.path, result.entries)
    if (result.path !== path && path) {
      store.setEntries(terminalId, path, result.entries)
    }
    store.setError(terminalId, null)
  } catch (e) {
    // Open race: missing session and dead session both surface as SESSION_CLOSED.
    // Only retry while the terminal is still connecting — not after exit/error.
    if (isSessionClosedError(e) && isSshStillOpening(terminalId) && attempt < MAX_RETRIES) {
      store.setLoading(terminalId, path, false)
      await new Promise((r) => setTimeout(r, RETRY_MS))
      return loadSftpDir(terminalId, path, attempt + 1)
    }
    const msg = e instanceof Error ? e.message : String(e ?? 'SFTP error')
    const closed = isSessionClosedError(e)
    const slice = store.getSlice(terminalId)
    if (!slice.rootPath || path === slice.rootPath || path === '.' || path === '' || path === './') {
      store.setError(terminalId, closed ? 'session_closed' : msg)
    } else {
      store.setDirError(terminalId, path, closed ? 'session_closed' : msg)
    }
  } finally {
    store.setLoading(terminalId, path, false)
  }
}

export async function refreshSftpDir(terminalId: string, path: string): Promise<void> {
  await loadSftpDir(terminalId, path)
}

/** Upload one or more local files into a remote directory (menu + toolbar). */
export async function runSftpUploadIntoDir(
  terminalId: string,
  dirPath: string,
  t: TFunction,
): Promise<void> {
  const files = await pickFiles({
    multiple: true,
    title: t('terminals.sftp.pickFiles'),
  })
  if (!files?.length) return
  // Create all rows up front (phase 'queued') so later files show as waiting
  // while earlier ones transfer; jobs then run strictly in order below.
  const jobs: Array<{ local: string; base: string; remoteTarget: string; opId: string }> = []
  for (const local of files) {
    const base = localBasename(local)
    if (!(await warnIfConfigPath(local, t('terminals.sftp.warnConfigPath')))) continue
    const remoteTarget = dirPath.endsWith('/') ? `${dirPath}${base}` : `${dirPath}/${base}`
    const opId = mintSftpOpId()
    useTerminalFsStore.getState().upsertTransfer({
      opId,
      terminalId,
      kind: 'upload',
      label: base,
      phase: 'queued',
      bytes: 0,
    })
    jobs.push({ local, base, remoteTarget, opId })
  }
  for (const { local, base, remoteTarget, opId } of jobs) {
    await enqueueTransfer(terminalId, async () => {
      useTerminalFsStore.getState().upsertTransfer({
        opId,
        terminalId,
        kind: 'upload',
        label: base,
        phase: 'started',
        bytes: 0,
      })
      try {
        await sftpUpload(terminalId, local, remoteTarget, { force: false, opId })
      } catch (e) {
        if (isAlreadyExistsError(e)) {
          const ok = window.confirm(t('terminals.sftp.overwriteConfirm', { name: base }))
          if (!ok) {
            useTerminalFsStore.getState().removeTransfer(opId)
            return
          }
          try {
            await sftpUpload(terminalId, local, remoteTarget, { force: true, opId })
          } catch (e2) {
            useTerminalFsStore.getState().upsertTransfer({
              opId,
              terminalId,
              kind: 'upload',
              label: base,
              phase: 'error',
              bytes: 0,
              message: e2 instanceof Error ? e2.message : String(e2),
            })
          }
        } else {
          useTerminalFsStore.getState().upsertTransfer({
            opId,
            terminalId,
            kind: 'upload',
            label: base,
            phase: 'error',
            bytes: 0,
            message: e instanceof Error ? e.message : String(e),
          })
        }
      }
    })
  }
  await refreshSftpDir(terminalId, dirPath)
}

export async function runSftpDownload(
  terminalId: string,
  remotePath: string,
  name: string,
  t: TFunction,
): Promise<void> {
  const dest = await pickSavePath({
    defaultPath: name,
    title: t('terminals.sftp.saveAs'),
  })
  if (!dest) return
  const opId = mintSftpOpId()
  useTerminalFsStore.getState().upsertTransfer({
    opId,
    terminalId,
    kind: 'download',
    label: name,
    phase: 'queued',
    bytes: 0,
  })
  await enqueueTransfer(terminalId, async () => {
    useTerminalFsStore.getState().upsertTransfer({
      opId,
      terminalId,
      kind: 'download',
      label: name,
      phase: 'started',
      bytes: 0,
    })
    try {
      await sftpDownload(terminalId, remotePath, dest, { force: false, opId })
    } catch (e) {
      if (isAlreadyExistsError(e)) {
        const ok = window.confirm(t('terminals.sftp.overwriteConfirm', { name }))
        if (!ok) {
          useTerminalFsStore.getState().removeTransfer(opId)
          return
        }
        try {
          await sftpDownload(terminalId, remotePath, dest, { force: true, opId })
        } catch (e2) {
          useTerminalFsStore.getState().upsertTransfer({
            opId,
            terminalId,
            kind: 'download',
            label: name,
            phase: 'error',
            bytes: 0,
            message: e2 instanceof Error ? e2.message : String(e2),
          })
        }
      } else {
        useTerminalFsStore.getState().upsertTransfer({
          opId,
          terminalId,
          kind: 'download',
          label: name,
          phase: 'error',
          bytes: 0,
          message: e instanceof Error ? e.message : String(e),
        })
      }
    }
  })
}
