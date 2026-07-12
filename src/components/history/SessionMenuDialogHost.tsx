import { sessionService, useDomainStore } from '@/domain'
import { RenameSessionDialog } from './RenameSessionDialog'
import { DeleteSessionDialog } from './DeleteSessionDialog'
import { ConfirmDeleteSessionsDialog } from './ConfirmDeleteSessionsDialog'
import { orderBulkCloseIds } from './orderBulkCloseIds'
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

  // confirmBulkDelete — close non-active first to avoid mid-loop select/load thrash
  const { sessionIds } = dialog
  return (
    <ConfirmDeleteSessionsDialog
      count={sessionIds.length}
      onCancel={closeSessionMenuDialog}
      onConfirm={() => {
        const activeId = useDomainStore.getState().activeSessionId
        for (const id of orderBulkCloseIds(sessionIds, activeId)) {
          sessionService.closeSession(id)
        }
        closeSessionMenuDialog()
      }}
    />
  )
}
