import { create } from 'zustand'
import { nanoid } from 'nanoid'
import type { AgentRole, Message, SessionConfig } from '@hip/protocol'

export interface AgentState {
  id: string
  role: AgentRole
  status: 'running' | 'finished'
  tokens: string
}

export interface Session {
  id: string
  config: SessionConfig
  messages: Message[]
  agents: AgentState[]
  status: 'idle' | 'running' | 'error'
}

interface SessionStore {
  sessions: Session[]
  activeSessionId: string | null
  createSession: (config: SessionConfig) => string
  destroySession: (id: string) => void
  setActive: (id: string) => void
  addMessage: (sessionId: string, message: Message) => void
  setAgentStarted: (sessionId: string, agentId: string, role: AgentRole) => void
  setAgentFinished: (sessionId: string, agentId: string) => void
  appendToken: (sessionId: string, agentId: string, delta: string) => void
}

export const useSessionStore = create<SessionStore>((set) => ({
  sessions: [],
  activeSessionId: null,

  createSession: (config) => {
    const id = nanoid()
    set((s) => ({
      sessions: [...s.sessions, { id, config, messages: [], agents: [], status: 'idle' }],
      activeSessionId: s.activeSessionId ?? id,
    }))
    return id
  },

  destroySession: (id) =>
    set((s) => ({
      sessions: s.sessions.filter((sess) => sess.id !== id),
      activeSessionId:
        s.activeSessionId === id ? (s.sessions[0]?.id ?? null) : s.activeSessionId,
    })),

  setActive: (id) => set({ activeSessionId: id }),

  addMessage: (sessionId, message) =>
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id !== sessionId
          ? sess
          : { ...sess, messages: [...sess.messages, message], status: 'idle', agents: [] },
      ),
    })),

  setAgentStarted: (sessionId, agentId, role) =>
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id !== sessionId
          ? sess
          : {
              ...sess,
              status: 'running',
              agents: [
                ...sess.agents,
                { id: agentId, role, status: 'running', tokens: '' },
              ],
            },
      ),
    })),

  setAgentFinished: (sessionId, agentId) =>
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id !== sessionId
          ? sess
          : {
              ...sess,
              agents: sess.agents.map((a) =>
                a.id !== agentId ? a : { ...a, status: 'finished' },
              ),
            },
      ),
    })),

  appendToken: (sessionId, agentId, delta) =>
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id !== sessionId
          ? sess
          : {
              ...sess,
              agents: sess.agents.map((a) =>
                a.id !== agentId ? a : { ...a, tokens: a.tokens + delta },
              ),
            },
      ),
    })),
}))
