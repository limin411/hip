import { useSyncExternalStore } from 'react'

/**
 * Bridge so sidebar context menus / empty-state CTAs can open create / rename /
 * delete space dialogs without closing over React component state.
 */
export type KnowledgeSpaceDialog =
  | { kind: 'create' }
  | { kind: 'rename'; spaceId: string; name: string; icon?: string }
  | { kind: 'delete'; spaceId: string; name: string }

let dialog: KnowledgeSpaceDialog | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

export function getKnowledgeSpaceDialog(): KnowledgeSpaceDialog | null {
  return dialog
}

export function subscribeKnowledgeSpaceDialog(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function openCreateKnowledgeSpaceDialog(): void {
  dialog = { kind: 'create' }
  emit()
}

export function openRenameKnowledgeSpaceDialog(
  spaceId: string,
  name: string,
  icon?: string,
): void {
  dialog = { kind: 'rename', spaceId, name, icon }
  emit()
}

export function openDeleteKnowledgeSpaceDialog(spaceId: string, name: string): void {
  dialog = { kind: 'delete', spaceId, name }
  emit()
}

export function closeKnowledgeSpaceDialog(): void {
  if (dialog === null) return
  dialog = null
  emit()
}

/** Test helper: reset pending dialog. */
export function resetKnowledgeSpaceDialogStore(): void {
  dialog = null
  emit()
}

export function useKnowledgeSpaceDialog(): KnowledgeSpaceDialog | null {
  return useSyncExternalStore(
    subscribeKnowledgeSpaceDialog,
    getKnowledgeSpaceDialog,
    () => null,
  )
}
