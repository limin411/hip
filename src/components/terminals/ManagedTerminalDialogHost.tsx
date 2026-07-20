import { useTranslation } from 'react-i18next'
import { RenameSessionDialog } from '@/components/history/RenameSessionDialog'
import { useManagedTerminalStore } from '@/store/managedTerminalStore'
import {
  closeManagedTerminalDialog,
  useManagedTerminalDialog,
} from './managedTerminalDialogStore'

/**
 * Global host for managed-terminal context-menu dialogs (ephemeral rename).
 * Mount once near app chrome (AppLayout).
 */
export function ManagedTerminalDialogHost() {
  const { t } = useTranslation()
  const dialog = useManagedTerminalDialog()
  if (!dialog) return null

  if (dialog.kind === 'rename') {
    return (
      <RenameSessionDialog
        title={dialog.title}
        dialogTitle={t('contextMenu.managedTerminal.renameTitle')}
        description={t('contextMenu.managedTerminal.renameDescription')}
        label={t('contextMenu.managedTerminal.renameLabel')}
        saveLabel={t('contextMenu.managedTerminal.renameSave')}
        inputTestId="rename-managed-terminal-input"
        confirmTestId="rename-managed-terminal-confirm"
        onCancel={closeManagedTerminalDialog}
        onConfirm={(nextTitle) => {
          useManagedTerminalStore.getState().setTitle(dialog.terminalId, nextTitle)
          closeManagedTerminalDialog()
        }}
      />
    )
  }

  return null
}
