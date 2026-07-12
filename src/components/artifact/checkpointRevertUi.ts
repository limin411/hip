/**
 * UI bridge so checkpoint context-menu "Revert…" opens TimelineView's existing confirm modal.
 * No domain logic — TimelineView owns openRevert / Modal / sessionService.revertCheckpoint.
 */

type Opener = (checkpointId: string) => void

let opener: Opener | null = null

/** TimelineView registers its openRevert while mounted. */
export function bindCheckpointRevertOpener(fn: Opener | null): void {
  opener = fn
}

/** Provider run() entry — no-ops if Timeline is not mounted. */
export function openCheckpointRevertModal(checkpointId: string): void {
  opener?.(checkpointId)
}
