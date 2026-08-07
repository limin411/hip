// src/domain/sessionStore/reducers/misc.ts
// Standalone plugin-install status + the default fall-through (unknown types
// return state unchanged, matching the original applyServerMessage default).
import type { ServerMessage } from '@hip/protocol'
import type { SessionState } from './helpers'

export function miscReducer(state: SessionState, msg: ServerMessage, _now: number): SessionState {
  switch (msg.type) {
    case 'plugin:install:progress':
      return { ...state, pluginInstall: { status: msg.status, message: msg.message, pluginId: msg.pluginId } }

    case 'plugin:install:result':
      return {
        ...state,
        pluginInstall: {
          status: msg.ok ? 'done' : 'error',
          message: msg.ok ? '' : (msg.error ?? ''),
          pluginId: msg.pluginId,
          result: { ok: msg.ok, error: msg.error },
          modelReview: msg.modelReview,
        },
      }

    default:
      return state
  }
}
