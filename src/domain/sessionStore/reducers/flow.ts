// src/domain/sessionStore/reducers/flow.ts
// Turn-round state machine: agent/tool/token/message/reasoning/error/task messages.
// These share turnId/agentRuns/timeline/status state and must stay in one file.
import type { AgentRole, AgentRun, Message, ServerMessage, TimelineStep } from '@hip/protocol'
import {
  appendAssistantDelta,
  appendRunOutput,
  coerceRunningToolCalls,
  ensureAssistantMessage,
  finalizeAssistant,
  finalizeCancelledMessage,
  makeRunningToolCall,
  mapMessages,
  patchFinishedToolCall,
  setRunFinished,
  upsertReasoning,
  upsertRun,
  upsertTimelineText,
} from '../messageUtils'
import { updateSession, type SessionState } from './helpers'

export function flowReducer(state: SessionState, msg: ServerMessage, now: number): SessionState {
  switch (msg.type) {
    case 'agent:started': {
      const run: AgentRun = {
        agentId: msg.agentId, role: msg.role, output: '', startedAt: now, finishedAt: null, seq: 0, messageId: msg.turnId,
        ...(msg.taskInput ? { taskInput: msg.taskInput } : {}),
        ...(msg.parentAgentId ? { parentAgentId: msg.parentAgentId } : {}),
        ...(msg.name ? { name: msg.name } : {}),
      }
      return updateSession(state, msg.sessionId, (s) => {
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
      return updateSession(state, msg.sessionId, (s) => {
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
      return updateSession(state, msg.sessionId, (s) => ({
        ...s,
        messages: upsertReasoning(s.messages, msg.turnId, { stepSeq: msg.stepSeq, agentId: msg.agentId, role: msg.role, delta: msg.delta }),
      }))

    case 'agent:finished':
      return updateSession(state, msg.sessionId, (s) => ({
        ...s,
        messages: setRunFinished(s.messages, msg.turnId, msg.agentId, now),
      }))

    case 'tool:started':
      return updateSession(state, msg.sessionId, (s) => ({
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
      return updateSession(state, msg.sessionId, (s) => ({
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
      return updateSession(state, msg.sessionId, (s) => ({ ...s, status: 'idle', planDeltaDraft: {}, messages: finalizeAssistant(s.messages, finalized) }))
    }

    case 'agent:interrupt':
      return updateSession(state, msg.sessionId, (s) => {
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

    case 'agent:configOptions':
      return updateSession(state, msg.sessionId, (s) => ({ ...s, configOptions: msg.options }))

    case 'agent:profiles':
      return updateSession(state, msg.sessionId, (s) => ({ ...s, agentProfiles: msg.profiles }))

    case 'agent:interrupt:resolved':
      return updateSession(state, msg.sessionId, (s) => {
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

    case 'error':
      // A cancel is intentional, not a failure: return to idle and surface nothing.
      if (!msg.sessionId) return state
      if (msg.code === 'CANCELLED') {
        return updateSession(state, msg.sessionId, (s) => ({
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
      return updateSession(state, msg.sessionId, (s) => ({
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

    case 'agent:notification':
      // KD-13: always role 'notice' — never assistant — so trailing notifications cannot
      // steal stream/finalize/regenerate targeting from the active turn.
      // Id includes status+now: same taskId can emit start + terminal notices (no React key clash).
      return updateSession(state, msg.sessionId, (s) => ({
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
      return updateSession(state, msg.sessionId, (s) => ({
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

    default:
      return state
  }
}
