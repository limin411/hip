// src/domain/terminalLifecycle.ts
/**
 * Terminal lifecycle coordination layer (spec docs/design/2026-08-07-terminal-store-coupling-spec.md).
 *
 * The single cross-store write point for managed-terminal lifecycle side
 * effects. `managedTerminalStore` keeps its own state (`set`) but delegates
 * every ring / fs-cache / agent-exec / host-catalog write here, so the store
 * layer stays single-direction (R1/R2, R3 cancelled 2026-08).
 *
 * Call ordering is a contract (locked by terminalLifecycle.test.ts):
 *   dispose: clearSession (ring) → clearTerminal (fs cache) → agent exec state
 *   reconnect: clearSession → ensureSession → clearTerminal → setExecFlight(null)
 */
import { useTerminalStore } from '@/store/terminalStore'
import { useTerminalFsStore } from '@/store/terminalFsStore'
import { useTerminalAgentStore } from '@/store/terminalAgentStore'
import { useTerminalHostStore } from '@/store/terminalHostStore'
import type { RecentLaunch } from '@/ipc/terminalHosts'
import type { ManagedTerminal } from '../store/managedTerminalStore'

/** Open a terminal: ensure the ring session exists (openLocal/openSsh behavior). */
export function ensureTerminalSession(id: string): void {
  useTerminalStore.getState().ensureSession(id)
}

/**
 * Close/remove a terminal: clear cross-store residue in a fixed order
 * (ring → fs cache → agent exec state). `clearAgent` defaults true; pass
 * `{ clearAgent: false }` for the SSH-only close path that never touched
 * agent state (current `close` !term branch).
 */
export function disposeTerminal(id: string, opts?: { clearAgent?: boolean }): void {
  useTerminalStore.getState().clearSession(id)
  useTerminalFsStore.getState().clearTerminal(id)
  if (opts?.clearAgent !== false) {
    useTerminalAgentStore.getState().setExecFlight(id, null)
    useTerminalAgentStore.getState().setActiveSession(id, null)
  }
}

/**
 * Reconnect: clear residual state, rebuild the ring session, and reset exec
 * flight — bit-for-bit the current `reconnect` sequence (which never touches
 * setActiveSession, so it must not route through dispose + ensure).
 */
export function resetTerminalForReconnect(id: string): void {
  // Bump generation so in-flight exec flights observe a ring reset (T5):
  // cursor validity dies with the old ring — agents must re-read before acting.
  const prevGen = useTerminalStore.getState().getSession(id)?.generation ?? 0
  useTerminalStore.getState().clearSession(id)
  useTerminalStore.getState().ensureSession(id)
  useTerminalStore.getState().setGeneration(id, prevGen + 1)
  useTerminalFsStore.getState().clearTerminal(id)
  useTerminalAgentStore.getState().setExecFlight(id, null)
}

/** Record a successful launch into recent launches (K11). */
export async function recordTerminalLaunch(opts:
  | { type: 'local'; cwd: string; label?: string }
  | { type: 'ssh'; hostId: string; label: string },
): Promise<void> {
  const entry: RecentLaunch =
    opts.type === 'local'
      ? { type: 'local', cwd: opts.cwd, label: opts.label, at: Date.now() }
      : { type: 'ssh', hostId: opts.hostId, label: opts.label, at: Date.now() }
  await useTerminalHostStore.getState().pushRecent(entry)
}

/** Remove the host-catalog record for a managed terminal (removeRecord sync). */
export async function removeHostTerminalRecord(id: string): Promise<void> {
  void useTerminalHostStore.getState().removeTerminalRecord?.(id).catch(() => {
    /* catalog write failures must not break terminal runtime */
  })
}

/** Persist an SSH record to the host catalog (live status is never persisted). */
export function persistSshRecord(term: ManagedTerminal): void {
  if (term.kind !== 'ssh' || !term.hostId) return
  void useTerminalHostStore
    .getState()
    .upsertTerminalRecord?.({
      id: term.id,
      hostId: term.hostId,
      title: term.title,
      remotePath: term.remotePath,
      status: 'disconnected',
      createdAt: term.createdAt,
    })
    .catch(() => {
      /* catalog write failures must not break terminal runtime */
    })
}
