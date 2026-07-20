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

function localBasename(localPath: string): string {
  const normalized = localPath.replace(/\\/g, '/')
  const parts = normalized.split('/')
  return parts[parts.length - 1] || localPath
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

/** List a remote dir; set rootPath on first success (Issue 1). */
export async function loadSftpDir(terminalId: string, path: string): Promise<void> {
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
          continue
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
}
