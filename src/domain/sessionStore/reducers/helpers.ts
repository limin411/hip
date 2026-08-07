// src/domain/sessionStore/reducers/helpers.ts
import type { PluginInstallState, SessionVM } from '../types'

/** State shape shared by all domain reducers (subset of the full store state). */
export interface SessionState {
  sessions: SessionVM[]
  pluginInstall?: PluginInstallState | null
}

/** Update one session by id; returns state unchanged when the session is unknown. */
export function updateSession(
  state: SessionState,
  sessionId: string,
  fn: (s: SessionVM) => SessionVM,
): SessionState {
  if (!state.sessions.some((s) => s.id === sessionId)) return state
  return { sessions: state.sessions.map((s) => (s.id === sessionId ? fn(s) : s)) }
}
