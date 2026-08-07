// src/domain/sessionStore/reducers/session.ts
// session:* field projections (18 cases). `session:loaded` also resets the full
// per-session transient state (flow/plan fields) — declared here by design:
// each message belongs to exactly one reducer; cross-domain field writes are
// done by the owning reducer with a comment.
import type { ServerMessage, SessionSummary } from '@hip/protocol'
import { DEFAULT_CONFIG, emptySession } from '../constants'
import { lastNonNotice } from '../messageUtils'
import type { SessionVM } from '../types'
import { updateSession, type SessionState } from './helpers'

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

export function sessionReducer(state: SessionState, msg: ServerMessage, _now: number): SessionState {
  switch (msg.type) {
    case 'session:created':
      if (state.sessions.some((s) => s.id === msg.sessionId)) return state
      return { sessions: [...state.sessions, emptySession(msg.sessionId)] }

    case 'session:thinking':
      return updateSession(state, msg.sessionId, (s) => ({ ...s, config: { ...s.config, thinking: msg.thinking } }))

    case 'session:effort':
      return updateSession(state, msg.sessionId, (s) => ({
        ...s,
        config: {
          ...s.config,
          effort: msg.effort ?? undefined,
        },
      }))

    case 'session:permissionMode':
      return updateSession(state, msg.sessionId, (s) => {
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
      return updateSession(state, msg.sessionId, (s) => {
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
      return updateSession(state, msg.sessionId, (s) => {
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
      return updateSession(state, msg.sessionId, (s) => ({
        ...s,
        config: {
          ...s.config,
          executionMode: msg.executionMode,
          forcePlan: msg.executionMode === 'plan',
          ...(msg.executionMode === 'plan' ? { disablePlan: false } : {}),
        },
      }))

    case 'session:systemPrompt':
      return updateSession(state, msg.sessionId, (s) => ({ ...s, config: { ...s.config, systemPrompt: msg.systemPrompt || undefined } }))

    case 'session:model':
      return updateSession(state, msg.sessionId, (s) => ({ ...s, config: { ...s.config, llmProvider: msg.llmProvider, model: msg.model } }))

    case 'session:orchMode':
      return updateSession(state, msg.sessionId, (s) => ({ ...s, config: { ...s.config, orchMode: msg.orchMode } }))

    case 'session:memoryFlags':
      return updateSession(state, msg.sessionId, (s) => ({
        ...s,
        config: {
          ...s.config,
          ...(msg.useMemories !== undefined ? { useMemories: msg.useMemories } : {}),
          ...(msg.generateMemories !== undefined ? { generateMemories: msg.generateMemories } : {}),
          ...(msg.incognito !== undefined ? { incognito: msg.incognito } : {}),
        },
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
      return updateSession(state, msg.sessionId, (s) => {
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
      return updateSession(state, msg.sessionId, (s) => ({ ...s, title: msg.title }))

    case 'session:cwd':
      return updateSession(state, msg.sessionId, (s) => {
        const config = { ...s.config }
        if (!msg.cwd?.trim()) {
          delete config.cwd
        } else {
          config.cwd = msg.cwd
        }
        return { ...s, config }
      })

    default:
      return state
  }
}
