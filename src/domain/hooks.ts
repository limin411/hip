// src/domain/hooks.ts
import type { Message } from '@hip/protocol'
import { useDomainStore, type AgentVM, type SessionVM } from './sessionStore'

const EMPTY_MESSAGES: Message[] = []
const EMPTY_AGENTS: AgentVM[] = []

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

export function useAgents(): AgentVM[] {
  return useDomainStore((s) => s.sessions.find((x) => x.id === s.activeSessionId)?.agents ?? EMPTY_AGENTS)
}

export function useConnectionStatus(): string {
  return useDomainStore((s) => s.connection)
}
