// src/domain/sessionStore/reducers/plan.ts
// plan:* + permission:* — they share planApprovalPending / pendingPermission
// HITL state, so they stay in one reducer. agent:interrupt (flow.ts) writes
// planApprovalPending and error (flow.ts) clears plan fields — declared at the
// flow.ts call sites by design (single-owner per message).
import type { ServerMessage } from '@hip/protocol'
import { updateSession, type SessionState } from './helpers'

export function planReducer(state: SessionState, msg: ServerMessage, _now: number): SessionState {
  switch (msg.type) {
    case 'plan:delta':
      return updateSession(state, msg.sessionId, (s) => ({
        ...s,
        planDeltaDraft: { ...s.planDeltaDraft, [msg.itemId]: (s.planDeltaDraft?.[msg.itemId] ?? '') + msg.delta },
      }))

    case 'plan:updated':
      // Keep prior markdown (D2.5) — plan:updated only refreshes checklist items.
      return updateSession(state, msg.sessionId, (s) => ({ ...s, activeTurnPlan: msg.plan, planDeltaDraft: {} }))

    case 'plan:published': {
      // Set markdown fields if body present; clear all (incl. path) if omitted — D2.5.
      const hasMarkdown = Boolean(msg.markdown?.trim())
      return updateSession(state, msg.sessionId, (s) => ({
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
      return updateSession(state, msg.sessionId, (s) => {
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

    case 'permission:request':
      return updateSession(state, msg.sessionId, (s) => ({
        ...s,
        pendingPermission: { turnId: msg.turnId, requestId: msg.requestId, tool: msg.tool, options: msg.options, ...(msg.agentFrame ? { agentFrame: msg.agentFrame } : {}) },
      }))

    case 'permission:resolved':
      return updateSession(state, msg.sessionId, (s) => {
        if (!s.pendingPermission || s.pendingPermission.requestId !== msg.requestId) return s
        return { ...s, pendingPermission: null }
      })

    default:
      return state
  }
}
