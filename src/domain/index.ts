// src/domain/index.ts
export { sessionService } from './sessionService'
export { useSessions, useActiveSessionId, useActiveSession, useActiveMessages, useConnectionStatus, useHasApiKey, useActiveSessionError, useSearchHits, useActiveSessionStatus, useActiveInterrupt, useActiveConfigOptions, useActiveUsageTotal } from './hooks'
export type { SessionVM, SessionError } from './sessionStore'
