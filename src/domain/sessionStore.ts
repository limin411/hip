// src/domain/sessionStore.ts
import { create } from 'zustand'
import type { AgentRole, AgentRun, Message, SearchHit, ServerMessage, SessionConfig, SessionSummary, TimelineStep, ToolCall } from '@hip/protocol'

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
  updatedAtMs: number  // 数值排序键（epoch ms）
  loaded: boolean      // false = 仅摘要（消息尚未拉取）
  messages: Message[]
  status: 'idle' | 'running' | 'error'
  error: SessionError | null  // 最近一次服务端错误（供 UI 内联提示），无则 null
}

/** Turn-end sweep for a Message-level ToolCall[]: coerce any tool still 'running' to error so a delivered/finalized message matches the persisted trace after a cancel/interruption. */
function coerceRunningToolCalls(toolCalls: ToolCall[] | undefined): ToolCall[] | undefined {
  if (!toolCalls?.some((tc) => tc.status === 'running')) return toolCalls
  return toolCalls.map((tc) => (tc.status === 'running' ? { ...tc, status: 'error' as const, error: tc.error ?? 'interrupted' } : tc))
}

/** On cancel, finalize the in-flight (trailing) assistant message: drop it if it's a fully empty
 *  provisional (no content/timeline/tools), else if it is still in-flight (empty content OR has
 *  running tools) coerce tools to error and mark it stopped. Prior completed turns are left alone. */
function finalizeCancelledMessage(messages: Message[]): Message[] {
  let idx = -1
  for (let k = messages.length - 1; k >= 0; k--) { if (messages[k].role === 'assistant') { idx = k; break } }
  if (idx === -1) return messages
  const m = messages[idx]
  const empty = m.content === '' && !(m.timeline?.length) && !(m.toolCalls?.length)
  if (empty) return messages.filter((_, k) => k !== idx)
  const inFlight = m.content === '' || !!m.toolCalls?.some((tc) => tc.status === 'running')
  if (!inFlight) return messages // prior completed turn — leave alone
  return messages.map((x, k) => (k === idx ? { ...x, toolCalls: coerceRunningToolCalls(x.toolCalls), stopped: true } : x))
}

/** Build a freshly-started ToolCall from a tool:started message. */
function makeRunningToolCall(msg: { callId: string; agentId: string; name: string; input: string; seq: number; truncated?: boolean }): ToolCall {
  return { callId: msg.callId, agentId: msg.agentId, name: msg.name, input: msg.input, status: 'running', seq: msg.seq, ...(msg.truncated ? { truncated: true } : {}) }
}

/** Apply a tool:finished patch to an existing ToolCall (sticky-OR truncated). */
function patchFinishedToolCall(tc: ToolCall, msg: { status: 'finished' | 'error'; output?: string; error?: string; truncated?: boolean }): ToolCall {
  return { ...tc, status: msg.status, ...(msg.output !== undefined ? { output: msg.output } : {}), ...(msg.error !== undefined ? { error: msg.error } : {}), ...(tc.truncated || msg.truncated ? { truncated: true } : {}) }
}

/** Ensure the provisional assistant message keyed by turnId exists (idempotent).
 *  Invariant: this provisional message is always the trailing assistant message while the turn
 *  streams — agent:started (which appends it) precedes any token:stream/tool:* /finalize for the
 *  turn, and nothing else appends an assistant message mid-turn. So token/finalize handlers can
 *  safely target the tail. */
function ensureAssistantMessage(messages: Message[], turnId: string, agentId: string, now: number): Message[] {
  if (messages.some((m) => m.id === turnId)) return messages
  return [...messages, { id: turnId, role: 'assistant', content: '', agentId, timestamp: now, timeline: [], toolCalls: [] }]
}

/** Upsert a reasoning step on the turn's message: same stepSeq concatenates the delta. No-op if the turn is unknown. */
function upsertReasoning(messages: Message[], turnId: string, step: { stepSeq: number; agentId: string; role: AgentRole; delta: string }): Message[] {
  if (!messages.some((m) => m.id === turnId)) return messages
  return messages.map((m) => {
    if (m.id !== turnId) return m
    const timeline = m.timeline ?? []
    const exists = timeline.some((t) => t.kind === 'reasoning' && t.stepSeq === step.stepSeq)
    const nextTimeline = exists
      ? timeline.map((t) => (t.kind === 'reasoning' && t.stepSeq === step.stepSeq ? { ...t, content: t.content + step.delta } : t))
      : [...timeline, { kind: 'reasoning' as const, stepSeq: step.stepSeq, agentId: step.agentId, role: step.role, content: step.delta }]
    return { ...m, timeline: nextTimeline }
  })
}

