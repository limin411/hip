// src/domain/index.ts
export { sessionService } from './sessionService'
export { useSessions, useActiveSessionId, useActiveSession, useActiveMessages, useConnectionStatus, useHasApiKey, useActiveSessionError, useSearchHits, useActiveSessionStatus } from './hooks'
export type { SessionVM, SessionError } from './sessionStore'
