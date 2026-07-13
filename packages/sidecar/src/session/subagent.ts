import { SystemMessage, HumanMessage, AIMessage, type BaseMessage } from '@langchain/core/messages'
import type { PermissionMode } from '@hip/protocol'
import type { ModelRunner } from './model-runner.js'
import type { Summarizer } from './compaction.js'
import { buildGraph, type GraphEmit, type GraphCtx } from './graph.js'
import { buildTools, type ApprovalFn } from './tools.js'
import type { NetworkPolicy } from './network-policy.js'
import type { ToolOutputStore } from './tool-output-store.js'
import type { GuardianReviewer } from './guardian.js'
import type { HookRegistry } from './hooks/registry.js'
import { recursionLimit, MAX_DEPTH } from './loop-control.js'
import { childSystemPrompt } from './system-prompt.js'
import { formatPausedToolResult } from './subagent-result.js'
import { linkSubagentParentObservation, type TraceObservation } from './trace-export.js'

const NOOP_EMIT: GraphEmit = {
  token: () => {},
  reasoning: () => {},
  toolStarted: () => {},
  toolFinished: () => {},
  usage: () => {},
  planDelta: () => {},
  compaction: () => {},
}

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
  /** Prior messages to continue from (subagent session continuation). When non-empty, the subagent
   *  starts with these messages + a new HumanMessage(description) instead of a fresh [system, human] pair. */
  existingMessages?: BaseMessage[]
  /** Passed through to GraphCtx; defaults to 'subagent' when absent. */
  sessionId?: string
  /** Network policy from the parent session, applied to web_fetch/web_search. */
  networkPolicy?: NetworkPolicy
  /** Tool output store from the parent session for bound output management. */
  toolOutputStore?: ToolOutputStore
  /** Guardian reviewer for approval escalation; created per-turn with the parent model. */
  guardianReviewer?: GuardianReviewer
  /**
   * Session plugin hook registry. When set, tool calls go through ToolRunner Pre/Post hooks.
   * Recursive child spawns inherit the same registry.
   */
  hooks?: HookRegistry
  /** Optional frame fields for HookContext (workflow / subagent identity). */
  turnId?: string
  runId?: string
  nodeId?: string
  agentId?: string
  /**
   * Parent agent id for observation / hook framing (who delegated this run).
   * Propagated to GraphCtx and recorded as TraceObservation.parentId (E2).
   */
  parentAgentId?: string
  /** Current delegation depth. 0 for top-level session, increments with each `task` delegation.
   *  At depth >= MAX_DEPTH, task/task_batch/dispatch_agent tools are filtered. */
  depth?: number
  /**
   * Optional observation collector (E2). When set, each spawn records a parent-linked
   * span into this sink for JSONL export. Product path leaves this unset.
   */
  onObservation?: (o: TraceObservation) => void
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
 * Run a sub-agent to completion and return its final assistant text.
 *
 * - Shares the parent cwd (`root`) and the parent AbortSignal (cancel propagates into the child stream).
 * - Capped at `childMaxSteps` (independent of the parent MAX_STEPS).
 * - If the child would HITL-pause (status === 'awaiting_user'), it does NOT escalate (no agent:interrupt):
 *   returns first-line `[hip:subagent_paused] <question>` plus optional partial body (P3-D3).
 * - Depth-aware: when currentDepth < MAX_DEPTH, the child gets `task`/`task_batch` tools for
 *   recursive delegation. At depth >= MAX_DEPTH, those tools are filtered out.
 */
export async function runSubagent(args: RunSubagentArgs): Promise<string> {
  const {
    runner, root, summarizer, emit, signal, description, childMaxSteps,
    permissionMode, requestApproval, existingMessages, mode, sessionId,
    networkPolicy, toolOutputStore, guardianReviewer, hooks,
    turnId, runId, nodeId, agentId, parentAgentId, onObservation,
  } = args
  const currentDepth = args.depth ?? 0
  const childAgentId = agentId ?? 'worker'

  // E2: parent observation link (debug-logger + optional collector).
  // Spawn is a span with parentId = parentAgentId — not a LoopEvent (E0 frozen).
  // Lifecycle LoopEvents go through GraphEmit.loopSignal separately if wired.
  linkSubagentParentObservation(
    {
      sessionId: sessionId ?? 'subagent',
      turnId,
      runId,
      agentId: childAgentId,
      parentAgentId,
      task: description,
      depth: currentDepth,
      mode: mode ?? 'foreground',
    },
    { collect: onObservation },
  )

  // Create a spawn function for recursive delegation that increments depth on each call.
  // Parent observation link: child.parentAgentId = this agent (not the grandparent).
  // Per-parent counter keeps sibling agentIds unique at the same depth.
  let nestSeq = 0
  const childSpawn = async (desc: string, submode?: 'foreground' | 'background'): Promise<string> => {
    const seq = nestSeq++
    return runSubagent({
      ...args,
      depth: currentDepth + 1,
      description: desc,
      mode: submode,
      existingMessages: undefined, // each delegation is a fresh sub-agent
      parentAgentId: childAgentId,
      // unique per sibling: parent:d{depth}.{seq}
      agentId: `${childAgentId}:d${currentDepth + 1}.${seq}`,
      // hooks / onObservation stay on ...args so children share the session registry
    })
  }

  // Build tools WITH child spawn so delegation tools are available for the child.
  // Cascade the conversation's permission mode + approval seam so a chat worker is read-only,
  // an edit worker can write + HITL-gate run_script, and a full worker un-jails files + auto-approves
  // — mirroring how dispatch_agent cascades the same mode.
  let tools = buildTools(root, childSpawn, root, undefined, { permissionMode, requestApproval, webSearchEnabled: true, sessionId, networkPolicy })

  // At max depth, strip delegation tools so the sub-agent cannot spawn further children.
  if (currentDepth >= MAX_DEPTH) {
    const blocked = new Set(['task', 'task_batch', 'dispatch_agent'])
    tools = tools.filter((t) => !blocked.has(t.name))
  }
  const ctx: GraphCtx = {
    runner,
    tools,
    emit: mode === 'background' ? NOOP_EMIT : emit,
    summarizer,
    sessionId: sessionId ?? 'subagent',
    hooks,
    turnId,
    runId,
    nodeId,
    agentId: childAgentId,
    parentAgentId,
    toolOutputStore,
    guardianReviewer,
    requestApproval,
    permissionMode,
  }
  const app = buildGraph(childMaxSteps)
  const initialMessages: BaseMessage[] = existingMessages && existingMessages.length > 0
    ? [...existingMessages, new HumanMessage(description)]
    : [new SystemMessage(childSystemPrompt(description, root, permissionMode)), new HumanMessage(description)]
  const final = await app.invoke(
    {
      messages: initialMessages,
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
    return q ? formatPausedToolResult(q, text) : text
  }
  return text
}
