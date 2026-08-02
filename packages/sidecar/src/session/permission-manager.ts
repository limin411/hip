import type { ServerMessage, PermissionMode, PermissionOption } from '@hip/protocol'
import type { ApprovalFn, ApprovalDecision } from './tools.js'
import type { ApprovalCache } from './tool-runner/approval-cache.js'
import type { HookRegistry } from './hooks/registry.js'
import { logInfo } from '../debug-logger.js'

type SendFn = (msg: ServerMessage) => void

export interface PermissionManagerOptions {
  /** When true, buildHitlApproval() adds allow_always/reject_always options.
   *  Sticky decisions are recorded by ToolRunner; PermissionManager only
   *  resolves the user's choice. Default false. */
  enableStickyApproval?: boolean
  /**
   * When true, HITL is auto-resolved with allow_once (Autopilot).
   * Under product invariant Autopilot requires full, so buildRequestApproval
   * already short-circuits full; this covers edit-path HITL if invariant slips.
   */
  isAutopilot?: () => boolean
}

export class PermissionManager {
  /** Pending HITL permission requests from the external agent, keyed by requestId. */
  readonly pendingPermissions = new Map<string, (c: { optionId: string } | { cancelled: true }) => void>()

  /** Session-level approval cache (shared with ToolRunner). Set via setApprovalCache. */
  private approvalCache?: ApprovalCache

  private readonly enableStickyApproval: boolean
  private readonly isAutopilot: () => boolean

  constructor(
    private readonly getPermissionMode: () => PermissionMode,
    private readonly setPermissionModeFn: (mode: PermissionMode) => boolean,
    opts: PermissionManagerOptions = {},
  ) {
    this.enableStickyApproval = opts.enableStickyApproval ?? false
    this.isAutopilot = opts.isAutopilot ?? (() => false)
  }

  /** Set the per-conversation permission mode. Clears sticky approval cache when the mode value actually changes. */
  setPermissionMode(permissionMode: PermissionMode): boolean {
    const oldMode = this.getPermissionMode()
    const accepted = this.setPermissionModeFn(permissionMode)
    if (accepted && oldMode !== permissionMode) {
      this.clearApprovedGrants()
    }
    return accepted
  }

  /** Complete a pending external-agent permission request with the user's choice. */
  respondPermission(requestId: string, choice: { optionId: string } | { cancelled: true }): void {
    const resolve = this.pendingPermissions.get(requestId)
    if (resolve) { this.pendingPermissions.delete(requestId); resolve(choice) }
  }

  /** Clear sticky 'approve' grants (called on new session). */
  clearApprovedGrants(): void {
    this.approvalCache?.clear()
  }

  /** Share the session-level ApprovalCache so ToolRunner and PermissionManager converge. */
  setApprovalCache(cache: ApprovalCache): void {
    this.approvalCache = cache
  }

  /** Record a tool as approved after 'approve' mode HITL (legacy broad scope). */
  recordApproved(toolName: string): void {
    this.approvalCache?.set(toolName, undefined, { kind: 'allow_always' })
  }

  /** Check if a tool has been previously approved in this session. */
  isApproved(toolName: string): boolean {
    return this.approvalCache?.lookup(toolName, undefined) === 'allow'
  }

  /** Settle all pending HITL requests (on turn end / abort). */
  cancelAll(): void {
    if (this.pendingPermissions.size) {
      for (const resolve of this.pendingPermissions.values()) resolve({ cancelled: true })
      this.pendingPermissions.clear()
    }
  }

