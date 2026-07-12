import { useSyncExternalStore } from 'react'

/**
 * Lightweight bridge so context-menu providers can open rename / delete dialogs
 * without closing over React component state.
 */
export type SessionMenuDialog =
  | { kind: 'rename'; sessionId: string; title: string }
  | { kind: 'deleteSession'; sessionId: string; title: string }
  | { kind: 'confirmBulkDelete'; sessionIds: string[] }

let dialog: SessionMenuDialog | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

export function getSessionMenuDialog(): SessionMenuDialog | null {
  return dialog
}

export function subscribeSessionMenuDialog(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function openRenameSessionDialog(sessionId: string, title: string): void {
  dialog = { kind: 'rename', sessionId, title }
  emit()
}

export function openDeleteSessionDialog(sessionId: string, title: string): void {
  dialog = { kind: 'deleteSession', sessionId, title }
  emit()
}

export function openConfirmDeleteSessionsDialog(sessionIds: string[]): void {
  dialog = { kind: 'confirmBulkDelete', sessionIds: sessionIds.slice() }
  emit()
}

export function closeSessionMenuDialog(): void {
  if (dialog === null) return
  dialog = null
  emit()
}

/** Test helper: reset pending dialog. */
export function resetSessionMenuDialogStore(): void {
  dialog = null
  emit()
}

export function useSessionMenuDialog(): SessionMenuDialog | null {
  return useSyncExternalStore(subscribeSessionMenuDialog, getSessionMenuDialog, () => null)
}
