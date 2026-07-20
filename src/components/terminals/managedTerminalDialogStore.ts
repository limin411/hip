import { useSyncExternalStore } from 'react'

/**
 * Bridge so managed-terminal context menu can open a rename dialog
 * without closing over React component state.
 * Rename is process-ephemeral (display title only — not host catalog).
 */
export type ManagedTerminalDialog = {
  kind: 'rename'
  terminalId: string
  title: string
}

let dialog: ManagedTerminalDialog | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

export function getManagedTerminalDialog(): ManagedTerminalDialog | null {
  return dialog
}

export function subscribeManagedTerminalDialog(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function openRenameManagedTerminalDialog(terminalId: string, title: string): void {
  dialog = { kind: 'rename', terminalId, title }
  emit()
}

export function closeManagedTerminalDialog(): void {
  if (dialog === null) return
  dialog = null
  emit()
}

/** Test helper. */
export function resetManagedTerminalDialogStore(): void {
  dialog = null
  emit()
}

export function useManagedTerminalDialog(): ManagedTerminalDialog | null {
  return useSyncExternalStore(subscribeManagedTerminalDialog, getManagedTerminalDialog, () => null)
}
