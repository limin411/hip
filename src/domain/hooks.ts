// src/domain/hooks.ts
import type { AcpConfigOption, Message, PlanItem, SearchHit, TurnUsage } from '@hip/protocol'
import { useShallow } from 'zustand/react/shallow'
import { useDomainStore, type PendingPermission, type SessionError, type SessionVM, type McpServerStatusVM } from './sessionStore'
import { computePercentage, zoneForPercent } from '@/lib/tokenPercentage'
import { activeModelKey, parseModelKey } from '@/lib/modelKey'
import { useProvidersStore } from '@/store/providersStore'

const EMPTY_MESSAGES: Message[] = []
const EMPTY_CONFIG_OPTIONS: AcpConfigOption[] = []

export function useSessions(): SessionVM[] {
  return useDomainStore((s) => s.sessions)
}

export function useActiveSessionId(): string | null {
  return useDomainStore((s) => s.activeSessionId)
}

export function useActiveSession(): SessionVM | null {
  return useDomainStore((s) => s.sessions.find((x) => x.id === s.activeSessionId) ?? null)
}

/**
 * Active session messages only. Zustand compares the selected value with Object.is, so
 * subscribers re-render only when the messages **array reference** changes — not when
 * unrelated session fields (title, planDeltaDraft, permission, …) update.
 * Pair with React.memo(MessageBubble) + stable per-message refs from mapMessages.
 */
export function useActiveMessages(): Message[] {
  return useDomainStore((s) => s.sessions.find((x) => x.id === s.activeSessionId)?.messages ?? EMPTY_MESSAGES)
}

/** Plan/agent slice for ChatPane hidePlan + plan-approval gate. Shallow so plan:delta
 *  (planDeltaDraft-only) and permission noise do not re-render the transcript. */
export function useActiveChatPlanSlice(): {
  forcePlan: boolean
  planApprovalPending: boolean
  activeTurnPlan: PlanItem[] | null | undefined
  agentId: string | undefined
} {
  return useDomainStore(
    useShallow((s) => {
      const sess = s.sessions.find((x) => x.id === s.activeSessionId)
      return {
        forcePlan: Boolean(sess?.config.forcePlan),
        planApprovalPending: Boolean(sess?.planApprovalPending),
        activeTurnPlan: sess?.activeTurnPlan,
        agentId: sess?.config.agentId,
      }
    }),
  )
}

export function useActiveSessionError(): SessionError | null {
  return useDomainStore((s) => s.sessions.find((x) => x.id === s.activeSessionId)?.error ?? null)
}

export function useActiveSessionStatus(): SessionVM['status'] {
  return useDomainStore((s) => s.sessions.find((x) => x.id === s.activeSessionId)?.status ?? 'idle')
}

export function useConnectionStatus(): string {
  return useDomainStore((s) => s.connection)
}

export function useHasApiKey(): boolean {
  return useDomainStore((s) => s.hasApiKey)
}

export function useSearchHits(): SearchHit[] {
  return useDomainStore((s) => s.searchHits)
}

export function useSearching(): boolean {
  return useDomainStore((s) => s.searching)
}

export function useActiveInterrupt(): { turnId: string; question: string; context?: string } | null {
  return useDomainStore((s) => s.sessions.find((x) => x.id === s.activeSessionId)?.interrupt ?? null)
}

/** ACP-agent model/mode selectors for the active session (empty when none advertised). */
export function useActiveConfigOptions(): AcpConfigOption[] {
  return useDomainStore((s) => s.sessions.find((x) => x.id === s.activeSessionId)?.configOptions ?? EMPTY_CONFIG_OPTIONS)
}

/** Pending HITL tool-permission request for the active session (null when none awaiting). */
export function useActivePendingPermission(): PendingPermission | null {
  return useDomainStore((s) => s.sessions.find((x) => x.id === s.activeSessionId)?.pendingPermission ?? null)
}

/** Pure: sum `usage` across the active session's messages. Returns null when the active
 *  session is absent or no message carries usage. Exported for unit testing; the hook below
 *  is the thin reactive wrapper. */
export function selectUsageTotal(state: { sessions: SessionVM[]; activeSessionId: string | null }): TurnUsage | null {
  const active = state.sessions.find((x) => x.id === state.activeSessionId)
  if (!active) return null
  let any = false
  const total: TurnUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  for (const m of active.messages) {
    if (!m.usage) continue
    any = true
    total.inputTokens += m.usage.inputTokens ?? 0
    total.outputTokens += m.usage.outputTokens ?? 0
    total.totalTokens += m.usage.totalTokens ?? 0
  }
  return any ? total : null
}

/** Session-total token usage for the active session (derived, never stored). `useShallow` is
 *  REQUIRED, not cosmetic: selectUsageTotal builds a FRESH object whenever usage exists, and a
 *  Zustand v5 selector that returns a new reference every call makes useSyncExternalStore re-render
 *  without end ("Maximum update depth exceeded") the instant the first turn reports usage.
 *  useShallow caches by value, so the snapshot stays referentially stable until the totals change. */
export function useActiveUsageTotal(): TurnUsage | null {
  return useDomainStore(useShallow(selectUsageTotal))
}

/** Token usage relative to the active model's context window. Returns null when
 *  there is no active session, no usage, or the model catalog hasn't loaded. */
export function useTokenUsage(): { usedTokens: number | null; contextWindow: number | undefined; percent: number | null; zone: 'success' | 'warning' | 'danger' | null } | null {
  const usageTotal = useActiveUsageTotal()
  const catalog = useProvidersStore((s) => s.catalog)
  const config = useProvidersStore((s) => s.config)
  const active = useActiveSession()
  if (!usageTotal) return null
  const currentKey = active?.config.model
    ? `${active.config.llmProvider}/${active.config.model}`
    : activeModelKey(config)
  const { providerID, modelID } = parseModelKey(currentKey)
  const limit = catalog[providerID]?.models[modelID]?.limit
  const contextWindow = limit?.context
  const usedTokens = usageTotal.totalTokens
  const percent = computePercentage(usedTokens, contextWindow)
  const zone = zoneForPercent(percent)
  return { usedTokens, contextWindow, percent, zone }
}

export function useMcpStatuses(): McpServerStatusVM[] {
  return useDomainStore((s) => s.mcpStatuses)
}