  /** Build the HITL closure for run_script (and dispatched agents). Registers a pending permission
   *  and resolves on the user's permission:respond.
   *
   *  When `hooks` is provided, the PermissionRequest hook fires before the prompt.
   *  - allow → resolve allow_once immediately (no prompt)
   *  - deny  → resolve reject_once immediately (no prompt)
   *  - ask or no hooks → normal HITL flow */
  buildHitlApproval(
    send: SendFn,
    sessionId: string,
    turnId: string,
    nextSeqFn: () => number,
    hooks?: HookRegistry,
  ): ApprovalFn {
    const options: PermissionOption[] = [
      { optionId: 'allow_once', name: '允许', kind: 'allow_once' },
      { optionId: 'reject_once', name: '拒绝', kind: 'reject_once' },
    ]
    if (this.enableStickyApproval) {
      options.push(
        { optionId: 'allow_always', name: '始终允许', kind: 'allow_always' },
        { optionId: 'reject_always', name: '始终拒绝', kind: 'reject_always' },
      )
    }
    return (req) => {
      if (this.isAutopilot()) {
        logInfo('session', 'executionMode:auto_approve', {
          sessionId,
          kind: 'tool_permission',
          tool: req.toolName ?? req.title,
          toolKind: req.kind,
        })
        return Promise.resolve({ kind: 'allow_once' as const })
      }
      const toolName = req.toolName ?? req.title
      const resolveFromHook = async (): Promise<ApprovalDecision | null> => {
        if (!hooks || !hooks.hasMatchingHook('PermissionRequest', toolName)) return null
        const hookResult = await hooks.fire('PermissionRequest', {
          sessionId,
          turnId,
          toolName,
          toolInput: { kind: req.kind, content: req.content },
        })
        if (hookResult.kind === 'allow') return { kind: 'allow_once' }
        if (hookResult.kind === 'deny') return { kind: 'reject_once' }
        // 'ask' or other non-terminal: proceed with HITL
        return null
      }
      return new Promise((resolve) => {
        void resolveFromHook().then((hookDecision) => {
          if (hookDecision !== null) { resolve(hookDecision); return }
          const requestId = `run-script-${turnId}-${nextSeqFn()}`
          this.pendingPermissions.set(requestId, (choice) => {
            if ('cancelled' in choice) { resolve({ cancelled: true }); return }
            const kind = options.find((o) => o.optionId === choice.optionId)?.kind ?? 'reject_once'
            resolve({ kind })
          })
          send({
            type: 'permission:request',
            sessionId,
            turnId,
            requestId,
            tool: { title: req.title, kind: req.kind, content: req.content },
            options,
          })
        }).catch((err) => {
          // Hook errors (including re-entrancy) must fail closed rather than leaving the
          // approval promise hanging forever.
          console.warn('PermissionRequest hook failed:', err instanceof Error ? err.message : String(err))
          resolve({ kind: 'reject_once' })
        })
      })
    }
  }

  /** Build the per-mode run_script gate: chat ⇒ undefined (no run_script); edit ⇒ HITL; full ⇒ auto-approve.
   *  When `hooks` is provided and mode is 'edit', fires PermissionRequest hook before the prompt. */
  buildRequestApproval(
    send: SendFn,
    sessionId: string,
    turnId: string,
    nextSeqFn: () => number,
    mode: PermissionMode,
    hooks?: HookRegistry,
  ): ApprovalFn | undefined {
    if (mode === 'chat') return undefined
    if (mode === 'full') return () => Promise.resolve({ kind: 'allow_once' })
    return this.buildHitlApproval(send, sessionId, turnId, nextSeqFn, hooks)
  }

  /**
   * Generic HITL with arbitrary options; resolves the raw optionId (or cancelled).
   * Used by tools that need multi-way choices (e.g. plan-mode actions).
   */
  requestChoice(
    send: SendFn,
    sessionId: string,
    turnId: string,
    nextSeqFn: () => number,
    tool: { title: string; kind: string; content?: string },
    options: PermissionOption[],
  ): Promise<{ optionId: string } | { cancelled: true }> {
    if (options.length === 0) {
      return Promise.resolve({ cancelled: true })
    }
    return new Promise((resolve) => {
      const requestId = `choice-${turnId || 't'}-${nextSeqFn()}`
      this.pendingPermissions.set(requestId, (choice) => {
        if ('cancelled' in choice) {
          resolve({ cancelled: true })
          return
        }
        resolve({ optionId: choice.optionId })
      })
      send({
        type: 'permission:request',
        sessionId,
        turnId,
        requestId,
        tool: { title: tool.title, kind: tool.kind, ...(tool.content ? { content: tool.content } : {}) },
        options,
      })
    })
  }

}

