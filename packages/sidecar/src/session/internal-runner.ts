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
import type { SkillMeta } from '@hip/protocol'
import type { ApprovalFn } from './tools.js'

/** Keep only the tools whose name is in `allowed`. undefined ⇒ keep all (legacy-safe).
 *  An entry of the form `mcp__<serverId>__*` is a whole-server wildcard: it permits any tool whose
 *  name starts with `mcp__<serverId>__` (the frontend grants MCP access per-server, since it cannot
 *  enumerate a server's individual tool names without a live connection). Every other entry is an
 *  exact name match. */
export function filterTools(tools: StructuredToolInterface[], allowed?: string[]): StructuredToolInterface[] {
  if (!allowed) return tools
  const exact = new Set<string>()
  const prefixes: string[] = []
  for (const a of allowed) {
    const m = /^mcp__(.+)__\*$/.exec(a)
    if (m) prefixes.push(`mcp__${m[1]}__`)
    else exact.add(a)
  }
  return tools.filter((t) => exact.has(t.name) || prefixes.some((p) => t.name.startsWith(p)))
}

export interface RunManagedAgentArgs {
  resolved: ResolvedModel | null      // the agent's bound model; null ⇒ global active model
  cwd: string
  prompt: string                      // persona
  allowedTools?: string[]
  task: string
  emit: GraphEmit
  signal: AbortSignal
  childMaxSteps: number
  runner?: ModelRunner                // injectable for tests; default builds the real model
  summarizer?: Summarizer             // injectable for tests; default = real summarizer
  mcpTools?: StructuredToolInterface[]  // namespaced MCP tools threaded from the parent session
  skills?: SkillMeta[]                  // enabled skills (use_skill candidate)
  requestApproval?: ApprovalFn          // HITL closure threaded from the parent session (run_script)
}

/**
 * Run an internal managed agent: hip's built-in ReAct loop with a custom persona prompt, a model of
 * the agent's choosing (or the global active model), and a tool allow-list. Depth-1 (no task/dispatch).
 * Streams every event through `emit` and returns the final assistant text.
 */
export async function runManagedAgent(args: RunManagedAgentArgs): Promise<string> {
  const { resolved, cwd, prompt, allowedTools, task, emit, signal, childMaxSteps, mcpTools, skills, requestApproval } = args
  const runner = args.runner ?? new RealModelRunner(buildChatModel(resolved ?? getActiveModel()))
  const summarizer = args.summarizer ?? createSummarizer()
  // base + git tools + skill/script/mcp extras (no task/dispatch closures → depth-1), then narrow to the allow-list.
  const tools = filterTools(buildTools(cwd, undefined, cwd, undefined, { mcpTools, skills, requestApproval }), allowedTools)
  const toolNames = tools.map((t) => t.name)
  const ctx: GraphCtx = { runner, tools, emit, summarizer }
  const app = buildGraph(childMaxSteps)
  const final = await app.invoke(
    {
      messages: [new SystemMessage(buildManagedAgentPrompt({ cwd, persona: prompt, toolNames, skills })), new HumanMessage(task)],
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
