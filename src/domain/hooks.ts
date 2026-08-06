// src/domain/hooks.ts
import type { AcpConfigOption, Message, PlanItem, SearchHit, TurnUsage } from '@hip/protocol'
import { useShallow } from 'zustand/react/shallow'
import { useDomainStore, type PendingPermission, type SessionError, type SessionVM, type McpServerStatusVM } from './sessionStore'
import { computePercentage, zoneForPercent } from '@/lib/tokenPercentage'
import { contextFillTokens, reportedContextTokens } from '@/lib/contextBreakdown'
import {
  cacheHitRate,
  costRateFromCatalog,
  sumUsagesCost,
} from '@/lib/usageCost'
import { activeModelKey, parseModelKey } from '@/lib/modelKey'
import { useProvidersStore } from '@/store/providersStore'
import type { Catalog } from '@/ipc/catalog'

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

/**
 * Context-fill numerator from a usage report.
 * Prefers `contextTokens` / inputTokens (single-request size) so multi-step tool
 * loops do not sum every LLM call into a false 100% against the context window.
 * Does **not** fall back to billing `totalTokens` (output-only stream reports from
 * MiniMax etc. would otherwise show ~0% of a 1M window).
 */
export function tokensFromUsage(u: TurnUsage): number {
  return reportedContextTokens(u)
}

/** Collect per-run (or per-message) usage rows for honest per-model cost (KD-5). */
export function collectUsagesForCost(messages: Message[]): TurnUsage[] {
  const out: TurnUsage[] = []
  for (const m of messages) {
    const runUsages = m.agentRuns?.map((r) => r.usage).filter((u): u is TurnUsage => u != null) ?? []
    if (runUsages.length > 0) {
      out.push(...runUsages)
    } else if (m.usage) {
      out.push(m.usage)
    }
  }
  return out
}

/** Fold optional numeric fields when summing TurnUsage rows. */
function sumOpt(a: number | undefined, b: number | undefined): number | undefined {
  if (a == null && b == null) return undefined
  return (a ?? 0) + (b ?? 0)
}

/** Pure: sum `usage` across the active session's messages. Returns null when the active
 *  session is absent or no message carries usage. Exported for unit testing; the hook below
 *  is the thin reactive wrapper. */
export function selectUsageTotal(state: { sessions: SessionVM[]; activeSessionId: string | null }): TurnUsage | null {
  const active = state.sessions.find((x) => x.id === state.activeSessionId)
  if (!active) return null
  return sumMessageUsages(active.messages)
}

/** Sum message-level usage blobs (token totals for display). */
export function sumMessageUsages(messages: Message[]): TurnUsage | null {
  let any = false
  const total: TurnUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  for (const m of messages) {
    if (!m.usage) continue
    any = true
    const u = m.usage
    total.inputTokens += u.inputTokens ?? 0
    total.outputTokens += u.outputTokens ?? 0
    total.totalTokens += u.totalTokens ?? 0
    const cacheRead = sumOpt(total.cacheReadTokens, u.cacheReadTokens)
    if (cacheRead != null) total.cacheReadTokens = cacheRead
    const cacheWrite = sumOpt(total.cacheWriteTokens, u.cacheWriteTokens)
    if (cacheWrite != null) total.cacheWriteTokens = cacheWrite
    const nonCached = sumOpt(total.nonCachedInputTokens, u.nonCachedInputTokens)
    if (nonCached != null) total.nonCachedInputTokens = nonCached
    const reasoning = sumOpt(total.reasoningTokens, u.reasoningTokens)
    if (reasoning != null) total.reasoningTokens = reasoning
    if (u.incomplete) total.incomplete = true
  }
  return any ? total : null
}

/**
 * Honest session cost: each run/message priced at its capture-time modelId rates
 * (KD-5 / KD-22). Legacy rows without modelId fall back to the current session model.
 */
export function computeSessionCostUsd(
  messages: Message[],
  catalog: Catalog,
  fallbackProviderID: string,
  fallbackModelID: string,
): { costUsd: number | null; incomplete: boolean; cacheHitRate: number | null } {
  const usages = collectUsagesForCost(messages)
  const fallbackModel = catalog[fallbackProviderID]?.models[fallbackModelID]
  const fallbackRate = costRateFromCatalog(fallbackModel?.cost)
  const { costUsd, incomplete } = sumUsagesCost(usages, catalog, fallbackRate)
  const cumulative = sumMessageUsages(messages)
  const hit = cumulative ? cacheHitRate(cumulative) : null
  return {
    costUsd,
    incomplete: incomplete || Boolean(cumulative?.incomplete),
    cacheHitRate: hit,
  }
}

/**
 * Pure: context-fill numerator for the active session.
 * Requires at least one provider usage report (so the chip still only appears after
 * a turn reports usage). Uses max(provider context, visible chars/4 estimate) so
 * MiniMax-style input_tokens=0 stream reports do not stick at 0%.
 */
