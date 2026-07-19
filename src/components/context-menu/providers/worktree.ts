import { toast } from 'sonner'
import { openWorktreeDeleteDialog } from '@/components/chat/WorktreeControl/worktreeDeleteDialogStore'
import { selectSessionFromSidebar } from '@/components/layout/sidebarActions'
import type { ContextMenuItemDef, ContextProvider } from '../types'

/** Nested worktree row: open host/slot, copy path, delete (confirm Modal + dirty progressive force). */
export const worktreeProvider: ContextProvider = (req, ctx) => {
  if (req.kind !== 'worktree') return []
  const { hostSessionId, worktreePath, label, branch, slotSessionId } = req.payload
  const t = (key: string, opts?: Record<string, string>) =>
    opts ? ctx.t(key, opts) : ctx.t(key)

  const items: ContextMenuItemDef[] = [
    {
      id: 'worktree.openHost',
      label: t('contextMenu.worktree.openHost'),
      group: 'primary',
      run: () => {
        void selectSessionFromSidebar(slotSessionId || hostSessionId)
      },
    },
    {
      id: 'worktree.copyPath',
      label: t('contextMenu.worktree.copyPath'),
      group: 'clipboard',
      run: () => {
        void navigator.clipboard.writeText(worktreePath).then(
          () => {
            toast.success(t('contextMenu.worktree.pathCopied'))
          },
          () => {
            toast.error(t('contextMenu.worktree.copyFailed'))
          },
        )
      },
    },
    {
      id: 'worktree.remove',
      label: t('contextMenu.worktree.remove'),
      group: 'danger',
      danger: true,
      run: () => {
        openWorktreeDeleteDialog({
          hostSessionId,
          worktreePath,
          label,
          branch: branch || undefined,
          slotSessionId,
          reason: 'worktree-menu',
        })
      },
    },
  ]

  return items
}