function appendAssistantDelta(messages: Message[], delta: string, agentId: string, now: number): Message[] {
  // Relies on the ensureAssistantMessage invariant: the provisional turnId message is the trailing
  // assistant message when tokens arrive, so appending to the tail extends the right turn.
  const last = messages[messages.length - 1]
  if (last && last.role === 'assistant') {
    return [...messages.slice(0, -1), { ...last, content: last.content + delta }]
  }
  return [...messages, { id: `asst-${agentId}-${now}`, role: 'assistant', content: delta, agentId, timestamp: now }]
}

/** Upsert an AgentRun onto the turn's trailing assistant message (keyed by turnId). No-op if the turn is unknown.
 *  Assigns a provisional insertion-order seq on append; preserves the prior seq on replace.
 *  (message:complete later overwrites runs with the sidecar's authoritative seqs.) */
function upsertRun(messages: Message[], turnId: string, run: AgentRun): Message[] {
  if (!messages.some((m) => m.id === turnId)) return messages
  return messages.map((m) => {
    if (m.id !== turnId) return m
    const runs = m.agentRuns ?? []
    const i = runs.findIndex((r) => r.agentId === run.agentId)
    return i >= 0
      ? { ...m, agentRuns: runs.map((r, k) => (k === i ? { ...run, seq: r.seq } : r)) }
      : { ...m, agentRuns: [...runs, { ...run, seq: runs.length }] }
  })
}

/** Append a delta to a subagent run's output on the turn's message (keyed by turnId). No-op if unknown. */
function appendRunOutput(messages: Message[], turnId: string, agentId: string, delta: string): Message[] {
  return messages.map((m) =>
    m.id !== turnId || !m.agentRuns
      ? m
      : { ...m, agentRuns: m.agentRuns.map((r) => (r.agentId === agentId ? { ...r, output: r.output + delta } : r)) },
  )
}

/** Set finishedAt on the run for the given turn + agent. */
function setRunFinished(messages: Message[], turnId: string, agentId: string, now: number): Message[] {
  return messages.map((m) => (m.id !== turnId || !m.agentRuns ? m : { ...m, agentRuns: m.agentRuns.map((r) => (r.agentId === agentId ? { ...r, finishedAt: now } : r)) }))
}

function finalizeAssistant(messages: Message[], message: Message): Message[] {
  const last = messages[messages.length - 1]
  return last && last.role === 'assistant' ? [...messages.slice(0, -1), message] : [...messages, message]
}

