// src/domain/sessionStore.ts
import { create } from 'zustand'
import type { AgentRole, Message, ServerMessage, SessionConfig } from '@hip/protocol'
import { seedSessions } from './seed'

export type AgentStatus = 'idle' | 'running' | 'done'

export interface AgentVM {
  id: string
  role: AgentRole
  title: string        // 派生自 role
  status: AgentStatus
  tokens: string
  tokenCount: number   // 物化：tokens.length（字符数，非 LLM token 数；UI 仍按 mock 习惯显示为 "tokens"）
  elapsedMs: number    // 物化：finishedAt - startedAt
  startedAt: number    // 内部：agent:started 时的 now（不渲染）
}

export interface SessionVM {
  id: string
  config: SessionConfig
  title: string        // 展示字符串（seed 或 '新对话'，不派生）
  preview: string      // 展示字符串
  updatedAt: string    // 展示字符串（'2m ago' / 'now'）
  messages: Message[]
  agents: AgentVM[]
  status: 'idle' | 'running' | 'error'
}

const ROLE_TITLE: Record<AgentRole, string> = {
  supervisor: 'Supervisor',
  planner: 'Planner',
  coder: 'Coder',
  reviewer: 'Reviewer',
}

function upsertAgent(agents: AgentVM[], agent: AgentVM): AgentVM[] {
  return agents.some((a) => a.id === agent.id)
    ? agents.map((a) => (a.id === agent.id ? agent : a))
    : [...agents, agent]
}

function appendAssistantDelta(messages: Message[], delta: string, agentId: string, now: number): Message[] {
  const last = messages[messages.length - 1]
  if (last && last.role === 'assistant') {
    return [...messages.slice(0, -1), { ...last, content: last.content + delta }]
  }
  return [...messages, { id: `asst-${agentId}-${now}`, role: 'assistant', content: delta, agentId, timestamp: now }]
}

function finalizeAssistant(messages: Message[], message: Message): Message[] {
  const last = messages[messages.length - 1]
  return last && last.role === 'assistant' ? [...messages.slice(0, -1), message] : [...messages, message]
}

/** 把一条 ServerMessage 归并进状态。纯函数：now 由调用方注入。 */
export function applyServerMessage(
  state: { sessions: SessionVM[] },
  msg: ServerMessage,
  now: number,
): { sessions: SessionVM[] } {
  const update = (sessionId: string, fn: (s: SessionVM) => SessionVM): { sessions: SessionVM[] } => {
    if (!state.sessions.some((s) => s.id === sessionId)) return state
    return { sessions: state.sessions.map((s) => (s.id === sessionId ? fn(s) : s)) }
  }

  switch (msg.type) {
    case 'session:created':
      if (state.sessions.some((s) => s.id === msg.sessionId)) return state
      return { sessions: [...state.sessions, emptySession(msg.sessionId)] }

    case 'agent:started':
      return update(msg.sessionId, (s) => ({
        ...s,
        status: 'running',
        agents: upsertAgent(s.agents, {
          id: msg.agentId,
          role: msg.role,
          title: ROLE_TITLE[msg.role],
          status: 'running',
          tokens: '',
          tokenCount: 0,
          elapsedMs: 0,
          startedAt: now,
        }),
      }))

    case 'token:stream':
      return update(msg.sessionId, (s) => {
        const agent = s.agents.find((a) => a.id === msg.agentId)
        const agents = s.agents.map((a) =>
          a.id === msg.agentId ? { ...a, tokens: a.tokens + msg.delta, tokenCount: a.tokens.length + msg.delta.length } : a,
        )
        const messages =
          agent?.role === 'supervisor' ? appendAssistantDelta(s.messages, msg.delta, msg.agentId, now) : s.messages
        return { ...s, agents, messages }
      })

    case 'agent:finished':
      return update(msg.sessionId, (s) => ({
        ...s,
        agents: s.agents.map((a) => (a.id === msg.agentId ? { ...a, status: 'done', elapsedMs: now - a.startedAt } : a)),
      }))

    case 'message:complete':
      return update(msg.sessionId, (s) => ({ ...s, status: 'idle', messages: finalizeAssistant(s.messages, msg.message) }))

    case 'error':
      return msg.sessionId ? update(msg.sessionId, (s) => ({ ...s, status: 'error' })) : state

    default:
      return state
  }
}

export const DEFAULT_CONFIG: SessionConfig = { llmProvider: 'anthropic', model: 'claude-opus-4-8', tools: [] }

export function emptySession(id: string): SessionVM {
  return { id, config: DEFAULT_CONFIG, title: '新对话', preview: '开始一段新的对话…', updatedAt: 'now', messages: [], agents: [], status: 'idle' }
}

export type Connection = 'connecting' | 'connected' | 'error' | 'disconnected'

interface DomainStore {
  sessions: SessionVM[]
  activeSessionId: string | null
  connection: Connection

  apply: (msg: ServerMessage) => void
  createSession: (id: string, config: SessionConfig) => string
  selectSession: (id: string) => void
  deleteSession: (id: string) => void
  appendUserMessage: (sessionId: string, content: string) => void
  setConnection: (c: Connection) => void
}

let userSeq = 0

export const useDomainStore = create<DomainStore>((set) => ({
  sessions: seedSessions(),
  activeSessionId: 's1',
  connection: 'disconnected',

  apply: (msg) => set((s) => applyServerMessage(s, msg, Date.now())),

  createSession: (id, config) => {
    set((s) => ({ sessions: [{ ...emptySession(id), config }, ...s.sessions], activeSessionId: id }))
    return id
  },

  selectSession: (id) => set({ activeSessionId: id }),

  deleteSession: (id) =>
    set((s) => {
      const sessions = s.sessions.filter((x) => x.id !== id)
      const activeSessionId = s.activeSessionId === id ? (sessions[0]?.id ?? null) : s.activeSessionId
      return { sessions, activeSessionId }
    }),

  appendUserMessage: (sessionId, content) =>
    set((s) => {
      const id = `u-${(userSeq += 1)}`
      return {
        sessions: s.sessions.map((sess) =>
          sess.id !== sessionId
            ? sess
            : { ...sess, messages: [...sess.messages, { id, role: 'user' as const, content, timestamp: Date.now() }] },
        ),
      }
    }),

  setConnection: (connection) => set({ connection }),
}))
