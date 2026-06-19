import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { GraphEmit, GraphCtx } from './graph.js'
import { buildGraph } from './graph.js'
import { buildTools } from './tools.js'
import { recursionLimit } from './loop-control.js'
import { buildManagedAgentPrompt } from './system-prompt.js'
import { lastAiText } from './subagent.js'
import { RealModelRunner, type ModelRunner } from './model-runner.js'
import { buildChatModel, createSummarizer } from './model-factory.js'
import { getActiveModel } from '../config/providers.js'
import type { Summarizer } from './compaction.js'
import type { ResolvedModel } from './agents/registry.js'
import type { SkillMeta, PermissionMode } from '@hip/protocol'
import type { ApprovalFn } from './tools.js'

export interface RunManagedAgentArgs {
  resolved: ResolvedModel | null      // the agent's bound model; null ⇒ global active model
  cwd: string
  prompt: string                      // persona
  task: string
  emit: GraphEmit
  signal: AbortSignal
  childMaxSteps: number
  runner?: ModelRunner                // injectable for tests; default builds the real model
  summarizer?: Summarizer             // injectable for tests; default = real summarizer
  mcpTools?: StructuredToolInterface[]  // namespaced MCP tools, ALREADY narrowed to the agent's allowedMcpServers by the caller
  skills?: SkillMeta[]                  // skills ALREADY narrowed to the agent's allowedSkills by the caller (use_skill candidate)
  requestApproval?: ApprovalFn          // HITL closure threaded from the parent session (run_script); presence decides registration
  permissionMode?: PermissionMode       // cascaded from the parent conversation; default 'edit'
}

/**
 * Run an internal managed agent: hip's built-in ReAct loop with a custom persona prompt and a model of
 * the agent's choosing (or the global active model). Depth-1 (no task/dispatch). ALL built-in tools are
 * always granted (+ run_script when requestApproval is present, + use_skill when skills are present);
 * the per-agent narrowing already happened on the inputs (skills/mcpTools) at the caller. The permission
 * mode controls write/edit registration and the filesystem jail (see buildTools). Streams every event
 * through `emit` and returns the final assistant text.
 */
export async function runManagedAgent(args: RunManagedAgentArgs): Promise<string> {
  const { resolved, cwd, prompt, task, emit, signal, childMaxSteps, mcpTools, skills, requestApproval, permissionMode } = args
  const runner = args.runner ?? new RealModelRunner(buildChatModel(resolved ?? getActiveModel()))
  const summarizer = args.summarizer ?? createSummarizer()
  // base + git tools + skill/script/mcp extras (no task/dispatch closures → depth-1). No allow-list
  // narrowing: built-ins are always on; skills/mcp were pre-filtered by the caller; mode gates write/edit.
  const tools = buildTools(cwd, undefined, cwd, undefined, { mcpTools, skills, requestApproval, permissionMode, webSearchEnabled: true })
  const toolNames = tools.map((t) => t.name)
  const ctx: GraphCtx = { runner, tools, emit, summarizer }
  const app = buildGraph(childMaxSteps)
  const final = await app.invoke(
    {
      messages: [new SystemMessage(buildManagedAgentPrompt({ cwd, persona: prompt, toolNames, skills, permissionMode })), new HumanMessage(task)],
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
