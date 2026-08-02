import { create } from 'zustand'
import type { SessionConfig } from '@hip/protocol'
import { isTerminalSession } from '@/lib/sessions'

/** One in-flight shared-PTY exec per terminal (single flight, spec §5.3). */
export interface TerminalExecFlight {
  callId: string
  sessionId: string
  command: string
  startedAt: number
  /** UI-side wait deadline (Date.now() + waitMs). */
  deadline: number
}

interface TerminalAgentStore {
  /** Active agent session per `tm_*` (right-rail Agent tab shows this). */
  activeSessionByTerminal: Record<string, string | null>
  /** Sidebar child-tree expanded state per `tm_*` (process-ephemeral). */
  sidebarExpanded: Record<string, boolean>
  /** Per-tm single-flight exec lock. */
  execFlightByTerminal: Record<string, TerminalExecFlight | null>

  setActiveSession: (terminalId: string, sessionId: string | null) => void
  setSidebarExpanded: (terminalId: string, expanded: boolean) => void
  toggleSidebarExpanded: (terminalId: string) => void
  setExecFlight: (terminalId: string, flight: TerminalExecFlight | null) => void
  getActiveSession: (terminalId: string) => string | null
}

/** Sessions bound to a managed terminal (authoritative source: SessionConfig). */
export function terminalSessionsFor<
  T extends { id: string; config: SessionConfig; title: string; updatedAtMs: number },
>(
  sessions: ReadonlyArray<T>,
  terminalId: string,
): T[] {
  return sessions
    .filter((s) => isTerminalSession(s.config) && s.config.managedTerminalId === terminalId)
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs || (a.id < b.id ? 1 : -1))
}

export const useTerminalAgentStore = create<TerminalAgentStore>((set, get) => ({
  activeSessionByTerminal: {},
  sidebarExpanded: {},
  execFlightByTerminal: {},

  setActiveSession: (terminalId, sessionId) =>
    set((s) => ({
      activeSessionByTerminal: {
        ...s.activeSessionByTerminal,
        [terminalId]: sessionId,
      },
    })),

  setSidebarExpanded: (terminalId, expanded) =>
    set((s) => ({
      sidebarExpanded: {
        ...s.sidebarExpanded,
        [terminalId]: expanded,
      },
    })),

  toggleSidebarExpanded: (terminalId) =>
    set((s) => ({
      sidebarExpanded: {
        ...s.sidebarExpanded,
        [terminalId]: !s.sidebarExpanded[terminalId],
      },
    })),

  setExecFlight: (terminalId, flight) =>
    set((s) => ({
      execFlightByTerminal: {
        ...s.execFlightByTerminal,
        [terminalId]: flight,
      },
    })),

  getActiveSession: (terminalId) => get().activeSessionByTerminal[terminalId] ?? null,
}))
