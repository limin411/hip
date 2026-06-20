import type { StructuredToolInterface } from '@langchain/core/tools'
import type { PermissionMode } from '@hip/protocol'
import type { HookRegistry } from '../hooks/registry.js'
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
      selfGatedTools,
      permissionMode,
      requestApproval,
      sessionId,
    } = this.deps

    // ── 1. Resolve tool by name ────────────────────────────────────────────
    const tool = tools.get(call.name)
    if (!tool) {
      this.emitError(call.callId, call.name, `unknown tool: ${call.name}`)
      return {
        content: `Error: unknown tool ${call.name}`,
        tool_call_id: call.callId,
        name: call.name,
      }
    }

    // ── 2. Classify via ToolPolicy ─────────────────────────────────────────
    const classification = toolPolicy.classify(call.name, permissionMode)
    this.deps.emitRisk?.(call.name, classification.risk, classification.approval)

    // ── 3. PreToolUse hooks ────────────────────────────────────────────────
    let invokeArgs = call.args

    if (hooks) {
      const preResult = await hooks.fire('PreToolUse', {
        sessionId,
        toolName: call.name,
        toolInput: call.args,
      })

      if (preResult.kind === 'deny') {
        const reason = preResult.reason ? `: ${preResult.reason}` : ''
        this.emitError(call.callId, call.name, `denied by hook${reason}`)
        return {
          content: `Error: tool execution denied by hook${reason}`,
          tool_call_id: call.callId,
          name: call.name,
        }
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
          this.emitError(call.callId, call.name, 'approval required but no approval transport available')
          return {
            content: 'Error: approval required but no approval transport available',
            tool_call_id: call.callId,
            name: call.name,
          }
        } else {
          // Runner approval flow (cache-aware).
          const cached = approvalCache.lookup(call.name, call.args)
          if (cached === 'reject') {
            this.emitError(call.callId, call.name, 'rejected (cached)')
            return {
              content: 'Error: tool execution rejected (cached)',
              tool_call_id: call.callId,
              name: call.name,
            }
          }

          if (cached !== 'allow') {
            const decision = await requestApproval({
              title: `Run ${call.name}`,
              kind: 'execute',
              content: preResult.reason ?? undefined,
            })
            approvalCache.set(call.name, call.args, decision)

            if (!isApproved(decision)) {
              this.emitError(call.callId, call.name, 'rejected by user')
              return {
                content: 'Error: tool execution rejected by user',
                tool_call_id: call.callId,
                name: call.name,
              }
            }
          }
        }
      }

      // Apply updatedInput from the hook (whether allow or ask-resolved-to-allow).
      if (preResult.updatedInput) {
        invokeArgs = preResult.updatedInput
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
        const postResult = await hooks.fire('PostToolUse', {
          sessionId,
          toolName: call.name,
          toolInput: call.args,
          toolOutput: result,
        })
        if (postResult.updatedInput) {
          finalContent = String(
            postResult.updatedInput.output ?? postResult.updatedInput,
          )
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
        await hooks.fire('PostToolUseFailure', {
          sessionId,
          toolName: call.name,
          toolInput: call.args,
          toolError: error,
        })
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

  private emitError(
    callId: string,
    name: string,
    error: string,
  ): void {
    this.deps.onToolStarted?.(name, callId, undefined)
    this.deps.onToolFinished?.(callId, 'error', undefined, error)
  }
}
