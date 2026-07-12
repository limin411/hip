import { sessionService } from '@/domain'
import { openContainingFolder } from '@/ipc/openPath'
import { normalizeFsPath, relativeToRoot } from '@/lib/pathBoundary'
import { useFsStore } from '@/store/fsStore'
import type { ContextMenuItemDef, ContextPayloadMap, ContextProvider } from '../types'

/**
 * File tree entry provider — copy paths / open containing folder / open / refresh.
 * No FS write ops (new/delete/rename are P2).
 * Draft FS: uses payload.isDraft + lsDraft / readDraftFile (scopeId is cwd for drafts).
 */
export const fileEntryProvider: ContextProvider = (req, ctx) => {
  if (req.kind !== 'fileEntry') return []
  // ContextRequest is not a discriminated union at the provider signature; narrow payload.
  const { path, name, isDir, scopeId, isDraft, cwd } = req.payload as ContextPayloadMap['fileEntry']
  const items: ContextMenuItemDef[] = []

  items.push({
    id: 'file.open',
    label: ctx.t('contextMenu.file.open'),
    group: 'primary',
    run: () => {
      if (isDir) {
        useFsStore.getState().toggleExpanded(scopeId, path)
        const children = useFsStore.getState().bySession[scopeId]?.entriesByDir[path]
        if (!children) {
          if (isDraft) sessionService.lsDraft(scopeId, path)
          else sessionService.lsDir(scopeId, path)
        }
      } else {
        useFsStore.getState().setActive(scopeId, path)
        if (isDraft) sessionService.readDraftFile(scopeId, path)
        else sessionService.readFile(scopeId, path)
      }
    },
  })

  items.push({
    id: 'file.copyPath',
    label: ctx.t('contextMenu.file.copyPath'),
    group: 'clipboard',
    run: () => {
      void ctx.copyText(normalizeFsPath(path) || path)
    },
  })

  const rel = cwd ? relativeToRoot(path, cwd) : null
  items.push({
    id: 'file.copyRelativePath',
    label: ctx.t('contextMenu.file.copyRelativePath'),
    group: 'clipboard',
    disabled: rel === null,
    disabledReason: rel === null ? ctx.t('contextMenu.file.pathOutsideCwd') : undefined,
    run: () => {
      if (rel === null) return
      void ctx.copyText(rel)
    },
  })

  items.push({
    id: 'file.copyName',
    label: ctx.t('contextMenu.file.copyName'),
    group: 'clipboard',
    run: () => {
      void ctx.copyText(name)
    },
  })

  // Same trust gate as relative copy: missing cwd or path outside cwd.
  const outsideCwd = rel === null
  items.push({
    id: 'file.openContainingFolder',
    label: ctx.t('contextMenu.file.openContainingFolder'),
    group: 'navigation',
    disabled: outsideCwd,
    disabledReason: outsideCwd ? ctx.t('contextMenu.file.pathOutsideCwd') : undefined,
    run: () => {
      if (outsideCwd) return
      void openContainingFolder(path, { cwd, isDir })
    },
  })

  if (isDir) {
    items.push({
      id: 'file.refresh',
      label: ctx.t('contextMenu.file.refresh'),
      group: 'workspace',
      run: () => {
        if (isDraft) sessionService.lsDraft(scopeId, path)
        else sessionService.lsDir(scopeId, path)
      },
    })
  }

  return items
}
