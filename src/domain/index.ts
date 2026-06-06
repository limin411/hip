// src/domain/index.ts
export { sessionService } from './sessionService'
// 注：useConnectionStatus 目前无 UI 消费方，为接入 WsTransport 后显示连接状态预留。
export { useSessions, useActiveSessionId, useActiveSession, useActiveMessages, useAgents, useConnectionStatus } from './hooks'
export type { SessionVM, AgentVM, AgentStatus } from './sessionStore'
