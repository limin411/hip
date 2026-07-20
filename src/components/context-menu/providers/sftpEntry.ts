import {
  refreshSftpDir,
  runSftpDownload,
  runSftpUploadIntoDir,
} from '@/components/terminals/sftpActions'
import type { ContextMenuItemDef, ContextPayloadMap, ContextProvider } from '../types'

function parentDir(remotePath: string): string {
  const p = remotePath.replace(/\/+$/, '')
  const i = p.lastIndexOf('/')
  if (i <= 0) return '/'
  return p.slice(0, i) || '/'
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
        void runSftpDownload(terminalId, path, name, ctx.t)
      },
    })
  }

  if (isDir) {
    items.push({
      id: 'sftp.upload',
      label: ctx.t('contextMenu.sftp.upload'),
      group: 'primary',
      run: () => {
        void runSftpUploadIntoDir(terminalId, path, ctx.t)
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
