// src/domain/sessionStore/constants.ts
import { normalizeSessionConfig } from '@hip/protocol'
import type { SessionConfig } from '@hip/protocol'
import type { SessionVM } from './types'

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

