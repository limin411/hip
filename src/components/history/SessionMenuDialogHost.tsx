import { sessionService } from '@/domain'
import { RenameSessionDialog } from './RenameSessionDialog'
import { DeleteSessionDialog } from './DeleteSessionDialog'
import {
  closeSessionMenuDialog,
  useSessionMenuDialog,
} from './sessionMenuDialogStore'

/**
 * Global host for session context-menu dialogs (rename, permanent delete).
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
