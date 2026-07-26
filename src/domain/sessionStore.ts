// src/domain/sessionStore.ts
import { create } from 'zustand'
import type { AcpConfigOption, AgentFrame, AgentProfileInfo, AgentRole, AgentRun, Message, PermissionOption, PermissionRequestPayload, PlanItem, SearchHit, ServerMessage, SessionConfig, SessionSummary, TimelineStep, ToolCall } from '@hip/protocol'
import { normalizeSessionConfig } from '@hip/protocol'
import type { LocalAttachment } from '@/components/chat/attachmentTypes'

/** A surfaced server error tied to a session (e.g. NO_API_KEY, AGENT_ERROR). */
export interface SessionError {
  code: string
  message: string
}

/** A pending HITL tool-permission request awaiting the user's choice (ACP agents only). */
export interface PendingPermission {
  turnId: string
  requestId: string
  tool: PermissionRequestPayload
  options: PermissionOption[]
  agentFrame?: AgentFrame
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
  interrupt?: { turnId: string; question: string; context?: string } | null  // pending HITL question; null/absent = none
  configOptions?: AcpConfigOption[]  // agent-advertised model/mode selectors (ACP agents only); absent = none
  pendingPermission?: PendingPermission | null  // pending HITL tool-permission request (ACP agents only); null/absent = none
  activeTurnPlan?: PlanItem[] | null  // live plan from plan:updated / plan:published; cleared on next user turn
  /** plan.md body from plan:published (D2.5); cleared on next user turn / reject */
  activeTurnPlanMarkdown?: string | null
  activeTurnPlanPath?: string | null
  activeTurnPlanMarkdownTruncated?: boolean
  planDeltaDraft?: Record<string, string>  // incremental plan text keyed by itemId, accumulated from plan:delta
  planApprovalPending?: boolean  // true when agent:interrupt carries a plan_approval context
  /**
   * Snapshot for rolling back optimistic plan:respond UI when plan:respond:result ok:false (KD-16).
   * Cleared on ok:true or after restore.
   */
  planRespondRollback?: {
    interrupt: { turnId: string; question: string; context?: string } | null
    status: 'idle' | 'running' | 'error'
    activeTurnPlan?: PlanItem[] | null
    activeTurnPlanMarkdown?: string | null
    activeTurnPlanPath?: string | null
    activeTurnPlanMarkdownTruncated?: boolean
  } | null
  agentProfiles?: AgentProfileInfo[]  // list of available agent profiles from agent:profiles message
  codePanelOpen?: boolean
  chatPanelOpen?: boolean
}

/** Turn-end sweep for a Message-level ToolCall[]: coerce any tool still 'running' to error so a delivered/finalized message matches the persisted trace after a cancel/interruption. */
function coerceRunningToolCalls(toolCalls: ToolCall[] | undefined): ToolCall[] | undefined {
  if (!toolCalls?.some((tc) => tc.status === 'running')) return toolCalls
  return toolCalls.map((tc) => (tc.status === 'running' ? { ...tc, status: 'error' as const, error: tc.error ?? 'interrupted' } : tc))
}

/** Index of the last `role === 'assistant'` message (from the tail); -1 if none.
 *  Ignores trailing `notice` rows so cancel / streaming / regenerate target the real turn. */
export function lastAssistantIndex(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') return i
  }
  return -1
}

/** Last message that is not a system notice (transparent for turn-boundary checks). */
export function lastNonNotice(messages: Message[]): Message | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== 'notice') return messages[i]
  }
  return undefined
}

/** True when `messages[index]` is the last assistant of the open turn: last assistant index
 *  and no newer user after it (notices after the assistant are OK). Used for regenerate /
 *  isLastAssistant and as the base for isStreamingAssistant. */
export function isCurrentTurnAssistant(messages: Message[], index: number): boolean {
  if (messages[index]?.role !== 'assistant') return false
  if (index !== lastAssistantIndex(messages)) return false
  for (let i = index + 1; i < messages.length; i++) {
    if (messages[i].role === 'user') return false
  }
  return true
}

/** True when `messages[index]` is the in-flight streaming assistant for the current turn. */
export function isStreamingAssistant(
  messages: Message[],
  index: number,
  status: string,
): boolean {
  if (status !== 'running') return false
  return isCurrentTurnAssistant(messages, index)
}

/** Drop trailing assistant + notice messages until a user (or empty). Used by regenerate. */
export function popForRegenerate(messages: Message[]): Message[] {
  const next = [...messages]
  while (next.length > 0) {
    const r = next[next.length - 1].role
    if (r === 'assistant' || r === 'notice') next.pop()
    else break
  }
  return next
}

