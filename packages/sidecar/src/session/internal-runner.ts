import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { resolveEffectiveConfig } from '../config/hip-config.js'
import type { GraphEmit, GraphCtx } from './graph.js'
import { buildGraph } from './graph.js'
import {
  SUBAGENT_COMPACT_THRESHOLD_PERCENT,
  resolveModelContextWindow,
} from './context-budget.js'
import { buildTools } from './tools.js'
import { recursionLimit } from './loop-control.js'
import { resolveDoomLoopStrategy } from './doom-loop.js'
import { buildManagedAgentPrompt } from './system-prompt.js'
import { mcpManager } from './mcp/manager.js'
import { lastAiText } from './subagent.js'
import { formatPausedToolResult } from './subagent-result.js'
import { RealModelRunner, type ModelRunner } from './model-runner.js'
import { buildChatModel, createSummarizer } from './model-factory.js'
import { getActiveModel } from '../config/providers.js'
import { validateAttachments, buildAttachmentContentParts } from './attachments.js'
import type { AttachmentPayload, ContentPart } from './attachments.js'
import type { Summarizer } from './compaction.js'
import type { ResolvedModel } from './agents/registry.js'
import type { SkillMeta, PermissionMode } from '@hip/protocol'
import type { ApprovalFn } from './tools.js'
import type { NetworkPolicy } from './network-policy.js'
import type { ToolOutputStore } from './tool-output-store.js'
import type { GuardianReviewer } from './guardian.js'
import type { HookRegistry } from './hooks/registry.js'
import { tracingInvokeFields } from '../observability/langsmith.js'

export interface RunManagedAgentArgs {
  resolved: ResolvedModel | null      // the agent's bound model; null ⇒ global active model
  cwd: string
  prompt: string                      // persona
  task: string
  attachments?: AttachmentPayload[]   // image/document attachments rendered as content parts in the human message
  /** Pre-built content parts; skips re-validation/re-reading attachments. When provided with a
   *  non-empty `task`, the task text is automatically prepended as the first content part. */
  attachmentParts?: ContentPart[]
  emit: GraphEmit
  signal: AbortSignal
  childMaxSteps: number
  runner?: ModelRunner                // injectable for tests; default builds the real model
  summarizer?: Summarizer             // injectable for tests; default = real summarizer
  mcpTools?: StructuredToolInterface[]  // namespaced MCP tools, ALREADY narrowed to the agent's allowedMcpServers by the caller
  skills?: SkillMeta[]                  // skills ALREADY narrowed to the agent's allowedSkills by the caller (use_skill candidate)
  requestApproval?: ApprovalFn          // HITL closure threaded from the parent session (run_script); presence decides registration
  permissionMode?: PermissionMode       // cascaded from the parent conversation; default 'edit'
  sessionId?: string                    // passed through to GraphCtx; defaults to 'managed-agent' when absent
  /** Parent conversation title for LangSmith root runName (optional). */
  title?: string
  networkPolicy?: NetworkPolicy         // parent session's network policy (rate limits, SSRF guard)
  toolOutputStore?: ToolOutputStore     // parent session's tool output store (bound large outputs to files)
  guardianReviewer?: GuardianReviewer   // parent session's guardian reviewer (reads files before write)
  /** Session plugin hook registry (distinct from ExternalAgentHooks on ACP providers). */
  hooks?: HookRegistry
  turnId?: string
  runId?: string
  nodeId?: string
  agentId?: string
  parentAgentId?: string
  /**
   * Optional built-in tool allow-list for this managed run (e.g. explore read-only).
   * When set, `buildTools` filters to these names (+ MCP still allowed via name prefix).
   */
  allowedTools?: string[]
  /** Appended after managed system prompt (memory core, etc.). */
  systemPromptExtra?: string
  /** Extra tools merged BEFORE toolNames / prompt (must be in toolNames for explore allowlist). */
  extraTools?: StructuredToolInterface[]
}

/**
/**
 * Run an internal managed agent: hip's built-in ReAct loop with a custom persona prompt and a model of
 * the agent's choosing (or the global active model). Depth-1 (no task/dispatch). Built-in tools are
 * granted unless `allowedTools` is set (e.g. explore read-only). Skills/MCP are pre-narrowed by the
 * caller. The permission mode controls write/edit registration and the filesystem jail (see buildTools).
 * Streams every event through `emit` and returns the final assistant text.
 */