export function selectContextTokens(state: {
  sessions: SessionVM[]
  activeSessionId: string | null
}): number | null {
  const active = state.sessions.find((x) => x.id === state.activeSessionId)
  if (!active) return null
  if (!active.messages.some((m) => m.usage)) return null
  const fill = contextFillTokens(active.messages)
  return fill != null && fill > 0 ? fill : 0
}

/** Session-total token usage for the active session (derived, never stored). `useShallow` is
 *  REQUIRED, not cosmetic: selectUsageTotal builds a FRESH object whenever usage exists, and a
 *  Zustand v5 selector that returns a new reference every call makes useSyncExternalStore re-render
 *  without end ("Maximum update depth exceeded") the instant the first turn reports usage.
 *  useShallow caches by value, so the snapshot stays referentially stable until the totals change. */
export function useActiveUsageTotal(): TurnUsage | null {
  return useDomainStore(useShallow(selectUsageTotal))
}

/** Session token meter for the composer chip (and any other session-level usage UI). */
export type SessionTokenMeter = {
  /** Last-turn tokens used for context-window %. */
  contextTokens: number
  contextWindow: number | undefined
  percent: number | null
  zone: 'success' | 'warning' | 'danger' | null
  /** Sum of all message usage in the session. */
  cumulative: TurnUsage
  /** Estimated USD from per-usage model rates, or null when unpriced. */
  costUsd: number | null
  /** True when any usage is incomplete — show lower-bound $ with `*` (KD-15). */
  costIncomplete: boolean
  /**
   * Cache hit rate 0–1 when cache tokens are known.
   * For hover tooltip only — never on the chip primary surface (KD-21).
   */
  cacheHitRate: number | null
}

/** Token meter for the active session. Null when no session or no usage yet.
 *  Percent/zone use last-turn context fill, not cumulative totals. */
export function useSessionTokenMeter(): SessionTokenMeter | null {
  const cumulative = useActiveUsageTotal()
  const contextTokens = useDomainStore(selectContextTokens)
  const catalog = useProvidersStore((s) => s.catalog)
  const config = useProvidersStore((s) => s.config)
  const active = useActiveSession()
  if (!cumulative || contextTokens == null || !active) return null
  const currentKey = active.config.model
    ? `${active.config.llmProvider}/${active.config.model}`
    : activeModelKey(config)
  const { providerID, modelID } = parseModelKey(currentKey)
  const model = catalog[providerID]?.models[modelID]
  const contextWindow = model?.limit?.context
  const percent = computePercentage(contextTokens, contextWindow)
  const zone = zoneForPercent(percent)
  const { costUsd, incomplete, cacheHitRate: hit } = computeSessionCostUsd(
    active.messages,
    catalog,
    providerID,
    modelID,
  )
  return {
    contextTokens,
    contextWindow,
    percent,
    zone,
    cumulative,
    costUsd,
    costIncomplete: incomplete,
    cacheHitRate: hit,
  }
}

/** Session-scoped token meter for an EXPLICIT session (terminal agent panel etc.).
 *  Mirrors useSessionTokenMeter but never touches the domain active pointer. */
export function useSessionTokenMeterFor(
  sessionId: string | null | undefined,
): SessionTokenMeter | null {
  const session = useDomainStore((s) =>
    sessionId ? s.sessions.find((x) => x.id === sessionId) : undefined,
  )
  const catalog = useProvidersStore((s) => s.catalog)
  const config = useProvidersStore((s) => s.config)
  if (!session) return null
  if (!session.messages.some((m) => m.usage)) return null

  const fill = contextFillTokens(session.messages)
  const contextTokens = fill != null && fill > 0 ? fill : 0
  const cumulative = sumMessageUsages(session.messages)
  if (!cumulative) return null

  const currentKey = session.config.model
    ? `${session.config.llmProvider}/${session.config.model}`
    : activeModelKey(config)
  const { providerID, modelID } = parseModelKey(currentKey)
  const model = catalog[providerID]?.models[modelID]
  const contextWindow = model?.limit?.context
  const percent = computePercentage(contextTokens, contextWindow)
  const zone = zoneForPercent(percent)
  const { costUsd, incomplete, cacheHitRate: hit } = computeSessionCostUsd(
    session.messages,
    catalog,
    providerID,
    modelID,
  )
  return {
    contextTokens,
    contextWindow,
    percent,
    zone,
    cumulative,
    costUsd,
    costIncomplete: incomplete,
    cacheHitRate: hit,
  }
}

/**
 * @deprecated Prefer `useSessionTokenMeter`. Kept for callers that only need
 * context-fill percent fields. `usedTokens` is last-turn context fill (not cumulative).
 */
export function useTokenUsage(): {
  usedTokens: number | null
  contextWindow: number | undefined
  percent: number | null
  zone: 'success' | 'warning' | 'danger' | null
} | null {
  const meter = useSessionTokenMeter()
  if (!meter) return null
  return {
    usedTokens: meter.contextTokens,
    contextWindow: meter.contextWindow,
    percent: meter.percent,
    zone: meter.zone,
  }
}

export function useMcpStatuses(): McpServerStatusVM[] {
  return useDomainStore((s) => s.mcpStatuses)
}
