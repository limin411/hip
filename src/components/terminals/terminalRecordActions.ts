import { useDomainStore } from '@/domain/sessionStore'
import { useManagedTerminalStore, type ManagedTerminal } from '@/store/managedTerminalStore'
import { terminalSessionsFor } from '@/store/terminalAgentStore'
import { useTerminalHostStore } from '@/store/terminalHostStore'
import { disposeTerminal } from '@/domain/terminalLifecycle'

/**
 * Cascade delete for a managed terminal record (D12/Q7): close online SSH first,
 * soft-delete all its terminal agent sessions into the recycle bin, then remove
 * the record. Child sessions remain recoverable from the recycle bin.
 */
export async function deleteTerminalRecord(term: ManagedTerminal): Promise<void> {
  const { sessionService } = await import('@/domain')
  const sessions = terminalSessionsFor(useDomainStore.getState().sessions, term.id)
  // Close online backend (keeps record per D12, then we remove it below).
  if (term.kind === 'ssh' && term.status === 'connected') {
    try {
      await useManagedTerminalStore.getState().close(term.id)
    } catch {
      /* record removal below still proceeds */
    }
  } else {
    // Isomorphic to the close !term sequence (ring → fs cache, no agent state).
    disposeTerminal(term.id, { clearAgent: false })
  }
  for (const s of sessions) {
    sessionService.trashSession(s.id, { reason: 'terminal-record-delete' })
  }
  useManagedTerminalStore.getState().removeRecord(term.id)
}

/**
 * Delete a Host configuration (D14): cascade-close online records, soft-delete
 * every related connection record + terminal agent conversation (recycle bin),
 * then remove the host row and its recents.
 */
export async function deleteHostWithCascade(hostId: string): Promise<void> {
  const { sessionService } = await import('@/domain')
  const managed = useManagedTerminalStore.getState().terminals.filter(
    (t) => t.hostId === hostId,
  )
  for (const term of managed) {
    const sessions = terminalSessionsFor(useDomainStore.getState().sessions, term.id)
    if (term.status === 'connected') {
      try {
        await useManagedTerminalStore.getState().close(term.id)
      } catch {
        /* proceed */
      }
    }
    for (const s of sessions) {
      sessionService.trashSession(s.id, { reason: 'host-delete' })
    }
    useManagedTerminalStore.getState().removeRecord(term.id)
  }
  // Any terminal sessions whose hostId points to the deleted host but whose
  // managed record is already gone (restart orphans / edge cases) also go to trash.
  const orphans = useDomainStore
    .getState()
    .sessions.filter((s) => s.config.surface === 'terminal' && s.config.hostId === hostId)
  for (const s of orphans) {
    sessionService.trashSession(s.id, { reason: 'host-delete' })
  }
  useTerminalHostStore.getState().removeHost(hostId)
}

/** Count related records/sessions for a host (D14 confirm box). */
export function hostDeleteCounts(hostId: string): { records: number; sessions: number } {
  const records = useManagedTerminalStore
    .getState()
    .terminals.filter((t) => t.hostId === hostId).length
  const sessions = useDomainStore
    .getState()
    .sessions.filter((s) => s.config.surface === 'terminal' && s.config.hostId === hostId)
    .length
  return { records, sessions }
}
