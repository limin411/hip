import { toast } from 'sonner'
import { openCheckpointRevertModal } from '@/components/artifact/checkpointRevertUi'
import type { ContextMenuItemDef, ContextProvider } from '../types'

/**
 * Timeline checkpoint row: copy id; Revert… opens TimelineView's existing confirm modal.
 */
export const checkpointProvider: ContextProvider = (req, ctx) => {
  if (req.kind !== 'checkpoint') return []
  const { checkpointId } = req.payload
  if (!checkpointId) return []

  const items: ContextMenuItemDef[] = [
    {
      id: 'checkpoint.copyId',
      label: ctx.t('contextMenu.checkpoint.copyId'),
      group: 'clipboard',
      run: () => {
        void ctx.copyText(checkpointId)
      },
    },
    {
      id: 'checkpoint.revert',
      label: ctx.t('contextMenu.checkpoint.revert'),
      group: 'danger',
      danger: true,
      icon: 'history',
      disabled: ctx.sessionStatus === 'running',
      disabledReason:
        ctx.sessionStatus === 'running'
          ? ctx.t('artifact.timelineView.revertBlockedRunning')
          : undefined,
      run: () => {
        if (ctx.sessionStatus === 'running') {
          toast.message(ctx.t('artifact.timelineView.revertBlockedRunning'))
          return
        }
        openCheckpointRevertModal(checkpointId)
      },
    },
  ]
  return items
}
