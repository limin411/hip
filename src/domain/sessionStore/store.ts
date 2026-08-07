// src/domain/sessionStore/store.ts
import { create } from 'zustand'
import type { PlanItem, SearchHit, ServerMessage, SessionConfig } from '@hip/protocol'
import type { LocalAttachment } from '@/components/chat/attachmentTypes'
import type { PluginInstallState, SessionVM } from './types'
import { clearPermission, emptySession } from './constants'
import { popForRegenerate } from './messageUtils'
import { applyServerMessage } from './reducers'

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
  /** Create a session. `activate` defaults true (sets activeSessionId); false leaves prior active unchanged. */
  createSession: (id: string, config: SessionConfig, opts?: { activate?: boolean }) => string
  selectSession: (id: string) => void
  deselect: () => void
  deleteSession: (id: string) => void
  renameSession: (id: string, title: string) => void
  appendUserMessage: (sessionId: string, id: string, content: string, attachments?: LocalAttachment[]) => void
  appendMessage: (sessionId: string, message: { id: string; role: 'user' | 'assistant'; content: string; timestamp: number }) => void
  /** Drop messages collapsed into a compaction summary (keeps meters honest). */
  removeSessionMessages: (sessionId: string, ids: string[]) => void
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

  createSession: (id, config, opts) => {
    const activate = opts?.activate !== false
    set((s) => ({
      sessions: [{ ...emptySession(id), config }, ...s.sessions],
      ...(activate ? { activeSessionId: id } : {}),
    }))
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

  removeSessionMessages: (sessionId, ids) =>
    set((s) => {
      const remove = new Set(ids)
      return {
        sessions: s.sessions.map((sess) =>
          sess.id === sessionId
            ? { ...sess, messages: sess.messages.filter((m) => !remove.has(m.id)) }
            : sess,
        ),
      }
    }),

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
