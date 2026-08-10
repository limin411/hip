import { create } from 'zustand'

/** Chunk budget (not exact line count) + 2 MiB hard cap per session (D15 / D6a). */
export const MAX_RING_CHUNKS = 5000
export const MAX_RING_BYTES = 2 * 1024 * 1024

export type PtyStatus = 'idle' | 'starting' | 'running' | 'exited' | 'error'

export interface SessionPtyUi {
  status: PtyStatus
  cwd?: string
  lastError?: string
  exitCode?: number | null
  /** OSC 0/2 window title reported by the shell (P0.3); undefined = keep launch title. */
  title?: string
  /** Decoded text chunks for rehydrate / live write. */
  ring: string[]
  ringBytes: number
  /** Dropped from front of ring; used to keep write cursors valid after trim. */
  trimOffset: number
  /** Open generation from Rust; ignore pty:exit with older generation. */
  generation: number
}

interface TerminalState {
  bySession: Record<string, SessionPtyUi>
  /** True when the user typed while a terminal-exec flight was active (D10). */
  userInterleaved: Record<string, boolean>
  /**
   * Which terminal id's XtermSurface is currently the single xterm writer (D6a).
   * Keys any string id (domain sessionId or managed `tm_*`).
   */
  attachedSessionId: string | null
  /**
   * Alias of `attachedSessionId` (K2 / D6a). Always dual-written with the same value.
   * Prefer this name for multi-terminal call sites.
   */
  attachedTerminalId: string | null

  ensureSession: (sessionId: string) => void
  appendRing: (sessionId: string, chunk: string) => void
  setStatus: (sessionId: string, status: PtyStatus, patch?: Partial<SessionPtyUi>) => void
  /** No-op if session missing or generation mismatch (stale exit after restart). */
  setExit: (sessionId: string, code: number | null, generation?: number) => void
  setError: (sessionId: string, message: string) => void
  setGeneration: (sessionId: string, generation: number) => void
  /** Record an OSC 0/2 title; empty string is ignored (shell reset clears the field). */
  setTitle: (sessionId: string, title: string) => void
  setAttached: (sessionId: string | null) => void
  clearSession: (sessionId: string) => void
  getRing: (sessionId: string) => string[]
  getSession: (sessionId: string) => SessionPtyUi | undefined
  /** Slice the ring from an absolute cursor; marks truncated when the cursor was trimmed. */
  getRingSince: (sessionId: string, cursor: number) => { output: string; cursor: number; truncated: boolean }
  /** Mark user input interleaving for a terminal (cleared by the bridge after reporting). */
  noteUserInput: (sessionId: string) => void
  consumeUserInterleaved: (sessionId: string) => boolean
}

function emptySession(): SessionPtyUi {
  return {
    status: 'idle',
    ring: [],
    ringBytes: 0,
    exitCode: null,
    trimOffset: 0,
    generation: 0,
  }
}

function trimRing(s: SessionPtyUi): SessionPtyUi {
  let { ring, ringBytes, trimOffset } = s
  while (ring.length > MAX_RING_CHUNKS || ringBytes > MAX_RING_BYTES) {
    const dropped = ring[0]
    if (dropped === undefined) break
    ring = ring.slice(1)
    ringBytes = Math.max(0, ringBytes - dropped.length)
    trimOffset += 1
  }
  return { ...s, ring, ringBytes, trimOffset }
}

/**
 * Map absolute write cursor (lifetime index) to current ring index after trims.
 * Returns -1 if cursor is entirely before retained ring (gap already on screen).
 */
export function ringIndexForCursor(cursor: number, trimOffset: number): number {
  return cursor - trimOffset
}

/**
 * Attach protocol drain helper (pure, unit-tested).
 * snapshot = ring length before setAttached; mid-append may grow ring during rehydrate.
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
  userInterleaved: {},
  attachedSessionId: null,
  attachedTerminalId: null,

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

  setExit: (sessionId, code, generation) => {
    set((st) => {
      const prev = st.bySession[sessionId]
      // Do not resurrect cleared sessions (late exit after deleteSession).
      if (!prev) return st
      // Ignore stale exit from a replaced PTY (restart / cwd change).
      if (generation !== undefined && prev.generation !== 0 && generation !== prev.generation) {
        return st
      }
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

  setGeneration: (sessionId, generation) => {
    set((st) => {
      const prev = st.bySession[sessionId] ?? emptySession()
      return {
        bySession: {
          ...st.bySession,
          [sessionId]: { ...prev, generation },
        },
      }
    })
  },

  setTitle: (sessionId, title) => {
    // Empty title = shell reset (OSC 0 with empty arg) → clear the override.
    const next = title.trim()
    set((st) => {
      const prev = st.bySession[sessionId]
      if (!prev || (prev.title ?? '') === next) return st
      return {
        bySession: {
          ...st.bySession,
          [sessionId]: { ...prev, title: next ? next : undefined },
        },
      }
    })
  },

  setAttached: (sessionId) =>
    set({ attachedSessionId: sessionId, attachedTerminalId: sessionId }),

  clearSession: (sessionId) => {
    set((st) => {
      const { [sessionId]: _removed, ...rest } = st.bySession
      // Dual-read aliases the same way as call sites (attachedTerminalId ?? attachedSessionId).
      const stillAttached =
        st.attachedSessionId === sessionId || st.attachedTerminalId === sessionId
          ? null
          : (st.attachedTerminalId ?? st.attachedSessionId)
      return {
        bySession: rest,
        userInterleaved: { ...st.userInterleaved, [sessionId]: false },
        attachedSessionId: stillAttached,
        attachedTerminalId: stillAttached,
      }
    })
  },

  getRing: (sessionId) => get().bySession[sessionId]?.ring ?? [],
  getSession: (sessionId) => get().bySession[sessionId],

  getRingSince: (sessionId, cursor) => {
    const s = get().bySession[sessionId]
    if (!s) return { output: '', cursor: 0, truncated: false }
    const idx = ringIndexForCursor(cursor, s.trimOffset)
    if (idx < 0) {
      // Cursor was trimmed away — return the retained ring and mark the gap.
      return {
        output: s.ring.join(''),
        cursor: s.trimOffset + s.ring.length,
        truncated: true,
      }
    }
    return {
      output: s.ring.slice(idx).join(''),
      cursor: s.trimOffset + s.ring.length,
      truncated: false,
    }
  },

  noteUserInput: (sessionId) =>
    set((st) => ({ userInterleaved: { ...st.userInterleaved, [sessionId]: true } })),

  consumeUserInterleaved: (sessionId) => {
    const flagged = get().userInterleaved[sessionId] === true
    if (flagged) {
      set((st) => ({ userInterleaved: { ...st.userInterleaved, [sessionId]: false } }))
    }
    return flagged
  },
}))
