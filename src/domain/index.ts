// src/domain/index.ts
export { sessionService } from './sessionService'
export { useSessions, useActiveSessionId, useActiveSession, useActiveMessages, useAgents, useConnectionStatus } from './hooks'
export type { SessionVM, AgentVM, AgentStatus } from './sessionStore'
