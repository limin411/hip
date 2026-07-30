import { useSyncExternalStore } from 'react'

/**
 * Promise-based confirm bridge for LKD-8 unsupported legacy board replace.
 * flushSave awaits {@link requestLegacyBoardReplaceConfirm}; the host Modal
 * resolves the promise. Replaces window.confirm (PR-M).
 */
export type LegacyBoardReplaceDialog = {
  boardId: string
}

type Pending = LegacyBoardReplaceDialog & {
  resolve: (ok: boolean) => void
}

let pending: Pending | null = null
/** Stable snapshot for useSyncExternalStore (must not allocate on each get). */
let snapshot: LegacyBoardReplaceDialog | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

export function getLegacyBoardReplaceDialog(): LegacyBoardReplaceDialog | null {
  return snapshot
}

export function subscribeLegacyBoardReplaceDialog(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Show the replace confirm Modal and resolve when the user chooses.
 * A second request while one is open cancels the previous as false.
 */
export function requestLegacyBoardReplaceConfirm(boardId: string): Promise<boolean> {
  if (pending) {
    const prev = pending
    pending = null
    prev.resolve(false)
  }
  return new Promise<boolean>((resolve) => {
    pending = { boardId, resolve }
    snapshot = { boardId }
    emit()
  })
}

/** Resolve the open dialog (confirm / cancel / dismiss). */
export function resolveLegacyBoardReplaceConfirm(ok: boolean): void {
  if (!pending) return
  const p = pending
  pending = null
  snapshot = null
  emit()
  p.resolve(ok)
}

/** Test helper: cancel any pending request as false and clear. */
export function resetLegacyBoardReplaceDialogStore(): void {
  if (pending) {
    const p = pending
    pending = null
    snapshot = null
    emit()
    p.resolve(false)
  } else if (snapshot !== null) {
    snapshot = null
    emit()
  }
}

export function useLegacyBoardReplaceDialog(): LegacyBoardReplaceDialog | null {
  return useSyncExternalStore(
    subscribeLegacyBoardReplaceDialog,
    getLegacyBoardReplaceDialog,
    () => null,
  )
}
