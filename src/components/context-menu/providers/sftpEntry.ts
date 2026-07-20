import { homeDir } from '@tauri-apps/api/path'
import { pickFiles, pickSavePath } from '@/ipc/dialog'
import {
  isAlreadyExistsError,
  mintSftpOpId,
  sftpDownload,
  sftpUpload,
} from '@/ipc/sftp'
import { useTerminalFsStore } from '@/store/terminalFsStore'
import { refreshSftpDir } from '@/components/terminals/TerminalFileTree'
import type { ContextMenuItemDef, ContextPayloadMap, ContextProvider } from '../types'

function parentDir(remotePath: string): string {
  const p = remotePath.replace(/\/+$/, '')
  const i = p.lastIndexOf('/')
  if (i <= 0) return '/'
  return p.slice(0, i) || '/'
}

function localBasename(localPath: string): string {
  const normalized = localPath.replace(/\\/g, '/')
  const parts = normalized.split('/')
  return parts[parts.length - 1] || localPath
}

async function warnIfConfigPath(localPath: string, message: string): Promise<boolean> {
  // Best-effort: warn before uploading paths under ~/.hip/config
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
 * SFTP remote tree entry — download / upload into dir / copy path / refresh.
 */
export const sftpEntryProvider: ContextProvider = (req, ctx) => {
  if (req.kind !== 'sftpEntry') return []
  const { terminalId, path, name, isDir } = req.payload as ContextPayloadMap['sftpEntry']
  if (!terminalId || !path) return []

  const items: ContextMenuItemDef[] = []

  if (!isDir) {
    items.push({
      id: 'sftp.download',
      label: ctx.t('contextMenu.sftp.download'),
      group: 'primary',
      run: () => {
        void (async () => {
          const dest = await pickSavePath({
            defaultPath: name,
            title: ctx.t('terminals.sftp.saveAs'),
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
            await sftpDownload(terminalId, path, dest, { force: false, opId })
          } catch (e) {
            if (isAlreadyExistsError(e)) {
              const ok = window.confirm(ctx.t('terminals.sftp.overwriteConfirm', { name }))
              if (!ok) {
                useTerminalFsStore.getState().removeTransfer(opId)
                return
              }
              try {
                await sftpDownload(terminalId, path, dest, { force: true, opId })
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
        })()
      },
    })
  }

  if (isDir) {
    items.push({
      id: 'sftp.upload',
      label: ctx.t('contextMenu.sftp.upload'),
      group: 'primary',
      run: () => {
        void (async () => {
          const files = await pickFiles({
            multiple: true,
            title: ctx.t('terminals.sftp.pickFiles'),
          })
          if (!files?.length) return
          for (const local of files) {
            const base = localBasename(local)
            if (!(await warnIfConfigPath(local, ctx.t('terminals.sftp.warnConfigPath')))) continue
            const remoteTarget = path.endsWith('/') ? `${path}${base}` : `${path}/${base}`
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
                const ok = window.confirm(
                  ctx.t('terminals.sftp.overwriteConfirm', { name: base }),
                )
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
          void refreshSftpDir(terminalId, path)
        })()
      },
    })

    items.push({
      id: 'sftp.refresh',
      label: ctx.t('contextMenu.sftp.refresh'),
      group: 'workspace',
      run: () => {
        void refreshSftpDir(terminalId, path)
      },
    })
  }

  items.push({
    id: 'sftp.copyPath',
    label: ctx.t('contextMenu.sftp.copyPath'),
    group: 'clipboard',
    run: () => {
      void ctx.copyText(path)
    },
  })

  items.push({
    id: 'sftp.copyName',
    label: ctx.t('contextMenu.sftp.copyName'),
    group: 'clipboard',
    run: () => {
      void ctx.copyText(name)
    },
  })

  // Parent refresh for files after ops (download doesn't change remote).
  if (!isDir) {
    items.push({
      id: 'sftp.refreshParent',
      label: ctx.t('contextMenu.sftp.refresh'),
      group: 'workspace',
      run: () => {
        void refreshSftpDir(terminalId, parentDir(path))
      },
    })
  }

  return items
}
