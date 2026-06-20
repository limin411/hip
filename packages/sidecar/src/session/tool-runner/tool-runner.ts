import type { StructuredToolInterface } from '@langchain/core/tools'
import type { PermissionMode } from '@hip/protocol'
import type { HookRegistry } from '../hooks/registry.js'
import type { HookResult } from '@hip/protocol'
import type { ApprovalFn, ApprovalDecision } from '../tools.js'
import type { ApprovalCache } from './approval-cache.js'
import type { ToolPolicy } from './tool-policy.js'

// ── Helpers ──────────────────────────────────────────────────────────────────

/** True when the decision semantically permits execution (kind starts with "allow"). */
function isApproved(d: ApprovalDecision): boolean {
  return 'kind' in d && d.kind.startsWith('allow')
}

// ── Public types ─────────────────────────────────────────────────────────────

/** Dependencies injected into ToolRunner. */
export interface ToolRunnerDeps {
  /** Tool registry keyed by tool name. */
  tools: Map<string, StructuredToolInterface>
  /** Optional hook registry for PreToolUse/PostToolUse/PostToolUseFailure. */
  hooks?: HookRegistry
  /** Classifies tool risk and base approval kind. */
  toolPolicy: ToolPolicy
  /** Per-session HITL decision cache. */
  approvalCache: ApprovalCache
  /** Tools whose approval is handled internally (e.g. run_script). */
  selfGatedTools: Set<string>
  /** Active permission mode. */
  permissionMode: PermissionMode
  /** Approval transport for runner-level prompts (undefined ⇒ ask is denied). */
  requestApproval?: ApprovalFn
  /** Session identifier passed to hook contexts. */
  sessionId: string
  /** Optional emit for tool lifecycle events (mirrors GraphEmit subset). */
  onToolStarted?: (name: string, callId: string, input: unknown) => void
  onToolFinished?: (callId: string, status: 'finished' | 'error', output?: string, error?: string) => void
  /** Optional emit for guardian risk classification (emitted for medium/high risk tools). */
  emitRisk?: (toolName: string, risk: string, approval: string) => void
}

/** Result of a tool execution, feeds exactly one ToolMessage via `content` + metadata. */
export interface ToolCallResult {
  content: string
  tool_call_id: string
  name: string
}

// ── ToolRunner ───────────────────────────────────────────────────────────────

/**
 * Executes a single tool call through a pipeline of:
 *   resolve → classify → PreToolUse hooks → approval gate → invoke → PostToolUse hooks.
 *
 * The `ask` hook result triggers a runner-level approval prompt (cache-aware).
 * Self-gated tools (e.g. run_script) skip runner approval — their embedded
 * ApprovalFn handles it internally.
 */
export class ToolRunner {
  constructor(private readonly deps: ToolRunnerDeps) {}

