import { sessionService } from '@/domain'
import { openContainingFolder } from '@/ipc/openPath'
import { isPathUnderRoot, normalizeFsPath } from '@/lib/pathBoundary'
import { previewKind } from '@/components/artifact/previewKind'
import type { ContextMenuItemDef, ContextPayloadMap, ContextProvider } from '../types'

/** True when preview content is plain text / markdown / source code (not image/pdf/html binary). */
function canCopyContent(path: string, mimeType?: string, content?: string): boolean {
  if (content == null || content === '') return false
  const kind = previewKind(path, mimeType)
  return kind === 'text' || kind === 'markdown' || kind === 'code'
}

/**
 * File preview provider — copy path/content, open containing folder, refresh.
 * Trust: open folder only when path is under session/draft cwd.
 * Refresh: session via activeSessionId; draft via cwd-keyed readDraftFile.
 */
export const filePreviewProvider: ContextProvider = (req, ctx) => {
  if (req.kind !== 'filePreview') return []
  const { path, content, mimeType, cwd } = req.payload as ContextPayloadMap['filePreview']
  if (!path) return []

  const items: ContextMenuItemDef[] = []
  const outsideCwd = !cwd || !isPathUnderRoot(path, cwd)
  const textCopyable = canCopyContent(path, mimeType, content)

  items.push({
    id: 'filePreview.copyPath',
    label: ctx.t('contextMenu.filePreview.copyPath'),
    group: 'clipboard',
    run: () => {
      void ctx.copyText(normalizeFsPath(path) || path)
    },
  })

  items.push({
    id: 'filePreview.copyContent',
    label: ctx.t('contextMenu.filePreview.copyContent'),
    group: 'clipboard',
    disabled: !textCopyable,
    disabledReason: !textCopyable
      ? ctx.t('contextMenu.filePreview.contentNotText')
      : undefined,
    run: () => {
      if (!textCopyable || content == null) return
      void ctx.copyText(content)
    },
  })

  items.push({
    id: 'filePreview.openContainingFolder',
    label: ctx.t('contextMenu.filePreview.openContainingFolder'),
    group: 'navigation',
    disabled: outsideCwd,
    disabledReason: outsideCwd ? ctx.t('contextMenu.file.pathOutsideCwd') : undefined,
    run: () => {
      if (outsideCwd) return
      void openContainingFolder(path, { cwd, isDir: false })
    },
  })

  items.push({
    id: 'filePreview.refresh',
    label: ctx.t('contextMenu.filePreview.refresh'),
    group: 'workspace',
    run: () => {
      // Committed session wins; draft FS is cwd-keyed with no active session.
      if (ctx.activeSessionId) sessionService.readFile(ctx.activeSessionId, path)
      else if (cwd) sessionService.readDraftFile(cwd, path)
    },
  })

  return items
}
