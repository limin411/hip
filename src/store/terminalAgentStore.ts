import { create } from 'zustand'
import type { SessionConfig } from '@hip/protocol'
import { isTerminalSession } from '@/lib/sessions'

/** One in-flight shared-PTY exec per terminal (single flight + queue, spec §5.3). */
export interface TerminalExecFlight {
  callId: string
  sessionId: string
  command: string
  startedAt: number
  /** UI-side wait deadline (Date.now() + waitMs); paused while handed_off. */
  deadline: number
  /**
   * Driver state machine (terminal-shared-pty T2): running → handed_off ⇄
   * resumed → finished. handed_off pauses the deadline; resume extends it by
   * the pause duration.
   */
  phase: 'running' | 'handed_off' | 'resumed'
  /** Set when the user took the keyboard (handed_off entered); undefined until then. */
  handedOffAt?: number
}

export type TerminalDriver = 'user' | 'agent'

export const HANDED_OFF_MAX_MS = 10 * 60 * 1000

export interface QueuedExecRequest {
  callId: string
  sessionId: string
  command: string
  waitMs: number
  poll: boolean
  wrapEc?: boolean
  fence?: boolean
  queuedAt: number
}

interface TerminalAgentStore {
  /** Active agent session per `tm_*` (right-rail Agent tab shows this). */
  activeSessionByTerminal: Record<string, string | null>
  /** Sidebar child-tree expanded state per `tm_*` (process-ephemeral). */
  sidebarExpanded: Record<string, boolean>
  /** Per-tm single-flight exec lock. */
  execFlightByTerminal: Record<string, TerminalExecFlight | null>
  /** Per-tm FIFO of exec requests waiting for the single flight (T3). */
  execQueueByTerminal: Record<string, QueuedExecRequest[]>
  /** Who owns the keyboard per `tm_*` (T2 one-driver). */
  driverByTerminal: Record<string, TerminalDriver>

  setActiveSession: (terminalId: string, sessionId: string | null) => void
  setSidebarExpanded: (terminalId: string, expanded: boolean) => void
  toggleSidebarExpanded: (terminalId: string) => void
  setExecFlight: (terminalId: string, flight: TerminalExecFlight | null) => void
  enqueueExec: (terminalId: string, req: QueuedExecRequest) => void
  dequeueExec: (terminalId: string, callId: string) => void
  /** Keyboard ownership flips (T2): bridge flips to user on handed_off. */
  setDriver: (terminalId: string, driver: TerminalDriver) => void
  /** User hands the keyboard back: phase → resumed, deadline extended by the pause. */
  resumeExecFlight: (terminalId: string) => void
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
  execQueueByTerminal: {},
  driverByTerminal: {},

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
      // Entering a flight hands the keyboard to the agent; finishing returns it.
      driverByTerminal: {
        ...s.driverByTerminal,
        [terminalId]: flight ? 'agent' : 'user',
      },
    })),

  enqueueExec: (terminalId, req) =>
    set((s) => ({
      execQueueByTerminal: {
        ...s.execQueueByTerminal,
        [terminalId]: [...(s.execQueueByTerminal[terminalId] ?? []), req],
      },
    })),

  dequeueExec: (terminalId, callId) =>
    set((s) => ({
      execQueueByTerminal: {
        ...s.execQueueByTerminal,
        [terminalId]: (s.execQueueByTerminal[terminalId] ?? []).filter((q) => q.callId !== callId),
      },
    })),

  setDriver: (terminalId, driver) =>
    set((s) => ({
      driverByTerminal: { ...s.driverByTerminal, [terminalId]: driver },
    })),

  resumeExecFlight: (terminalId) =>
    set((s) => {
      const flight = s.execFlightByTerminal[terminalId]
      if (!flight || flight.phase !== 'handed_off') return {}
      const now = Date.now()
      const pauseMs = now - (flight.handedOffAt ?? now)
      return {
        execFlightByTerminal: {
          ...s.execFlightByTerminal,
          [terminalId]: {
            ...flight,
            phase: 'resumed',
            deadline: flight.deadline + pauseMs,
          },
        },
        driverByTerminal: { ...s.driverByTerminal, [terminalId]: 'agent' },
      }
    }),

  getActiveSession: (terminalId) => get().activeSessionByTerminal[terminalId] ?? null,
}))
