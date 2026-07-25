/** Core session configuration and permission types. */
export type AgentRole = 'supervisor' | 'planner' | 'coder' | 'reviewer' | 'worker' | 'subagent'

/**
 * Per-conversation permission mode (Claude-Desktop style), gating hip's own
 * file/exec tools and sandbox scope at runtime.
 *  - 'chat': read-only (read_file/ls/glob/grep + use_skill + MCP); NO write/edit/run_script; reads jailed to cwd.
 *  - 'edit': DEFAULT — write/edit inside cwd (no HITL), run_script HITL-gated; jailed to cwd.
 *  - 'full': write/edit/read any directory (un-jailed); run_script auto-approved. MCP available in all modes.
 * undefined on an existing SessionConfig ⇒ readers treat it as 'edit' (back-compat, no migration).
 */
export type PermissionMode = 'chat' | 'edit' | 'full'

/** One item in a plan produced by the planning node. */
export interface PlanItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

export interface SessionConfig {
  llmProvider: string          // provider id (was the 'deepseek' literal)
  model: string
  baseURL?: string             // resolved OpenAI-compatible base URL for the provider
  tools: string[]
  systemPrompt?: string
  cwd?: string                 // absolute project root; undefined → virtual FS (no real file tools)
  thinking?: boolean           // DEPRECATED: retained for back-compat; no longer swaps models
  /**
   * Reasoning effort / thinking intensity for models that advertise effort levels
   * in the models.dev catalog (`reasoning_options` type `effort`). Values are
   * model-specific (e.g. none|minimal|low|medium|high|xhigh|max). undefined ⇒ provider default.
   */
  effort?: string
  language?: 'en' | 'zh-CN' | 'zh-TW' | 'ja' | 'ko'
  /**
   * Session primary runtime.
   * undefined | 'builtin' → hip Supervisor graph.
   * else → AgentConfig.id (kind acp|opencode) as session primary.
   * Mutate after create only via session:setAgent (running → BUSY).
   */
  agentId?: string
  permissionMode?: PermissionMode  // per-conversation gate; undefined ⇒ treated as 'edit'
  /** When true, HITL approval prompts include "always allow/always reject" sticky options.
   *  Defaults to true for new sessions; undefined ⇒ treated as true. */
  enableStickyApproval?: boolean
  /**
   * Collaboration mode: interactive | plan | autopilot.
   * Autopilot requires permissionMode === 'full'. Prefer this over forcePlan for new clients.
   * undefined ⇒ derive via resolveExecutionMode (forcePlan legacy).
   */
  executionMode?: import('./execution-mode.js').ExecutionMode
  /** When true, always run the plan/execute/verify loop for this session. Dual-written with executionMode=plan. */
  forcePlan?: boolean
  /** When true, never run the plan/execute/verify loop (always fast path). Overrides forcePlan. */
  disablePlan?: boolean
  /** Which top-level surface owns this conversation. 'chat' = sandboxed conversation-only;
   *  'code' = conversation + directory tree + git. undefined on a legacy row ⇒ inferred from
   *  the cwd (a scratch cwd ⇒ 'chat', else 'code'); see surfaceOf in the sidecar. */
  surface?: 'chat' | 'code'
  /**
   * Product workspace mode (smoothness spec §3.1). Prefer this over `surface` when present.
   * 'sandbox' ⇔ chat surface; 'project' ⇔ code surface. undefined ⇒ derive from surface/cwd.
   */
  workspaceMode?: 'sandbox' | 'project'
  /** When true (default), Session rebuilds its message history from the event-sourced
   *  session_message projection instead of relying on LangGraph checkpointing or the legacy
   *  messages table. Set to false to opt out during the dual-write transition. */
  useEventSource?: boolean
  /**
   * @deprecated Product path ignores this for turn routing (agent-driven orchestration).
   * Kept for old session JSON / WS compatibility only.
   */
  orchMode?: 'fast' | 'dag'
  /** undefined ⇒ inherit global memory.json useMemories */
  useMemories?: boolean
  /** undefined ⇒ inherit global memory.json generateMemories */
  generateMemories?: boolean
  /** When true, skip memory inject/extract for this session. */
  incognito?: boolean
}

