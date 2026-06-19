import type { ServerMessage, PermissionMode, PermissionOption, ToolPermissionConfig } from '@hip/protocol'
import type { ApprovalFn, ApprovalDecision } from './tools.js'

type SendFn = (msg: ServerMessage) => void

export class PermissionManager {
  /** Pending HITL permission requests from the external agent, keyed by requestId. */
  readonly pendingPermissions = new Map<string, (c: { optionId: string } | { cancelled: true }) => void>()

  /** Per-session sticky 'approve' grants: toolName → true once user approves via 'approve' mode. */
  private readonly approvedGrants = new Set<string>()

  constructor(
    private readonly getPermissionMode: () => PermissionMode,
    private readonly setPermissionModeFn: (mode: PermissionMode) => boolean,
  ) {}

  /** Set the per-conversation permission mode. */
  setPermissionMode(permissionMode: PermissionMode): boolean {
    return this.setPermissionModeFn(permissionMode)
  }

  /** Complete a pending external-agent permission request with the user's choice. */
  respondPermission(requestId: string, choice: { optionId: string } | { cancelled: true }): void {
    const resolve = this.pendingPermissions.get(requestId)
    if (resolve) { this.pendingPermissions.delete(requestId); resolve(choice) }
  }

  /** Clear sticky 'approve' grants (called on new session). */
  clearApprovedGrants(): void {
    this.approvedGrants.clear()
  }

  /** Record a tool as approved after 'approve' mode HITL. */
  recordApproved(toolName: string): void {
    this.approvedGrants.add(toolName)
  }

  /** Check if a tool has been previously approved in this session. */
  isApproved(toolName: string): boolean {
    return this.approvedGrants.has(toolName)
  }

  /** Settle all pending HITL requests (on turn end / abort). */
  cancelAll(): void {
    if (this.pendingPermissions.size) {
      for (const resolve of this.pendingPermissions.values()) resolve({ cancelled: true })
      this.pendingPermissions.clear()
    }
  }

  /** Build the HITL closure for run_script (and dispatched agents). Registers a pending permission
   *  and resolves on the user's permission:respond. */
  buildHitlApproval(
    send: SendFn,
    sessionId: string,
    turnId: string,
    nextSeqFn: () => number,
  ): ApprovalFn {
    const options: PermissionOption[] = [
      { optionId: 'allow_once', name: '允许', kind: 'allow_once' },
      { optionId: 'reject_once', name: '拒绝', kind: 'reject_once' },
    ]
    return (req) =>
      new Promise((resolve) => {
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
      })
  }

  /** Build the per-mode run_script gate: chat ⇒ undefined (no run_script); edit ⇒ HITL; full ⇒ auto-approve. */
  buildRequestApproval(
    send: SendFn,
    sessionId: string,
    turnId: string,
    nextSeqFn: () => number,
    mode: PermissionMode,
  ): ApprovalFn | undefined {
    if (mode === 'chat') return undefined
    if (mode === 'full') return () => Promise.resolve({ kind: 'allow_once' })
    return this.buildHitlApproval(send, sessionId, turnId, nextSeqFn)
  }

  /** Resolve effective permission mode for a tool given ToolPermissionConfig and the coarse mode.
   *  Coarse mode always wins over per-tool auto (safety). */
  resolveToolMode(
    toolName: string,
    coarseMode: PermissionMode,
    toolPermissions?: ToolPermissionConfig,
  ): 'auto' | 'prompt' | 'approve' | 'deny' | 'coarse' {
    if (!toolPermissions) return 'coarse'

    // Check overrides first
    const override = toolPermissions.overrides?.[toolName]
    if (override === 'auto') {
      // Coarse mode safety: chat mode blocks write/edit/run_script regardless
      if (coarseMode === 'chat' && (toolName === 'write_file' || toolName === 'edit_file' || toolName === 'run_script')) {
        return 'deny'
      }
      return 'auto'
    }
    if (override === 'deny') return 'deny'
    if (override === 'prompt') return 'prompt'
    if (override === 'approve') {
      if (this.isApproved(toolName)) return 'auto' // sticky grant
      return 'approve'
    }

    // Check defaultMode
    const def = toolPermissions.defaultMode
    if (def === 'auto') {
      if (coarseMode === 'chat' && (toolName === 'write_file' || toolName === 'edit_file' || toolName === 'run_script')) {
        return 'deny'
      }
      return 'auto'
    }
    if (def === 'deny') return 'deny'
    if (def === 'prompt') return 'prompt'
    if (def === 'approve') {
      if (this.isApproved(toolName)) return 'auto'
      return 'approve'
    }

    return 'coarse'
  }
}
