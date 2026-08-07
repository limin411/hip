// src/domain/sessionStore/index.ts
// Aggregated export surface (spec 2026-08-07-session-store-decomposition-spec).
// Public symbols only — internal helpers (messageUtils/reducer internals) stay module-scoped.
export { useDomainStore } from './store'
export type { Connection, McpServerStatusVM } from './store'
export { applyServerMessage } from './reducers'
export { clearPermission, DEFAULT_CONFIG, emptySession } from './constants'
export {
  isCurrentTurnAssistant,
  isStreamingAssistant,
  lastAssistantIndex,
  lastNonNotice,
  mapMessages,
  popForRegenerate,
} from './messageUtils'
export type { PendingPermission, PluginInstallState, SessionError, SessionVM } from './types'