function summaryToVM(s: SessionSummary): SessionVM {
  return { id: s.id, config: DEFAULT_CONFIG, title: s.title, preview: s.preview, updatedAtMs: s.updatedAt, loaded: false, messages: [], status: 'idle', error: null }
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

    case 'agent:started': {
      const run: AgentRun = {
        agentId: msg.agentId, role: msg.role, output: '', startedAt: now, finishedAt: null, seq: 0, messageId: msg.turnId,
        ...(msg.taskInput ? { taskInput: msg.taskInput } : {}),
        ...(msg.parentAgentId ? { parentAgentId: msg.parentAgentId } : {}),
      }
      return update(msg.sessionId, (s) => {
        const base = msg.role === 'supervisor' ? ensureAssistantMessage(s.messages, msg.turnId, msg.agentId, now) : s.messages
        return {
          ...s,
          status: 'running',
          error: null,
          messages: upsertRun(base, msg.turnId, run),
        }
      })
    }

    case 'token:stream':
      return update(msg.sessionId, (s) => {
        // token:stream carries no role; resolve supervisor (→ body) vs subagent (→ run output)
        // from the folded run on the trailing assistant message, falling back to the literal agentId.
        const trailing = s.messages[s.messages.length - 1]
        const run = trailing?.role === 'assistant' ? trailing.agentRuns?.find((r) => r.agentId === msg.agentId) : undefined
        const isSupervisor = run ? run.role === 'supervisor' : msg.agentId === 'supervisor'
        const messages = isSupervisor
          ? appendAssistantDelta(s.messages, msg.delta, msg.agentId, now)
          : appendRunOutput(s.messages, msg.turnId, msg.agentId, msg.delta)
        return { ...s, messages }
      })

    case 'reasoning:delta':
      return update(msg.sessionId, (s) => ({
        ...s,
        messages: upsertReasoning(s.messages, msg.turnId, { stepSeq: msg.stepSeq, agentId: msg.agentId, role: msg.role, delta: msg.delta }),
      }))

    case 'agent:finished':
      return update(msg.sessionId, (s) => ({
        ...s,
        messages: setRunFinished(s.messages, msg.turnId, msg.agentId, now),
      }))

    case 'tool:started':
      return update(msg.sessionId, (s) => ({
        ...s,
        messages: s.messages.map((m) =>
          m.id === msg.turnId
            ? {
                ...m,
                // stepSeq === toolCall.seq: both come from the turn-global step counter, so the
                // timeline step and its ToolCall share the same ordinal.
                timeline: [...(m.timeline ?? []), { kind: 'tool' as const, stepSeq: msg.seq, agentId: msg.agentId, role: msg.role, callId: msg.callId } satisfies TimelineStep],
                toolCalls: [...(m.toolCalls ?? []), makeRunningToolCall(msg)],
              }
            : m,
        ),
      }))

    case 'tool:finished':
      return update(msg.sessionId, (s) => ({
        ...s,
        messages: s.messages.map((m) =>
          m.toolCalls?.some((tc) => tc.callId === msg.callId)
            ? {
                ...m,
                toolCalls: m.toolCalls.map((tc) => (tc.callId === msg.callId ? patchFinishedToolCall(tc, msg) : tc)),
              }
            : m,
        ),
      }))

    case 'message:complete': {
      const finalized: Message = { ...msg.message, toolCalls: coerceRunningToolCalls(msg.message.toolCalls) }
      return update(msg.sessionId, (s) => ({ ...s, status: 'idle', messages: finalizeAssistant(s.messages, finalized) }))
    }

    case 'session:thinking':
      return update(msg.sessionId, (s) => ({ ...s, config: { ...s.config, thinking: msg.thinking } }))

    case 'session:systemPrompt':
      return update(msg.sessionId, (s) => ({ ...s, config: { ...s.config, systemPrompt: msg.systemPrompt || undefined } }))

    case 'error':
      // A cancel is intentional, not a failure: return to idle and surface nothing.
      if (!msg.sessionId) return state
      if (msg.code === 'CANCELLED') return update(msg.sessionId, (s) => ({ ...s, status: 'idle', error: null, messages: finalizeCancelledMessage(s.messages) }))
      return update(msg.sessionId, (s) => ({ ...s, status: 'error', error: { code: msg.code, message: msg.message } }))

    case 'session:list:result': {
      const incoming = msg.sessions.map(summaryToVM)
      // 保留已加载会话；用摘要替换/插入；按更新时间倒序。
      const byId = new Map(state.sessions.map((s) => [s.id, s]))
      for (const vm of incoming) {
        const prev = byId.get(vm.id)
        byId.set(vm.id, prev?.loaded ? { ...prev, title: vm.title, preview: vm.preview, updatedAtMs: vm.updatedAtMs } : vm)
      }
      return { sessions: [...byId.values()].sort((a, b) => b.updatedAtMs - a.updatedAtMs) }
    }

    case 'session:loaded':
      return update(msg.sessionId, (s) => {
        // A completed conversation always ends with an assistant reply; a trailing user
        // message means the last turn never finished (drop/crash/timeout) → interrupted.
        const last = msg.messages[msg.messages.length - 1]
        const interrupted = last?.role === 'user'
        return {
          ...s,
          loaded: true,
          config: msg.config ?? s.config,
          messages: msg.messages,
          status: interrupted ? 'error' : 'idle',
          error: interrupted ? { code: 'INTERRUPTED', message: '' } : null,
        }
      })

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

export const DEFAULT_CONFIG: SessionConfig = { llmProvider: 'deepseek', model: '', tools: [], thinking: true }

export function emptySession(id: string): SessionVM {
  return { id, config: DEFAULT_CONFIG, title: '新对话', preview: '开始一段新的对话…', updatedAtMs: Date.now(), loaded: true, messages: [], status: 'idle', error: null }
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
  deselect: () => void
  deleteSession: (id: string) => void
  renameSession: (id: string, title: string) => void
  appendUserMessage: (sessionId: string, id: string, content: string) => void
  regenerateLastTurn: (sessionId: string) => void
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

  deselect: () => set({ activeSessionId: null }),

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
          : { ...sess, status: 'running' as const, error: null, updatedAtMs: Date.now(), messages: [...sess.messages, { id, role: 'user' as const, content, timestamp: Date.now() }] },
      ),
    })),

  regenerateLastTurn: (sessionId) =>
    set((s) => ({
      sessions: s.sessions.map((sess) => {
        if (sess.id !== sessionId) return sess
        const last = sess.messages[sess.messages.length - 1]
        const messages = last && last.role === 'assistant' ? sess.messages.slice(0, -1) : sess.messages
        return { ...sess, messages, status: 'running' as const, error: null }
      }),
    })),

  setConnection: (connection) => set({ connection }),
}))
