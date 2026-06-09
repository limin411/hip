// src/domain/hooks.ts
import type { Message, SearchHit } from '@hip/protocol'
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
