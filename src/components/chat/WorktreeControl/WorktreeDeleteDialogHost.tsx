import { WorktreeDeleteDialog } from './WorktreeDeleteDialog'
import {
  closeWorktreeDeleteDialog,
  useWorktreeDeleteTarget,
} from './worktreeDeleteDialogStore'

/**
 * Global host for worktree delete confirm (composer row menu + sidebar context menu).
 * Mount once near app chrome (e.g. AppLayout).
 */
export function WorktreeDeleteDialogHost() {
  const target = useWorktreeDeleteTarget()
  if (!target) return null
  return <WorktreeDeleteDialog target={target} onClose={closeWorktreeDeleteDialog} />
}
