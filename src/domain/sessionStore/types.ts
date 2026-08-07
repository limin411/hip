// src/domain/sessionStore/types.ts
import type {
  AcpConfigOption,
  AgentFrame,
  AgentProfileInfo,
  Message,
  PermissionOption,
  PermissionRequestPayload,
  PlanItem,
  SessionConfig,
} from '@hip/protocol'

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
