/** Lifecycle hooks (tool interception, safety gating, turn lifecycle). */
// ──────────────────────────────────────────────────────────────────
// Lifecycle hooks (tool interception, safety gating, turn lifecycle)
// ──────────────────────────────────────────────────────────────────

export type HookEvent = 'SessionStart' | 'TurnStart' | 'UserPromptSubmit' | 'PreToolUse' | 'PostToolUse' | 'PostToolUseFailure' | 'TurnComplete' | 'Stop' | 'PermissionRequest' | 'ActivityStart' | 'ActivityEnd' | 'ActivityBudgetRequest'

export type HookResult = {
  kind: 'allow' | 'deny' | 'ask' | 'modify' | 'continue'
  reason?: string
  /**
   * Modified tool input. This is the canonical field for hooks with `kind: 'modify'`.
   * When present, the runner invokes the tool with these arguments instead of the
   * original input.
   */
  modifiedInput?: Record<string, unknown>
  /**
   * Legacy alias for `modifiedInput`. Kept for backward compatibility with existing
   * hooks; prefer `modifiedInput` for new code. If both are present, `modifiedInput`
   * takes precedence.
   */
  updatedInput?: Record<string, unknown>
  prompt?: string
  additionalContexts?: string[]
  /**
   * For `ActivityBudgetRequest` hooks, the number of steps the hook is willing
   * to grant. When omitted, the requested amount is granted.
   */
  steps?: number
}

export type HookMatcher = string | string[]

export interface HookContext {
  sessionId: string
  turnId?: string
  activityId?: string
  stepsRequested?: number
  toolName?: string
  toolInput?: Record<string, unknown>
  toolOutput?: string
  toolError?: string
}

export interface Hook {
  event: HookEvent
  matcher?: HookMatcher
  handler: (ctx: HookContext) => Promise<HookResult>
}
