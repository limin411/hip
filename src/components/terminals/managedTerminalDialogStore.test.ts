import { describe, it, expect, beforeEach } from 'vitest'
import {
  closeManagedTerminalDialog,
  getManagedTerminalDialog,
  openRenameManagedTerminalDialog,
  resetManagedTerminalDialogStore,
} from './managedTerminalDialogStore'

describe('managedTerminalDialogStore', () => {
  beforeEach(() => {
    resetManagedTerminalDialogStore()
  })

  it('openRename sets dialog and close clears it', () => {
    openRenameManagedTerminalDialog('tm_1', 'shell')
    expect(getManagedTerminalDialog()).toEqual({
      kind: 'rename',
      terminalId: 'tm_1',
      title: 'shell',
    })
    closeManagedTerminalDialog()
    expect(getManagedTerminalDialog()).toBeNull()
  })
})
