// src/domain/index.ts
export { sessionService } from './sessionService'
export { useSessions, useActiveSessionId, useActiveSession, useActiveMessages, useAgents, useConnectionStatus, useHasApiKey } from './hooks'
export type { SessionVM, AgentVM, AgentStatus } from './sessionStore'
