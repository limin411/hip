import { create } from 'zustand'
import type { ArtifactTab, MockAgent, MockMessage, MockSession } from '@/mock/types'
import { mockSessions } from '@/mock/sessions'
import { mockMessages } from '@/mock/messages'
import { mockAgents } from '@/mock/agents'

interface UiState {
  collapsed: boolean
  setCollapsed: (v: boolean) => void
  toggleCollapsed: () => void

  sessions: MockSession[]
  activeSessionId: string
  search: string
  setSearch: (q: string) => void
  selectSession: (id: string) => void
  newSession: () => void
  deleteSession: (id: string) => void

  messagesBySession: Record<string, MockMessage[]>
  appendMessage: (sessionId: string, msg: MockMessage) => void
  appendToLastAssistant: (sessionId: string, delta: string) => void

  panelOpen: boolean
  panelFullscreen: boolean
  activeTab: ArtifactTab
  setTab: (t: ArtifactTab) => void
  togglePanel: () => void
  toggleFullscreen: () => void

  agents: MockAgent[]
  setAgents: (agents: MockAgent[]) => void
  setAgentStatus: (id: string, status: MockAgent['status']) => void
  appendAgentTokens: (id: string, delta: string) => void
}

let seq = 0
function nextId(prefix: string): string {
  seq += 1
  return `${prefix}-${seq}`
}

export const useUiStore = create<UiState>((set) => ({
  collapsed: false,
  setCollapsed: (v) => set({ collapsed: v }),
  toggleCollapsed: () => set((s) => ({ collapsed: !s.collapsed })),

  sessions: mockSessions,
  activeSessionId: mockSessions[0].id,
  search: '',
  setSearch: (q) => set({ search: q }),
  selectSession: (id) => set({ activeSessionId: id }),
  newSession: () =>
    set((s) => {
      const id = nextId('s')
      const session: MockSession = { id, title: '新对话', preview: '开始一段新的对话…', updatedAt: 'now' }
      return {
        sessions: [session, ...s.sessions],
        activeSessionId: id,
        messagesBySession: { ...s.messagesBySession, [id]: [] },
      }
    }),
  deleteSession: (id) =>
    set((s) => {
      const sessions = s.sessions.filter((x) => x.id !== id)
      const activeSessionId = s.activeSessionId === id ? (sessions[0]?.id ?? '') : s.activeSessionId
      return { sessions, activeSessionId }
    }),

  messagesBySession: { [mockSessions[0].id]: mockMessages },
  appendMessage: (sessionId, msg) =>
    set((s) => ({
      messagesBySession: {
        ...s.messagesBySession,
        [sessionId]: [...(s.messagesBySession[sessionId] ?? []), msg],
      },
    })),
  appendToLastAssistant: (sessionId, delta) =>
    set((s) => {
      const list = s.messagesBySession[sessionId] ?? []
      if (list.length === 0) return s
      const last = list[list.length - 1]
      if (last.role !== 'assistant') return s
      const updated = { ...last, content: last.content + delta }
      return {
        messagesBySession: {
          ...s.messagesBySession,
          [sessionId]: [...list.slice(0, -1), updated],
        },
      }
    }),

  panelOpen: true,
  panelFullscreen: false,
  activeTab: 'agents',
  setTab: (t) => set({ activeTab: t }),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  toggleFullscreen: () => set((s) => ({ panelFullscreen: !s.panelFullscreen })),

  agents: mockAgents,
  setAgents: (agents) => set({ agents }),
  setAgentStatus: (id, status) =>
    set((s) => ({ agents: s.agents.map((a) => (a.id === id ? { ...a, status } : a)) })),
  appendAgentTokens: (id, delta) =>
    set((s) => ({
      agents: s.agents.map((a) =>
        a.id === id ? { ...a, tokens: a.tokens + delta, tokenCount: a.tokenCount + delta.length } : a,
      ),
    })),
}))
