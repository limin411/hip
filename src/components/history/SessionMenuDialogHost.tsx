import { sessionService } from '@/domain'
import { RenameSessionDialog } from './RenameSessionDialog'
import { DeleteSessionDialog } from './DeleteSessionDialog'
import { ConfirmDeleteSessionsDialog } from './ConfirmDeleteSessionsDialog'
import {
  closeSessionMenuDialog,
  useSessionMenuDialog,
} from './sessionMenuDialogStore'

/**
 * Global host for session context-menu dialogs (rename, history delete, bulk tab delete).
 * Mount once near app chrome (e.g. AppLayout).
 */
export function SessionMenuDialogHost() {
  const dialog = useSessionMenuDialog()
  if (!dialog) return null

  if (dialog.kind === 'rename') {
    return (
      <RenameSessionDialog
        title={dialog.title}
        onCancel={closeSessionMenuDialog}
        onConfirm={(nextTitle) => {
          sessionService.renameSession(dialog.sessionId, nextTitle)
          closeSessionMenuDialog()
        }}
      />
    )
  }

  if (dialog.kind === 'deleteSession') {
    return (
      <DeleteSessionDialog
        title={dialog.title}
        onCancel={closeSessionMenuDialog}
        onConfirm={(opts) => {
          sessionService.deleteSession(dialog.sessionId, opts)
          closeSessionMenuDialog()
        }}
      />
    )
  }

  // confirmBulkDelete
  const { sessionIds } = dialog
  return (
    <ConfirmDeleteSessionsDialog
      count={sessionIds.length}
      onCancel={closeSessionMenuDialog}
      onConfirm={() => {
        for (const id of sessionIds) {
          sessionService.closeSession(id)
        }
        closeSessionMenuDialog()
      }}
    />
  )
}
