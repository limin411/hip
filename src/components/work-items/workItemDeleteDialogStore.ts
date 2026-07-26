import { useSyncExternalStore } from 'react'

/**
 * Bridge so work-item context menus (and the editor footer) open a shared
 * soft-delete confirm Modal without nesting inside the editor.
 * Pattern matches sessionMenuDialogStore.
 */
export type WorkItemDeleteDialog = {
  itemId: string
  title: string
}

let dialog: WorkItemDeleteDialog | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

export function getWorkItemDeleteDialog(): WorkItemDeleteDialog | null {
  return dialog
}

export function subscribeWorkItemDeleteDialog(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function openWorkItemDeleteDialog(itemId: string, title: string): void {
  dialog = { itemId, title }
  emit()
}

export function closeWorkItemDeleteDialog(): void {
  if (dialog === null) return
  dialog = null
  emit()
}

/** Test helper: reset pending dialog. */
export function resetWorkItemDeleteDialogStore(): void {
  dialog = null
  emit()
}

export function useWorkItemDeleteDialog(): WorkItemDeleteDialog | null {
  return useSyncExternalStore(
    subscribeWorkItemDeleteDialog,
    getWorkItemDeleteDialog,
    () => null,
  )
}
