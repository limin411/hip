import { sessionService } from '@/domain/sessionService'
import { useDiffStore } from '@/store/diffStore'
import { useFsStore } from '@/store/fsStore'
import { useUiStore } from '@/store/uiStore'
import { resolvePathUnderCwd } from '@/lib/pathScope'
import type { ContextMenuItemDef, ContextProvider } from '../types'

/**
 * Diff file header: copy path(s), open in Files, collapse/expand, show/collapse full context.
 * Full-context actions only when the path is in the session workspace diff (Changes), not checkpoint-only.
 */
export const diffFileProvider: ContextProvider = (req, ctx) => {
  if (req.kind !== 'diffFile') return []
  const { path, sessionId, cwd } = req.payload
  if (!path) return []

  const items: ContextMenuItemDef[] = []

  items.push({
    id: 'diffFile.copyPath',
    label: ctx.t('contextMenu.diffFile.copyPath'),
    group: 'clipboard',
    icon: 'code',
    run: () => {
      void ctx.copyText(path)
    },
  })

  const abs = resolvePathUnderCwd(cwd, path)
  if (abs) {
    items.push({
      id: 'diffFile.copyAbsolutePath',
      label: ctx.t('contextMenu.diffFile.copyAbsolutePath'),
      group: 'clipboard',
      run: () => {
        void ctx.copyText(abs)
      },
    })
  }

  if (sessionId && abs) {
    items.push({
      id: 'diffFile.openInFiles',
      label: ctx.t('contextMenu.diffFile.openInFiles'),
      group: 'navigation',
      icon: 'code',
      run: () => {
        useUiStore.getState().setTab('files')
        useFsStore.getState().setActive(sessionId, abs)
        sessionService.readFile(sessionId, abs)
      },
    })
  }

  if (sessionId) {
    const sess = useDiffStore.getState().bySession[sessionId]
    const isCollapsed = !!sess?.collapsed[path]
    items.push({
      id: 'diffFile.toggleCollapse',
      label: ctx.t(
        isCollapsed ? 'contextMenu.diffFile.expand' : 'contextMenu.diffFile.collapse',
      ),
      group: 'edit',
      run: () => {
        useDiffStore.getState().toggleCollapsed(sessionId, path)
      },
    })

    // Workspace uncommitted files only (ChangesView show-full); checkpoint diffs omit this.
    const isWorkspaceFile = !!sess?.files.some((f) => f.path === path)
    if (isWorkspaceFile) {
      const isExpanded = !!sess?.expanded[path]
      if (!isExpanded) {
        items.push({
          id: 'diffFile.showFull',
          label: ctx.t('contextMenu.diffFile.showFull'),
          group: 'edit',
          run: () => {
            sessionService.requestDiffFile(sessionId, path, 'full')
          },
        })
      } else {
        items.push({
          id: 'diffFile.collapseFull',
          label: ctx.t('contextMenu.diffFile.collapseFull'),
          group: 'edit',
          run: () => {
            useDiffStore.getState().collapseFile(sessionId, path)
          },
        })
      }
    }
  }

  return items
}
