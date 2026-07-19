import { useSyncExternalStore } from 'react'

/**
 * Bridge so context-menu provider and WorktreeControl row menu can open the
 * shared delete confirm Modal without closing over React component state.
 */
export type WorktreeDeleteTarget = {
  hostSessionId: string
  worktreePath: string
  label: string
  branch?: string
  slotSessionId?: string
  /** Audit reason passed to defensive slot deleteSession. */
  reason?: string
}

let target: WorktreeDeleteTarget | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

export function getWorktreeDeleteTarget(): WorktreeDeleteTarget | null {
  return target
}

export function subscribeWorktreeDeleteDialog(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function openWorktreeDeleteDialog(next: WorktreeDeleteTarget): void {
  target = next
  emit()
}

export function closeWorktreeDeleteDialog(): void {
  if (target === null) return
  target = null
  emit()
}

/** Test helper: reset pending dialog. */
export function resetWorktreeDeleteDialogStore(): void {
  target = null
  emit()
}

export function useWorktreeDeleteTarget(): WorktreeDeleteTarget | null {
  return useSyncExternalStore(
    subscribeWorktreeDeleteDialog,
    getWorktreeDeleteTarget,
    () => null,
  )
}
