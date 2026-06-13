// src/domain/hooks.ts
import type { Message, SearchHit, TurnUsage } from '@hip/protocol'
import { useShallow } from 'zustand/react/shallow'
import { useDomainStore, type SessionError, type SessionVM } from './sessionStore'

const EMPTY_MESSAGES: Message[] = []

export function useSessions(): SessionVM[] {
  return useDomainStore((s) => s.sessions)
}

export function useActiveSessionId(): string | null {
  return useDomainStore((s) => s.activeSessionId)
}

export function useActiveSession(): SessionVM | null {
  return useDomainStore((s) => s.sessions.find((x) => x.id === s.activeSessionId) ?? null)
}

export function useActiveMessages(): Message[] {
  return useDomainStore((s) => s.sessions.find((x) => x.id === s.activeSessionId)?.messages ?? EMPTY_MESSAGES)
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

export function useActiveInterrupt(): { turnId: string; question: string; context?: string } | null {
  return useDomainStore((s) => s.sessions.find((x) => x.id === s.activeSessionId)?.interrupt ?? null)
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
    total.inputTokens += m.usage.inputTokens
    total.outputTokens += m.usage.outputTokens
    total.totalTokens += m.usage.totalTokens
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
