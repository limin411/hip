// src/domain/index.ts
export { sessionService } from './sessionService'
export { useSessions, useActiveSessionId, useActiveSession, useActiveMessages, useAgents, useConnectionStatus, useHasApiKey, useActiveSessionError } from './hooks'
export type { SessionVM, AgentVM, AgentStatus, SessionError } from './sessionStore'