export async function runManagedAgent(args: RunManagedAgentArgs): Promise<string> {
  const {
    resolved, cwd, prompt, task, attachments, attachmentParts, emit, signal, childMaxSteps,
    mcpTools, skills, requestApproval, permissionMode, networkPolicy, toolOutputStore, guardianReviewer,
    hooks, turnId, runId, nodeId, agentId, parentAgentId, allowedTools,
    systemPromptExtra, extraTools,
  } = args
  const runner = args.runner ?? new RealModelRunner(buildChatModel(resolved ?? getActiveModel()))
  const summarizer = args.summarizer ?? createSummarizer()
  // base + git tools + skill/script/mcp extras (no task/dispatch closures → depth-1).
  // Optional allowedTools gates built-ins (explore); skills/mcp were pre-filtered by the caller.
  const baseTools = buildTools(cwd, undefined, cwd, undefined, {
    mcpTools,
    skills,
    requestApproval,
    permissionMode,
    webSearchEnabled: true,
    sessionId: args.sessionId,
    networkPolicy,
    ...(allowedTools?.length ? { allowedTools } : {}),
  })
  // Mandatory order (KD-7 / design §7): buildTools → append extraTools → toolNames → prompt → systemExtra
  const tools = extraTools?.length ? [...baseTools, ...extraTools] : baseTools
  const toolNames = tools.map((t) => t.name)
  // Inherit doom strategy from effective hip.toml (same as parent turn path).
  const doomLoopStrategy = resolveDoomLoopStrategy(
    resolveEffectiveConfig(cwd).agentLoop?.doomLoopStrategy,
  )
  const active = getActiveModel()
  const contextWindowTokens = resolveModelContextWindow(active.providerID, active.modelID)
  const ctx: GraphCtx = {
    runner,
    tools,
    emit,
    summarizer,
    sessionId: args.sessionId ?? 'managed-agent',
    hooks,
    turnId,
    runId,
    nodeId,
    agentId,
    parentAgentId,
    toolOutputStore,
    guardianReviewer,
    requestApproval,
    permissionMode,
    doomLoopStrategy,
    contextWindowTokens,
    compactThresholdPercent: SUBAGENT_COMPACT_THRESHOLD_PERCENT,
  }
  let humanParts: ContentPart[]
  if (attachmentParts?.length) {
    if (task) {
      humanParts = [{ type: 'text', text: task }, ...attachmentParts]
    } else {
      humanParts = attachmentParts
    }
  } else {
    humanParts = []
    if (task) humanParts.push({ type: 'text', text: task })
    if (attachments?.length) {
      await validateAttachments(attachments)
      const built = await buildAttachmentContentParts(attachments)
      humanParts.push(...built)
    }
  }
  let humanMessage: HumanMessage
  if (humanParts.length === 0) {
    humanMessage = new HumanMessage('')
  } else if (humanParts.length === 1 && humanParts[0].type === 'text') {
    humanMessage = new HumanMessage(humanParts[0].text)
  } else {
    humanMessage = new HumanMessage({ content: humanParts })
  }
  let systemText = buildManagedAgentPrompt({
    cwd,
    persona: prompt,
    toolNames,
    skills,
    permissionMode,
    mcpCatalog: toolNames.includes('mcp_search') ? mcpManager.toolCatalog() : undefined,
  })
  if (systemPromptExtra?.trim()) {
    systemText = `${systemText}\n\n${systemPromptExtra.trim()}`
  }
  ctx.systemPrompt = systemText
  const app = buildGraph(childMaxSteps)
  const final = await app.invoke(
    {
      messages: [new SystemMessage(systemText), humanMessage],
      steps: 0,
      recentSigs: [],
      nudgedSig: undefined,
      status: 'running',
    },
    {
      configurable: { ctx },
      signal,
      recursionLimit: recursionLimit(childMaxSteps),
      ...tracingInvokeFields({
        kind: 'managed-agent',
        sessionId: args.sessionId,
        turnId,
        runId,
        agentId,
        parentAgentId,
        title: args.title,
      }),
    },
  )
  const text = lastAiText(final.messages)
  if (final.status === 'awaiting_user') {
    const q = final.pendingQuestion
    return q ? formatPausedToolResult(q, text) : text
  }
  return text
}
