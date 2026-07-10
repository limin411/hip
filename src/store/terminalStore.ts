import { create } from 'zustand'

/** ~5000 line budget + 2 MiB hard cap per session (D15 / D6a). */
export const MAX_RING_CHUNKS = 5000
export const MAX_RING_BYTES = 2 * 1024 * 1024

export type PtyStatus = 'idle' | 'starting' | 'running' | 'exited' | 'error'

export interface SessionPtyUi {
  status: PtyStatus
  cwd?: string
  lastError?: string
  exitCode?: number | null
  /** Decoded text chunks for rehydrate / live write. */
  ring: string[]
  ringBytes: number
}

interface TerminalState {
  bySession: Record<string, SessionPtyUi>
  /** Which session's TerminalView is currently the single xterm writer. */
  attachedSessionId: string | null

  ensureSession: (sessionId: string) => void
  appendRing: (sessionId: string, chunk: string) => void
  setStatus: (sessionId: string, status: PtyStatus, patch?: Partial<SessionPtyUi>) => void
  setExit: (sessionId: string, code: number | null) => void
  setError: (sessionId: string, message: string) => void
  setAttached: (sessionId: string | null) => void
  clearSession: (sessionId: string) => void
  getRing: (sessionId: string) => string[]
}

function emptySession(): SessionPtyUi {
  return {
    status: 'idle',
    ring: [],
    ringBytes: 0,
    exitCode: null,
  }
}

function trimRing(s: SessionPtyUi): SessionPtyUi {
  let { ring, ringBytes } = s
  while (ring.length > MAX_RING_CHUNKS || ringBytes > MAX_RING_BYTES) {
    const dropped = ring[0]
    if (dropped === undefined) break
    ring = ring.slice(1)
    ringBytes = Math.max(0, ringBytes - dropped.length)
  }
  return { ...s, ring, ringBytes }
}

/**
 * Attach protocol drain helper (pure, unit-tested).
 * snapshot = length before setAttached; mid-append may grow ring during rehydrate.
 * Returns ordered writes and the final cursor (= ring.length after drain).
 */
export function attachDrainWrites(
  ring: readonly string[],
  snapshot: number,
): { writes: string[]; cursor: number } {
  const snap = Math.max(0, Math.min(snapshot, ring.length))
  const writes = [...ring.slice(0, snap), ...ring.slice(snap)]
  return { writes, cursor: ring.length }
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  bySession: {},
  attachedSessionId: null,

  ensureSession: (sessionId) => {
    if (get().bySession[sessionId]) return
    set((st) => ({
      bySession: { ...st.bySession, [sessionId]: emptySession() },
    }))
  },

  appendRing: (sessionId, chunk) => {
    if (!chunk) return
    set((st) => {
      const prev = st.bySession[sessionId] ?? emptySession()
      const next = trimRing({
        ...prev,
        status: prev.status === 'idle' || prev.status === 'starting' ? 'running' : prev.status,
        ring: [...prev.ring, chunk],
        ringBytes: prev.ringBytes + chunk.length,
      })
      return { bySession: { ...st.bySession, [sessionId]: next } }
    })
  },

  setStatus: (sessionId, status, patch) => {
    set((st) => {
      const prev = st.bySession[sessionId] ?? emptySession()
      return {
        bySession: {
          ...st.bySession,
          [sessionId]: { ...prev, ...patch, status },
        },
      }
    })
  },

  setExit: (sessionId, code) => {
    set((st) => {
      const prev = st.bySession[sessionId] ?? emptySession()
      return {
        bySession: {
          ...st.bySession,
          [sessionId]: { ...prev, status: 'exited', exitCode: code },
        },
      }
    })
  },

  setError: (sessionId, message) => {
    set((st) => {
      const prev = st.bySession[sessionId] ?? emptySession()
      return {
        bySession: {
          ...st.bySession,
          [sessionId]: { ...prev, status: 'error', lastError: message },
        },
      }
    })
  },

  setAttached: (sessionId) => set({ attachedSessionId: sessionId }),

  clearSession: (sessionId) => {
    set((st) => {
      const { [sessionId]: _removed, ...rest } = st.bySession
      return {
        bySession: rest,
        attachedSessionId: st.attachedSessionId === sessionId ? null : st.attachedSessionId,
      }
    })
  },

  getRing: (sessionId) => get().bySession[sessionId]?.ring ?? [],
}))
