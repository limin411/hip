import { SystemMessage, HumanMessage, AIMessage, type BaseMessage } from '@langchain/core/messages'
import type { PermissionMode } from '@hip/protocol'
import type { ModelRunner } from './model-runner.js'
import type { Summarizer } from './compaction.js'
import { buildGraph, type GraphEmit, type GraphCtx } from './graph.js'
import { buildTools, type ApprovalFn } from './tools.js'
import { recursionLimit } from './loop-control.js'
import { childSystemPrompt } from './system-prompt.js'

export interface RunSubagentArgs {
  runner: ModelRunner
  root: string
  summarizer: Summarizer
  emit: GraphEmit
  signal: AbortSignal
  description: string
  childMaxSteps: number
  /** Execution mode: 'foreground' blocks the caller until the subagent completes;
   *  'background' returns immediately and runs detached. Default 'foreground'. */
  mode?: 'foreground' | 'background'
  /** Conversation permission mode, cascaded from the parent turn (undefined ⇒ 'edit'). Drives the
   *  child toolset (chat = read-only, full = un-jailed) and the child cwd-block wording. */
  permissionMode?: PermissionMode
  /** HITL approval seam cascaded from the parent: chat ⇒ undefined (no run_script for the worker),
   *  edit ⇒ real HITL, full ⇒ auto-approve. Mirrors the dispatch_agent cascade. */
  requestApproval?: ApprovalFn
}

/** Last assistant message's text content (string content, or joined text blocks). */
export function lastAiText(messages: BaseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!(m instanceof AIMessage)) continue
    if (typeof m.content === 'string') return m.content
    return m.content
      .filter((b): b is { type: 'text'; text: string } => (b as { type?: string }).type === 'text')
      .map((b) => b.text)
      .join('')
  }
  return ''
}

/**
 * Run a depth-1 sub-agent to completion and return its final assistant text.
 *
 * - Child toolset = buildTools(root) with NO spawn closure → no `task` tool (depth-1, P3-D3).
 * - Shares the parent cwd (`root`) and the parent AbortSignal (cancel propagates into the child stream).
 * - Capped at `childMaxSteps` (independent of the parent MAX_STEPS).
 * - If the child would HITL-pause (status === 'awaiting_user'), it does NOT escalate: returns its
 *   partial assistant text with the pending question appended as context (P3-D3, no agent:interrupt).
 */
export async function runSubagent(args: RunSubagentArgs): Promise<string> {
  const { runner, root, summarizer, emit, signal, description, childMaxSteps, permissionMode, requestApproval } = args
  // depth-1: no task tool (no spawn closure). Cascade the conversation's permission mode + approval
  // seam so a chat worker is read-only, an edit worker can write + HITL-gate run_script, and a full
  // worker un-jails files + auto-approves — mirroring how dispatch_agent cascades the same mode.
  const tools = buildTools(root, undefined, root, undefined, { permissionMode, requestApproval, webSearchEnabled: true })
  const ctx: GraphCtx = { runner, tools, emit, summarizer }
  const app = buildGraph(childMaxSteps)
  const final = await app.invoke(
    {
      messages: [new SystemMessage(childSystemPrompt(description, root, permissionMode)), new HumanMessage(description)],
      steps: 0,
      recentSigs: [],
      nudgedSig: undefined,
      status: 'running',
    },
    { configurable: { ctx }, signal, recursionLimit: recursionLimit(childMaxSteps) },
  )
  const text = lastAiText(final.messages)
  if (final.status === 'awaiting_user') {
    const q = final.pendingQuestion
    return q ? `${text}\n\n[sub-agent paused — open question: ${q}]` : text
  }
  return text
}
