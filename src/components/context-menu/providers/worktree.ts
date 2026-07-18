import { toast } from 'sonner'
import { sessionService } from '@/domain'
import { selectSessionFromSidebar } from '@/components/layout/sidebarActions'
import type { ContextMenuItemDef, ContextProvider } from '../types'

async function removeWorktreeRow(
  hostSessionId: string,
  worktreePath: string,
  label: string,
  force: boolean,
  slotSessionId: string | undefined,
  t: (key: string, opts?: Record<string, string>) => string,
): Promise<void> {
  const r = await sessionService.removeWorktree(hostSessionId, worktreePath, force)
  if (!r.ok) {
    toast.error(r.error || t('contextMenu.worktree.removeFailed', { label }))
    return
  }
  toast.success(
    force
      ? t('contextMenu.worktree.removedForce', { label })
      : t('contextMenu.worktree.removed', { label }),
  )
  // Cascade via worktree:changed usually deletes bound *slot* sessions; defensive cleanup if event missed.
  // Never invent a host-session id here — only the explicit slot binding is safe.
  if (slotSessionId) {
    try {
      sessionService.deleteSession(slotSessionId, {
        reason: 'worktree-menu',
        meta: { hostSessionId, worktreePath, label, force },
      })
    } catch {
      /* ignore */
    }
  }
}

/** Nested worktree row: open host/slot, copy path, remove worktree (+ bound slot session). */
export const worktreeProvider: ContextProvider = (req, ctx) => {
  if (req.kind !== 'worktree') return []
  const { hostSessionId, worktreePath, label, slotSessionId } = req.payload
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
        void removeWorktreeRow(hostSessionId, worktreePath, label, false, slotSessionId, t)
      },
    },
    {
      id: 'worktree.removeForce',
      label: t('contextMenu.worktree.removeForce'),
      group: 'danger',
      danger: true,
      run: () => {
        void removeWorktreeRow(hostSessionId, worktreePath, label, true, slotSessionId, t)
      },
    },
  ]

  return items
}