  async runToolCall(call: {
    name: string
    callId: string
    args: Record<string, unknown>
  }): Promise<ToolCallResult> {
    const {
      tools,
      hooks,
      toolPolicy,
      approvalCache,
      permissionMode,
      requestApproval,
      sessionId,
    } = this.deps

    // ── 1. Resolve tool by name ────────────────────────────────────────────
    const tool = tools.get(call.name)
    if (!tool) {
      return this.errorResult(call, `unknown tool: ${call.name}`)
    }

    // ── 2. Classify via ToolPolicy ─────────────────────────────────────────
    const classification = toolPolicy.classify(call.name, permissionMode)
    if (classification.risk === 'medium' || classification.risk === 'high') {
      this.deps.emitRisk?.(call.name, classification.risk, classification.approval)
    }

    // ── 3. PreToolUse hooks ────────────────────────────────────────────────
    let invokeArgs = call.args

    if (hooks) {
      let preResult: HookResult
      try {
        preResult = await hooks.fire('PreToolUse', {
          sessionId,
          toolName: call.name,
          toolInput: call.args,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return this.errorResult(call, `PreToolUse hook error: ${msg}`)
      }

      if (preResult.kind === 'deny') {
        const reason = preResult.reason ? `: ${preResult.reason}` : ''
        return this.errorResult(call, `tool execution denied by hook${reason}`)
      }

      if (preResult.kind === 'ask') {
        // Self-gated tools skip runner approval — the tool's own ApprovalFn
        // handles it, and we must not double-prompt.
        if (classification.approval === 'self') {
          // Pass through to tool invocation.
        } else if (classification.approval === 'auto_allow') {
          // Auto-allow — pass through.
        } else if (!requestApproval) {
          // F1: ask with no approval transport → deny.
          return this.errorResult(call, 'approval required but no approval transport available')
        } else {
          // Runner approval flow (cache-aware).
          const cached = approvalCache.lookup(call.name, call.args)
          if (cached === 'reject') {
            return this.errorResult(call, 'tool execution rejected (cached)')
          }

          if (cached !== 'allow') {
            let decision: ApprovalDecision
            try {
              decision = await requestApproval({
                title: `Run ${call.name}`,
                kind: 'execute',
                content: preResult.reason ?? undefined,
              })
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err)
              approvalCache.set(call.name, call.args, { kind: 'reject_always' })
              return this.errorResult(call, `approval transport failed: ${msg}`)
            }
            approvalCache.set(call.name, call.args, decision)

            if (!isApproved(decision)) {
              return this.errorResult(call, 'tool execution rejected by user')
            }
          }
        }
      }

      // Apply updatedInput from the hook (whether allow or ask-resolved-to-allow).
      if (preResult.updatedInput && typeof preResult.updatedInput === 'object' && !Array.isArray(preResult.updatedInput)) {
        invokeArgs = preResult.updatedInput as Record<string, unknown>
      }
    }

    // ── 4. Invoke tool ─────────────────────────────────────────────────────
    this.emitStarted(call.name, call.callId, invokeArgs)
    try {
      const result = String(await tool.invoke(invokeArgs))
      this.emitFinished(call.callId, 'finished', result)

      // ── 5. PostToolUse hooks ─────────────────────────────────────────────
      let finalContent = result
      if (hooks) {
      let postResult: HookResult
      try {
        postResult = await hooks.fire('PostToolUse', {
          sessionId,
          toolName: call.name,
          toolInput: call.args,
          toolOutput: result,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`PostToolUse hook error for ${call.name}: ${msg}`)
        postResult = { kind: 'allow' }
      }
      if (postResult.updatedInput) {
        const ui = postResult.updatedInput
        if (ui !== null && typeof ui === 'object' && 'output' in ui) {
          const out = ui.output
          if (typeof out === 'string') {
            finalContent = out
          } else if (out !== undefined && out !== null) {
            finalContent = JSON.stringify(out)
          }
        } else if (typeof ui === 'string') {
          finalContent = ui
        }
        // Otherwise keep original result to avoid '[object Object]'.
      }
      }

      return {
        content: finalContent,
        tool_call_id: call.callId,
        name: call.name,
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      this.emitFinished(call.callId, 'error', undefined, error)

      if (hooks) {
        try {
          await hooks.fire('PostToolUseFailure', {
            sessionId,
            toolName: call.name,
            toolInput: call.args,
            toolError: error,
          })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          console.warn(`PostToolUseFailure hook error for ${call.name}: ${msg}`)
        }
      }

      return {
        content: `Error: ${error}`,
        tool_call_id: call.callId,
        name: call.name,
      }
    }
  }

  private emitStarted(name: string, callId: string, input: unknown): void {
    this.deps.onToolStarted?.(name, callId, input)
  }

  private emitFinished(
    callId: string,
    status: 'finished' | 'error',
    output?: string,
    error?: string,
  ): void {
    this.deps.onToolFinished?.(callId, status, output, error)
  }

  private errorResult(call: { name: string; callId: string }, reason: string): ToolCallResult {
    this.emitError(call.callId, call.name, reason)
    return {
      content: `Error: ${reason}`,
      tool_call_id: call.callId,
      name: call.name,
    }
  }

  private emitError(
    callId: string,
    name: string,
    error: string,
  ): void {
    this.deps.onToolStarted?.(name, callId, undefined)
    this.deps.onToolFinished?.(callId, 'error', undefined, error)
  }
}