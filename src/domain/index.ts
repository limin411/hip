// src/domain/index.ts
export { sessionService } from './sessionService'
export { useDomainStore } from './sessionStore'
export {
  useSessions,
  useActiveSessionId,
  useActiveSession,
  useActiveMessages,
  useActiveChatPlanSlice,
  useConnectionStatus,
  useHasApiKey,
  useActiveSessionError,
  useSearchHits,
  useSearching,
  useActiveSessionStatus,
  useActiveInterrupt,
  useActiveConfigOptions,
  useActivePendingPermission,
  useActiveUsageTotal,
  useTokenUsage,
  useSessionTokenMeter,
  useMcpStatuses,
  selectUsageTotal,
  selectContextTokens,
  tokensFromUsage,
} from './hooks'
export type { SessionTokenMeter } from './hooks'
export type { SessionVM, SessionError, PendingPermission, McpServerStatusVM } from './sessionStore'
