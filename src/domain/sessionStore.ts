// src/domain/sessionStore.ts
import { create } from 'zustand'
import type { AgentRole, AgentRun, Message, SearchHit, ServerMessage, SessionConfig, SessionSummary } from '@hip/protocol'

export type AgentStatus = 'idle' | 'running' | 'done'

export interface AgentVM {
  id: string
  role: AgentRole
  title: string        // 派生自 role
  status: AgentStatus
  tokens: string
  tokenCount: number   // 物化：tokens.length
  elapsedMs: number    // 物化：finishedAt - startedAt
  startedAt: number    // 内部：agent:started 时的 now（不渲染）
}

/** A surfaced server error tied to a session (e.g. NO_API_KEY, AGENT_ERROR). */
export interface SessionError {
  code: string
  message: string
}

export interface SessionVM {
  id: string
  config: SessionConfig
  title: string        // 展示字符串
  preview: string      // 展示字符串
  updatedAt: string    // 展示字符串（'2m ago' / 'now'）
  updatedAtMs: number  // 数值排序键（epoch ms）
  loaded: boolean      // false = 仅摘要（消息尚未拉取）
  messages: Message[]
  agents: AgentVM[]
  status: 'idle' | 'running' | 'error'
  error: SessionError | null  // 最近一次服务端错误（供 UI 内联提示），无则 null
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

function formatRelative(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return 'now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

function summaryToVM(s: SessionSummary): SessionVM {
  return { id: s.id, config: DEFAULT_CONFIG, title: s.title, preview: s.preview, updatedAt: formatRelative(s.updatedAt), updatedAtMs: s.updatedAt, loaded: false, messages: [], agents: [], status: 'idle', error: null }
}

function agentVMfromRun(r: AgentRun): AgentVM {
  return { id: r.agentId, role: r.role, title: ROLE_TITLE[r.role], status: r.finishedAt ? 'done' : 'running', tokens: r.output, tokenCount: r.output.length, elapsedMs: r.finishedAt ? r.finishedAt - r.startedAt : 0, startedAt: r.startedAt }
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
        error: null,
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
      // A cancel is intentional, not a failure: return to idle and surface nothing.
      if (!msg.sessionId) return state
      if (msg.code === 'CANCELLED') return update(msg.sessionId, (s) => ({ ...s, status: 'idle', error: null }))
      return update(msg.sessionId, (s) => ({ ...s, status: 'error', error: { code: msg.code, message: msg.message } }))

    case 'session:list:result': {
      const incoming = msg.sessions.map(summaryToVM)
      // 保留已加载会话；用摘要替换/插入；按更新时间倒序。
      const byId = new Map(state.sessions.map((s) => [s.id, s]))
      for (const vm of incoming) {
        const prev = byId.get(vm.id)
        byId.set(vm.id, prev?.loaded ? { ...prev, title: vm.title, preview: vm.preview, updatedAt: vm.updatedAt, updatedAtMs: vm.updatedAtMs } : vm)
      }
      return { sessions: [...byId.values()].sort((a, b) => b.updatedAtMs - a.updatedAtMs) }
    }

    case 'session:loaded':
      return update(msg.sessionId, (s) => ({ ...s, loaded: true, messages: msg.messages, agents: msg.agentRuns.map(agentVMfromRun) }))

    case 'session:deleted':
      return { sessions: state.sessions.filter((s) => s.id !== msg.sessionId) }

    case 'session:title':
      return update(msg.sessionId, (s) => ({ ...s, title: msg.title }))

    case 'session:cwd':
      return update(msg.sessionId, (s) => ({ ...s, config: { ...s.config, cwd: msg.cwd } }))

    default:
      return state
  }
}

export const DEFAULT_CONFIG: SessionConfig = { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [] }

export function emptySession(id: string): SessionVM {
  return { id, config: DEFAULT_CONFIG, title: '新对话', preview: '开始一段新的对话…', updatedAt: 'now', updatedAtMs: Date.now(), loaded: true, messages: [], agents: [], status: 'idle', error: null }
}

export type Connection = 'connecting' | 'connected' | 'error' | 'disconnected'

interface DomainStore {
  sessions: SessionVM[]
  activeSessionId: string | null
  connection: Connection
  hasApiKey: boolean
  searchHits: SearchHit[]

  apply: (msg: ServerMessage) => void
  createSession: (id: string, config: SessionConfig) => string
  selectSession: (id: string) => void
  deleteSession: (id: string) => void
  renameSession: (id: string, title: string) => void
  appendUserMessage: (sessionId: string, id: string, content: string) => void
  setConnection: (c: Connection) => void
}

export const useDomainStore = create<DomainStore>((set) => ({
  sessions: [],
  activeSessionId: null,
  connection: 'disconnected',
  // Optimistic until the sidecar reports via 'ready' — avoids flashing "no key" before connect.
  hasApiKey: true,
  searchHits: [],

  apply: (msg) =>
    set((s) => {
      if (msg.type === 'ready') return { hasApiKey: msg.hasApiKey }
      if (msg.type === 'session:search:result') return { searchHits: msg.hits }
      return applyServerMessage(s, msg, Date.now())
    }),

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

  renameSession: (id, title) =>
    set((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? { ...x, title } : x)) })),

  appendUserMessage: (sessionId, id, content) =>
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id !== sessionId
          ? sess
          // Clear any prior error: appending a user message means a retry is underway.
          : { ...sess, error: null, updatedAtMs: Date.now(), messages: [...sess.messages, { id, role: 'user' as const, content, timestamp: Date.now() }] },
      ),
    })),

  setConnection: (connection) => set({ connection }),
}))