/** On cancel, finalize the in-flight last assistant message (ignoring trailing notice): drop it if
 *  it's a fully empty provisional (no content/timeline/tools), else if it is still in-flight
 *  (empty content OR has running tools) coerce tools to error and mark it stopped.
 *  Prior completed turns are left alone. */
function finalizeCancelledMessage(messages: Message[]): Message[] {
  const idx = lastAssistantIndex(messages)
  if (idx === -1) return messages
  const m = messages[idx]
  const empty = m.content === '' && !(m.timeline?.length) && !(m.toolCalls?.length)
  if (empty) return messages.filter((_, k) => k !== idx)
  const inFlight = m.content === '' || !!m.toolCalls?.some((tc) => tc.status === 'running')
  if (!inFlight) return messages // prior completed turn — leave alone
  return mapMessages(messages, (x) =>
    x.id === m.id ? { ...x, toolCalls: coerceRunningToolCalls(x.toolCalls), stopped: true } : x,
  )
}

/** Build a freshly-started ToolCall from a tool:started message. */
function makeRunningToolCall(msg: { callId: string; agentId: string; name: string; input: string; seq: number; truncated?: boolean }): ToolCall {
  return { callId: msg.callId, agentId: msg.agentId, name: msg.name, input: msg.input, status: 'running', seq: msg.seq, ...(msg.truncated ? { truncated: true } : {}) }
}

/** Apply a tool:finished patch to an existing ToolCall (sticky-OR truncated). */
function patchFinishedToolCall(tc: ToolCall, msg: { status: 'finished' | 'error'; output?: string; error?: string; truncated?: boolean }): ToolCall {
  return { ...tc, status: msg.status, ...(msg.output !== undefined ? { output: msg.output } : {}), ...(msg.error !== undefined ? { error: msg.error } : {}), ...(tc.truncated || msg.truncated ? { truncated: true } : {}) }
}

/**
 * Map over messages while preserving **array identity** when every element is
 * referentially unchanged. Unchanged message objects are always kept as-is
 * (`fn` should return the same ref when nothing mutates). This lets React.memo
 * on MessageBubble skip re-renders for prior turns during stream/tool updates.
 */
export function mapMessages(messages: Message[], fn: (m: Message) => Message): Message[] {
  let changed = false
  const next = messages.map((m) => {
    const m2 = fn(m)
    if (m2 !== m) changed = true
    return m2
  })
  return changed ? next : messages
}

/** Ensure the provisional assistant message keyed by turnId exists (idempotent).
 *  Invariant v2: stream/tool/reasoning/complete only mutate `message.id === turnId` (not the list tail).
 *  agent:started creates the provisional; notice rows may trail the turn without breaking addressing. */
function ensureAssistantMessage(messages: Message[], turnId: string, agentId: string, now: number): Message[] {
  if (messages.some((m) => m.id === turnId)) return messages
  return [...messages, { id: turnId, role: 'assistant', content: '', agentId, timestamp: now, timeline: [], toolCalls: [] }]
}

/** Upsert a reasoning step on the turn's message: same stepSeq concatenates the delta. No-op if the turn is unknown. */
function upsertReasoning(messages: Message[], turnId: string, step: { stepSeq: number; agentId: string; role: AgentRole; delta: string }): Message[] {
  if (!messages.some((m) => m.id === turnId)) return messages
  return mapMessages(messages, (m) => {
    if (m.id !== turnId) return m
    const timeline = m.timeline ?? []
    const exists = timeline.some((t) => t.kind === 'reasoning' && t.stepSeq === step.stepSeq)
    const nextTimeline = exists
      ? timeline.map((t) => (t.kind === 'reasoning' && t.stepSeq === step.stepSeq ? { ...t, content: t.content + step.delta } : t))
      : [...timeline, { kind: 'reasoning' as const, stepSeq: step.stepSeq, agentId: step.agentId, role: step.role, content: step.delta }]
    return { ...m, timeline: nextTimeline }
  })
}

/**
 * Upsert a supervisor text step (KD-17): same stepSeq concatenates the delta.
 * Non-supervisor agentId/role is a defensive no-op (subagent tokens must never become text steps).
 */
function upsertTimelineText(
  messages: Message[],
  turnId: string,
  step: { stepSeq: number; agentId: string; role: AgentRole; delta: string },
): Message[] {
  const isSupervisor = step.agentId === 'supervisor' || step.role === 'supervisor'
  if (!isSupervisor) return messages
  if (!messages.some((m) => m.id === turnId)) return messages
  return messages.map((m) => {
    if (m.id !== turnId) return m
    const timeline = m.timeline ?? []
    const exists = timeline.some((t) => t.kind === 'text' && t.stepSeq === step.stepSeq)
    const nextTimeline = exists
      ? timeline.map((t) => (t.kind === 'text' && t.stepSeq === step.stepSeq ? { ...t, content: t.content + step.delta } : t))
      : [...timeline, { kind: 'text' as const, stepSeq: step.stepSeq, agentId: step.agentId, role: step.role, content: step.delta } satisfies TimelineStep]
    return { ...m, timeline: nextTimeline }
  })
}

