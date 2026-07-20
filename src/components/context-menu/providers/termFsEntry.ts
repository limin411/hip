import { openContainingFolder } from '@/ipc/openPath'
import { refreshLocalDir } from '@/components/terminals/termFsActions'
import { normalizeFsPath } from '@/lib/pathBoundary'
import type { ContextMenuItemDef, ContextPayloadMap, ContextProvider } from '../types'

function parentDir(localPath: string): string {
  const normalized = localPath.replace(/\\/g, '/').replace(/\/+$/, '')
  const i = normalized.lastIndexOf('/')
  if (i <= 0) return normalized || '/'
  return normalized.slice(0, i) || '/'
}

/**
 * Local managed-terminal tree entry — copy path, refresh, open containing folder.
 */
export const termFsEntryProvider: ContextProvider = (req, ctx) => {
  if (req.kind !== 'termFsEntry') return []
  const { terminalId, path, name, isDir, rootCwd } = req.payload as ContextPayloadMap['termFsEntry']
  if (!terminalId || !path) return []

  const items: ContextMenuItemDef[] = []

  items.push({
    id: 'termFs.copyPath',
    label: ctx.t('contextMenu.termFs.copyPath'),
    group: 'clipboard',
    run: () => {
      void ctx.copyText(normalizeFsPath(path) || path)
    },
  })

  items.push({
    id: 'termFs.copyName',
    label: ctx.t('contextMenu.termFs.copyName'),
    group: 'clipboard',
    run: () => {
      void ctx.copyText(name)
    },
  })

  if (isDir) {
    items.push({
      id: 'termFs.refresh',
      label: ctx.t('contextMenu.termFs.refresh'),
      group: 'workspace',
      run: () => {
        void refreshLocalDir(terminalId, path)
      },
    })
  } else {
    items.push({
      id: 'termFs.refreshParent',
      label: ctx.t('contextMenu.termFs.refresh'),
      group: 'workspace',
      run: () => {
        void refreshLocalDir(terminalId, parentDir(path))
      },
    })
  }

  const cwd = rootCwd?.trim() || null
  items.push({
    id: 'termFs.openContainingFolder',
    label: ctx.t('contextMenu.termFs.openContainingFolder'),
    group: 'navigation',
    disabled: !cwd,
    disabledReason: !cwd ? ctx.t('contextMenu.file.pathOutsideCwd') : undefined,
    run: () => {
      if (!cwd) return
      void openContainingFolder(path, { cwd, isDir })
    },
  })

  return items
}
