// src/domain/sessionStore/reducers/index.ts
import type {
  AgentRole,
  AgentRun,
  Message,
  ServerMessage,
  SessionSummary,
  TimelineStep,
} from '@hip/protocol'
import {
  appendAssistantDelta,
  appendRunOutput,
  coerceRunningToolCalls,
  ensureAssistantMessage,
  finalizeAssistant,
  finalizeCancelledMessage,
  lastNonNotice,
  makeRunningToolCall,
  mapMessages,
  patchFinishedToolCall,
  setRunFinished,
  upsertReasoning,
  upsertRun,
  upsertTimelineText,
} from '../messageUtils'
import { DEFAULT_CONFIG, emptySession } from '../constants'
import type { PluginInstallState, SessionVM } from '../types'

function summaryToVM(s: SessionSummary): SessionVM {
  const cwd = typeof s.cwd === 'string' && s.cwd.trim() ? s.cwd.trim() : undefined
  return {
    id: s.id,
    config: {
      ...DEFAULT_CONFIG,
      surface: s.surface,
      ...(s.managedTerminalId ? { managedTerminalId: s.managedTerminalId } : {}),
      ...(s.hostId ? { hostId: s.hostId } : {}),
      ...(s.remotePathHint ? { remotePathHint: s.remotePathHint } : {}),
      ...(cwd ? { cwd } : {}),
    },
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
          const nextConfig = {
            ...prev.config,
            surface: vm.config.surface ?? prev.config.surface,
            managedTerminalId:
              vm.config.managedTerminalId ?? prev.config.managedTerminalId,
            hostId: vm.config.hostId ?? prev.config.hostId,
            remotePathHint: vm.config.remotePathHint ?? prev.config.remotePathHint,
          }
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