/** Append supervisor token delta to the message with `id === turnId`. No-op if the turn is unknown. */
function appendAssistantDelta(messages: Message[], turnId: string, delta: string): Message[] {
  if (!messages.some((m) => m.id === turnId)) return messages
  return mapMessages(messages, (m) => (m.id === turnId ? { ...m, content: m.content + delta } : m))
}


/** Upsert an AgentRun onto the turn's assistant message (keyed by turnId). No-op if the turn is unknown.
 *  Assigns a provisional insertion-order seq on append; preserves the prior seq on replace.
 *  (message:complete later overwrites runs with the sidecar's authoritative seqs.) */
function upsertRun(messages: Message[], turnId: string, run: AgentRun): Message[] {
  if (!messages.some((m) => m.id === turnId)) return messages
  return mapMessages(messages, (m) => {
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
  return mapMessages(messages, (m) =>
    m.id !== turnId || !m.agentRuns
      ? m
      : { ...m, agentRuns: m.agentRuns.map((r) => (r.agentId === agentId ? { ...r, output: r.output + delta } : r)) },
  )
}

/** Set finishedAt on the run for the given turn + agent. */
function setRunFinished(messages: Message[], turnId: string, agentId: string, now: number): Message[] {
  return mapMessages(messages, (m) =>
    m.id !== turnId || !m.agentRuns
      ? m
      : { ...m, agentRuns: m.agentRuns.map((r) => (r.agentId === agentId ? { ...r, finishedAt: now } : r)) },
  )
}

/** Replace the message with matching `message.id`, or append if not found (never relies on list tail). */
function finalizeAssistant(messages: Message[], message: Message): Message[] {
  const idx = messages.findIndex((m) => m.id === message.id)
  if (idx >= 0) return mapMessages(messages, (m) => (m.id === message.id ? message : m))
  return [...messages, message]
}

function summaryToVM(s: SessionSummary): SessionVM {
  const cwd = typeof s.cwd === 'string' && s.cwd.trim() ? s.cwd.trim() : undefined
  return {
    id: s.id,
    config: { ...DEFAULT_CONFIG, surface: s.surface, ...(cwd ? { cwd } : {}) },
    title: s.title,
    preview: s.preview,
    updatedAtMs: s.updatedAt,
    loaded: false,
    messages: [],
    status: 'idle',
    error: null,
    interrupt: null,
    codePanelOpen: false,
    chatPanelOpen: false,
  }
}

/** Surface state for a plugin installation driven by WebSocket messages. */
export interface PluginInstallState {
  status:
    | 'cloning'
    | 'scanning'
    | 'generating_manifest'
    | 'reviewing_models'
    | 'registering'
    | 'done'
    | 'error'
  message: string
  pluginId?: string
  result?: { ok: boolean; error?: string }
  modelReview?: import('@hip/protocol').PluginModelReviewSummary
}

/** 把一条 ServerMessage 归并进状态。纯函数：now 由调用方注入。 */
export function applyServerMessage(
  state: { sessions: SessionVM[]; pluginInstall?: PluginInstallState | null },
  msg: ServerMessage,
  now: number,
): { sessions: SessionVM[]; pluginInstall?: PluginInstallState | null } {
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
        ...(msg.name ? { name: msg.name } : {}),
      }
      return update(msg.sessionId, (s) => {
        // Always ensure the turn assistant message exists (council subagents may
        // race or re-enter after supervisor start; upsertRun no-ops without it).
        const base = ensureAssistantMessage(
          s.messages,
          msg.turnId,
          msg.role === 'supervisor' ? msg.agentId : 'supervisor',
          now,
        )
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
// Always address by turnId (PR-2). KD-17: supervisor+stepSeq → text step + content;
        // supervisor without stepSeq → content only; subagent → run.output only.
        const turn = s.messages.find((m) => m.id === msg.turnId)
        const run = turn?.role === 'assistant' ? turn.agentRuns?.find((r) => r.agentId === msg.agentId) : undefined
        const isSupervisor =
          (msg as { role?: string }).role === 'supervisor' ||
          (run ? run.role === 'supervisor' : msg.agentId === 'supervisor')
        const stepSeq = (msg as { stepSeq?: number }).stepSeq
        if (stepSeq != null && isSupervisor) {
          const role: AgentRole = ((msg as { role?: AgentRole }).role ?? run?.role ?? 'supervisor') as AgentRole
          let messages = upsertTimelineText(s.messages, msg.turnId, {
            stepSeq,
            agentId: msg.agentId,
            role,
            delta: msg.delta,
          })
          messages = appendAssistantDelta(messages, msg.turnId, msg.delta)
          return { ...s, messages }
        }
        const messages = isSupervisor
          ? appendAssistantDelta(s.messages, msg.turnId, msg.delta)
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
        messages: mapMessages(s.messages, (m) =>
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
        messages: mapMessages(s.messages, (m) =>
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
      // Keep activeTurnPlan for sticky done panel until the next user turn (appendUserMessage clears it).
      // KD-7 / D4c: do NOT clear planApprovalPending — complete arrives before agent:interrupt
      // on the plan-ready path; clearing would drop the approval UI in a race window.
      return update(msg.sessionId, (s) => ({ ...s, status: 'idle', planDeltaDraft: {}, messages: finalizeAssistant(s.messages, finalized) }))
    }

    case 'agent:interrupt':
      return update(msg.sessionId, (s) => {
        let planApprovalPending = false
        if (msg.context) {
          try {
            planApprovalPending = JSON.parse(msg.context).kind === 'plan_approval'
          } catch {
            planApprovalPending = false
          }
        }
        return { ...s, status: s.status === 'running' ? 'idle' : s.status, interrupt: { turnId: msg.turnId, question: msg.question, context: msg.context }, planApprovalPending }
      })

    case 'plan:delta':
      return update(msg.sessionId, (s) => ({
        ...s,
        planDeltaDraft: { ...s.planDeltaDraft, [msg.itemId]: (s.planDeltaDraft?.[msg.itemId] ?? '') + msg.delta },
      }))

    case 'plan:updated':
      // Keep prior markdown (D2.5) — plan:updated only refreshes checklist items.
      return update(msg.sessionId, (s) => ({ ...s, activeTurnPlan: msg.plan, planDeltaDraft: {} }))

    case 'plan:published': {
      // Set markdown fields if body present; clear all (incl. path) if omitted — D2.5.
      const hasMarkdown = Boolean(msg.markdown?.trim())
      return update(msg.sessionId, (s) => ({
        ...s,
        activeTurnPlan: msg.plan,
        planDeltaDraft: {},
        activeTurnPlanMarkdown: hasMarkdown ? msg.markdown! : null,
        // Path only meaningful with a body (avoid orphan path on empty publish).
        activeTurnPlanPath: hasMarkdown ? (msg.planPath ?? null) : null,
        activeTurnPlanMarkdownTruncated: hasMarkdown ? Boolean(msg.markdownTruncated) : false,
      }))
    }

    case 'plan:respond:result':
      // KD-16: ok:false restores approval chrome after optimistic dismiss; ok:true drops rollback stash.
      return update(msg.sessionId, (s) => {
        if (msg.ok) {
          if (!s.planRespondRollback) return s
          return { ...s, planRespondRollback: null }
        }
        const snap = s.planRespondRollback
        return {
          ...s,
          planApprovalPending: true,
          interrupt: snap?.interrupt ?? s.interrupt ?? null,
          status: snap?.status ?? (s.status === 'running' ? 'idle' : s.status),
          ...(snap
            ? {
                activeTurnPlan: snap.activeTurnPlan !== undefined ? snap.activeTurnPlan : s.activeTurnPlan,
                activeTurnPlanMarkdown:
                  snap.activeTurnPlanMarkdown !== undefined
                    ? snap.activeTurnPlanMarkdown
                    : s.activeTurnPlanMarkdown,
                activeTurnPlanPath:
                  snap.activeTurnPlanPath !== undefined ? snap.activeTurnPlanPath : s.activeTurnPlanPath,
                activeTurnPlanMarkdownTruncated:
                  snap.activeTurnPlanMarkdownTruncated !== undefined
                    ? snap.activeTurnPlanMarkdownTruncated
                    : s.activeTurnPlanMarkdownTruncated,
              }
            : {}),
          planRespondRollback: null,
        }
      })

    case 'agent:configOptions':
      return update(msg.sessionId, (s) => ({ ...s, configOptions: msg.options }))

    case 'agent:profiles':
      return update(msg.sessionId, (s) => ({ ...s, agentProfiles: msg.profiles }))

    case 'permission:request':
      return update(msg.sessionId, (s) => ({
        ...s,
        pendingPermission: { turnId: msg.turnId, requestId: msg.requestId, tool: msg.tool, options: msg.options, ...(msg.agentFrame ? { agentFrame: msg.agentFrame } : {}) },
      }))

    case 'permission:resolved':
      return update(msg.sessionId, (s) => {
        if (!s.pendingPermission || s.pendingPermission.requestId !== msg.requestId) return s
        return { ...s, pendingPermission: null }
      })

    case 'agent:interrupt:resolved':
      return update(msg.sessionId, (s) => {
        // Clear sticky plan/interrupt chrome when any client resolves the pause.
        if (s.interrupt && msg.turnId && s.interrupt.turnId !== msg.turnId) {
          // Different turn — still clear planApprovalPending if set (foreign resolve).
          if (!s.planApprovalPending && !s.planRespondRollback) return s
        }
        return {
          ...s,
          interrupt: null,
          planApprovalPending: false,
          planRespondRollback: null,
        }
      })

    case 'session:thinking':
      return update(msg.sessionId, (s) => ({ ...s, config: { ...s.config, thinking: msg.thinking } }))

    case 'session:effort':
      return update(msg.sessionId, (s) => ({
        ...s,
        config: {
          ...s.config,
          effort: msg.effort ?? undefined,
        },
      }))

    case 'session:permissionMode':
      return update(msg.sessionId, (s) => {
        const leaveFull = msg.permissionMode !== 'full'
        const clearAuto = leaveFull && s.config.executionMode === 'autopilot'
        return {
          ...s,
          config: {
            ...s.config,
            permissionMode: msg.permissionMode,
            ...(clearAuto ? { executionMode: 'interactive' as const, forcePlan: false } : {}),
          },
        }
      })

    case 'session:agentChanged':
      return update(msg.sessionId, (s) => {
        const next = msg.agentId && msg.agentId !== 'builtin' ? msg.agentId : undefined
        if (!next) {
          const { agentId: _cleared, ...rest } = s.config
          return { ...s, config: rest, configOptions: undefined }
        }
        // Mirror sidecar: external primary drops hip-only forcePlan / executionMode.
        const { forcePlan: _fp, executionMode: _em, ...rest } = s.config
        return { ...s, config: { ...rest, agentId: next }, configOptions: undefined }
      })

    case 'session:forcePlan':
      return update(msg.sessionId, (s) => {
        const keepAuto = s.config.executionMode === 'autopilot' && !msg.forcePlan
        return {
          ...s,
          config: {
            ...s.config,
            forcePlan: msg.forcePlan,
            ...(msg.forcePlan
              ? { disablePlan: false, executionMode: 'plan' as const }
              : { executionMode: keepAuto ? ('autopilot' as const) : ('interactive' as const) }),
          },
        }
      })

    case 'session:executionMode':
      return update(msg.sessionId, (s) => ({
        ...s,
        config: {
          ...s.config,
          executionMode: msg.executionMode,
          forcePlan: msg.executionMode === 'plan',
          ...(msg.executionMode === 'plan' ? { disablePlan: false } : {}),
        },
      }))

    case 'session:systemPrompt':
      return update(msg.sessionId, (s) => ({ ...s, config: { ...s.config, systemPrompt: msg.systemPrompt || undefined } }))

    case 'session:model':
      return update(msg.sessionId, (s) => ({ ...s, config: { ...s.config, llmProvider: msg.llmProvider, model: msg.model } }))

    case 'session:orchMode':
      return update(msg.sessionId, (s) => ({ ...s, config: { ...s.config, orchMode: msg.orchMode } }))

    case 'session:memoryFlags':
      return update(msg.sessionId, (s) => ({
        ...s,
        config: {
          ...s.config,
          ...(msg.useMemories !== undefined ? { useMemories: msg.useMemories } : {}),
          ...(msg.generateMemories !== undefined ? { generateMemories: msg.generateMemories } : {}),
          ...(msg.incognito !== undefined ? { incognito: msg.incognito } : {}),
        },
      }))

    case 'error':
      // A cancel is intentional, not a failure: return to idle and surface nothing.
      if (!msg.sessionId) return state
      if (msg.code === 'CANCELLED') {
        return update(msg.sessionId, (s) => ({
          ...s,
          status: 'idle',
          error: null,
          activeTurnPlan: null,
          activeTurnPlanMarkdown: null,
          activeTurnPlanPath: null,
          activeTurnPlanMarkdownTruncated: false,
          planDeltaDraft: {},
          planApprovalPending: false,
          messages: finalizeCancelledMessage(s.messages),
        }))
      }
      // Soft rejects (concurrent send / agent mid-switch / empty resume while plan awaiting):
      // toast-only or no-op; do not demote status or clear planApprovalPending.
      if (msg.code === 'BUSY' || msg.code === 'AGENT_BUSY' || msg.code === 'PLAN_AWAITING_RESPONSE') {
        return state
      }
      return update(msg.sessionId, (s) => ({
        ...s,
        status: 'error',
        error: { code: msg.code, message: msg.message },
        activeTurnPlan: null,
        activeTurnPlanMarkdown: null,
        activeTurnPlanPath: null,
        activeTurnPlanMarkdownTruncated: false,
        planDeltaDraft: {},
        planApprovalPending: false,
      }))

    case 'session:list:result': {
      const incoming = msg.sessions.map(summaryToVM)
      // 保留已加载会话；用摘要替换/插入；按更新时间倒序。
      // Always refresh surface/cwd from the authoritative list so sidebar grouping
      // and project-path gates work before a session is fully loaded.
      const byId = new Map(state.sessions.map((s) => [s.id, s]))
      for (const vm of incoming) {
        const prev = byId.get(vm.id)
        if (prev?.loaded) {
          const nextConfig = { ...prev.config, surface: vm.config.surface ?? prev.config.surface }
          if (vm.config.cwd?.trim()) nextConfig.cwd = vm.config.cwd.trim()
          else delete nextConfig.cwd
          byId.set(vm.id, {
            ...prev,
            title: vm.title,
            preview: vm.preview,
            updatedAtMs: vm.updatedAtMs,
            config: nextConfig,
          })
        } else {
          byId.set(vm.id, vm)
        }
      }
      return { sessions: [...byId.values()].sort((a, b) => b.updatedAtMs - a.updatedAtMs) }
    }

    case 'session:loaded':
      return update(msg.sessionId, (s) => {
        // A completed conversation always ends with an assistant reply; a trailing user
        // message means the last turn never finished (drop/crash/timeout) → interrupted.
        // Skip notices if they ever appear in persisted transcripts (transparent for turn boundary).
        const last = lastNonNotice(msg.messages)
        const interrupted = last?.role === 'user'
        return {
          ...s,
          loaded: true,
          config: msg.config ? { ...msg.config, surface: msg.config.surface ?? s.config.surface } : s.config,
          messages: msg.messages,
          status: interrupted ? 'error' : 'idle',
          error: interrupted ? { code: 'INTERRUPTED', message: '' } : null,
          // Loading persisted state resets any transient UI state from a previous session
          // instance (e.g. after reconnect). Without this, stale interrupts or pending
          // permissions can block regenerate and leave the pause button unreachable.
          interrupt: null,
          pendingPermission: null,
          configOptions: undefined,
          agentProfiles: undefined,
          activeTurnPlan: null,
          activeTurnPlanMarkdown: null,
          activeTurnPlanPath: null,
          activeTurnPlanMarkdownTruncated: false,
          planDeltaDraft: {},
          planApprovalPending: false,
        }
      })

    case 'session:deleted':
    case 'session:trashed':
      // Soft and hard both remove from the active domain list.
      return { sessions: state.sessions.filter((s) => s.id !== msg.sessionId) }

    case 'session:restored': {
      // Merge summary into list without auto-select (design restore rules).
      if (state.sessions.some((s) => s.id === msg.summary.id)) return state
      return { sessions: [summaryToVM(msg.summary), ...state.sessions] }
    }

    case 'session:title':
      return update(msg.sessionId, (s) => ({ ...s, title: msg.title }))

    case 'session:cwd':
      return update(msg.sessionId, (s) => {
        const config = { ...s.config }
        if (!msg.cwd?.trim()) {
          delete config.cwd
        } else {
          config.cwd = msg.cwd
        }
        return { ...s, config }
      })

    case 'agent:notification':
      // KD-13: always role 'notice' — never assistant — so trailing notifications cannot
      // steal stream/finalize/regenerate targeting from the active turn.
      // Id includes status+now: same taskId can emit start + terminal notices (no React key clash).
      return update(msg.sessionId, (s) => ({
        ...s,
        messages: [
          ...s.messages,
          {
            id: `notif-${msg.taskId}-${msg.status}-${now}`,
            role: 'notice' as const,
            content: msg.status === 'completed'
              ? `[Background task "${msg.description}" completed]`
              : msg.status === 'killed'
                ? `[Background task "${msg.description}" killed: ${msg.error ?? 'stopped'}]`
                : `[Background task "${msg.description}" failed: ${msg.error ?? 'unknown error'}]`,
            timestamp: now,
          },
        ],
      }))

    case 'task:notification':
      return update(msg.sessionId, (s) => ({
        ...s,
        messages: [
          ...s.messages,
          {
            id: `task-notif-${msg.taskId}-${msg.status}-${now}`,
            role: 'notice' as const,
            content:
              msg.status === 'completed'
                ? `[${msg.kind} "${msg.description}" completed]`
                : msg.status === 'killed'
                  ? `[${msg.kind} "${msg.description}" killed: ${msg.error ?? 'stopped'}]`
                  : msg.status === 'suppressed'
                    ? `[${msg.kind} "${msg.description}" suppressed: ${msg.error ?? 'volume limit'}]`
                    : msg.status === 'lost'
                      ? `[${msg.kind} "${msg.description}" lost]`
                      : `[${msg.kind} "${msg.description}" failed: ${msg.error ?? 'unknown error'}]`,
            timestamp: now,
          },
        ],
      }))

    case 'plugin:install:progress':
      return { ...state, pluginInstall: { status: msg.status, message: msg.message, pluginId: msg.pluginId } }

    case 'plugin:install:result':
      return {
        ...state,
        pluginInstall: {
          status: msg.ok ? 'done' : 'error',
          message: msg.ok ? '' : (msg.error ?? ''),
          pluginId: msg.pluginId,
          result: { ok: msg.ok, error: msg.error },
          modelReview: msg.modelReview,
        },
      }

    default:
      return state
  }
}

/** Clear a session's pending permission request once the user has responded. Matches by
 *  requestId so a stale/already-replaced request can't clobber a newer one. No-op if none match. */
export function clearPermission(state: { sessions: SessionVM[] }, requestId: string): { sessions: SessionVM[] } {
  if (!state.sessions.some((s) => s.pendingPermission?.requestId === requestId)) return state
  return {
    sessions: state.sessions.map((s) =>
      s.pendingPermission?.requestId === requestId ? { ...s, pendingPermission: null } : s,
    ),
  }
}

export const DEFAULT_CONFIG: SessionConfig = normalizeSessionConfig({
  llmProvider: 'deepseek',
  model: '',
  tools: [],
})

export function emptySession(id: string): SessionVM {
  return {
    id,
    config: DEFAULT_CONFIG,
    title: '新对话',
    preview: '开始一段新的对话…',
    updatedAtMs: Date.now(),
    loaded: true,
    messages: [],
    status: 'idle',
    error: null,
    interrupt: null,
    activeTurnPlan: null,
    activeTurnPlanMarkdown: null,
    activeTurnPlanPath: null,
    activeTurnPlanMarkdownTruncated: false,
    planDeltaDraft: {},
    planApprovalPending: false,
    codePanelOpen: false,
    chatPanelOpen: false,
  }
}

export type Connection = 'connecting' | 'connected' | 'error' | 'disconnected'

export interface McpServerStatusVM {
  id: string
  name: string
  status: 'connected' | 'connecting' | 'disconnected' | 'error'
  toolCount: number
  toolNames: string[]
  lastError?: string
}

interface DomainStore {
  sessions: SessionVM[]
  activeSessionId: string | null
  connection: Connection
  hasApiKey: boolean
  searchHits: SearchHit[]
  searching: boolean
  mcpStatuses: McpServerStatusVM[]
  pluginInstall: PluginInstallState | null

  apply: (msg: ServerMessage) => void
  createSession: (id: string, config: SessionConfig) => string
  selectSession: (id: string) => void
  deselect: () => void
  deleteSession: (id: string) => void
  renameSession: (id: string, title: string) => void
  appendUserMessage: (sessionId: string, id: string, content: string, attachments?: LocalAttachment[]) => void
  appendMessage: (sessionId: string, message: { id: string; role: 'user' | 'assistant'; content: string; timestamp: number }) => void
  /**
   * Optimistic plan HITL response: drop PlanApprovalCard immediately.
   * approve/amend → running; reject → idle (sidecar may still send PLAN_REJECTED).
   */
  respondPlanOptimistic: (sessionId: string, action: 'approve' | 'reject' | 'amend') => void
  regenerateLastTurn: (sessionId: string) => void
  clearPermission: (requestId: string) => void
  setConnection: (c: Connection) => void
  setSearching: (v: boolean) => void
  clearPluginInstall: () => void
  setSessionCodePanelOpen: (sessionId: string, open: boolean) => void
  setSessionChatPanelOpen: (sessionId: string, open: boolean) => void
  toggleSessionCodePanel: (sessionId: string) => void
  toggleSessionChatPanel: (sessionId: string) => void
}

export const useDomainStore = create<DomainStore>((set) => ({
  sessions: [],
  activeSessionId: null,
  connection: 'disconnected',
  // Optimistic until the sidecar reports via 'ready' — avoids flashing "no key" before connect.
  hasApiKey: true,
  searchHits: [],
  searching: false,
  mcpStatuses: [],
  pluginInstall: null,

  apply: (msg) =>
    set((s) => {
      if (msg.type === 'ready') return { hasApiKey: msg.hasApiKey }
      // A live model switch carries the new active provider's key status — refresh the banner without
      // waiting for a reconnect's `ready`. (Top-level field, so handle here like `ready`, not in the reducer.)
      if (msg.type === 'config:activeModel') return { hasApiKey: msg.hasApiKey }
      if (msg.type === 'session:search:result') return { searchHits: msg.hits, searching: false }
      if (msg.type === 'mcp:status') return { mcpStatuses: msg.servers }
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

  appendUserMessage: (sessionId, id, content, attachments = []) =>
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id !== sessionId
          ? sess
          : // Clear any prior error: appending a user message means a retry is underway.
            // D2.5: clear plan checklist + markdown on next user turn.
            {
              ...sess,
              status: 'running' as const,
              error: null,
              interrupt: null,
              activeTurnPlan: null,
              activeTurnPlanMarkdown: null,
              activeTurnPlanPath: null,
              activeTurnPlanMarkdownTruncated: false,
              planDeltaDraft: {},
              planApprovalPending: false,
              updatedAtMs: Date.now(),
              messages: [
                ...sess.messages,
                { id, role: 'user' as const, content, timestamp: Date.now(), attachments },
              ],
            },
      ),
    })),

  appendMessage: (sessionId, message) =>
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id !== sessionId ? sess : { ...sess, messages: [...sess.messages, message], updatedAtMs: Date.now() },
      ),
    })),

  respondPlanOptimistic: (sessionId, action) =>
    set((s) => ({
      sessions: s.sessions.map((sess) => {
        if (sess.id !== sessionId) return sess
        const isReject = action === 'reject'
        const nextStatus = isReject ? ('idle' as const) : ('running' as const)
        return {
          ...sess,
          status: nextStatus,
          error: isReject ? sess.error : null,
          // Stash for plan:respond:result ok:false rollback (KD-16 / D2.5 markdown).
          planRespondRollback: {
            interrupt: sess.interrupt ?? null,
            status: sess.status,
            activeTurnPlan: sess.activeTurnPlan ?? null,
            activeTurnPlanMarkdown: sess.activeTurnPlanMarkdown ?? null,
            activeTurnPlanPath: sess.activeTurnPlanPath ?? null,
            activeTurnPlanMarkdownTruncated: sess.activeTurnPlanMarkdownTruncated,
          },
          interrupt: null,
          planApprovalPending: false,
          // D2.5: approve/amend keep checklist + markdown until next user turn;
          // reject clears both (PLAN_REJECTED may follow).
          ...(isReject
            ? {
                activeTurnPlan: null as PlanItem[] | null,
                activeTurnPlanMarkdown: null as string | null,
                activeTurnPlanPath: null as string | null,
                activeTurnPlanMarkdownTruncated: false,
              }
            : {}),
          updatedAtMs: Date.now(),
        }
      }),
    })),

  regenerateLastTurn: (sessionId) =>
    set((s) => ({
      sessions: s.sessions.map((sess) => {
        if (sess.id !== sessionId) return sess
        const messages = popForRegenerate(sess.messages)
        return {
          ...sess,
          messages,
          status: 'running' as const,
          error: null,
          interrupt: null,
          pendingPermission: null,
          activeTurnPlan: null,
          activeTurnPlanMarkdown: null,
          activeTurnPlanPath: null,
          activeTurnPlanMarkdownTruncated: false,
          planDeltaDraft: {},
          planApprovalPending: false,
        }
      }),
    })),

  clearPermission: (requestId) => set((s) => clearPermission(s, requestId)),

  setConnection: (connection) => set({ connection }),

  setSearching: (v) => set({ searching: v }),

  clearPluginInstall: () => set({ pluginInstall: null }),

  setSessionCodePanelOpen: (sessionId, open) =>
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id !== sessionId
          ? sess
          : sess.codePanelOpen === open
            ? sess
            : { ...sess, codePanelOpen: open }
      ),
    })),

  setSessionChatPanelOpen: (sessionId, open) =>
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id !== sessionId
          ? sess
          : sess.chatPanelOpen === open
            ? sess
            : { ...sess, chatPanelOpen: open }
      ),
    })),

  toggleSessionCodePanel: (sessionId) =>
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id !== sessionId ? sess : { ...sess, codePanelOpen: !sess.codePanelOpen }
      ),
    })),

  toggleSessionChatPanel: (sessionId) =>
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id !== sessionId ? sess : { ...sess, chatPanelOpen: !sess.chatPanelOpen }
      ),
    })),
}))
